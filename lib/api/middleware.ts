/**
 * LaunchGrid API Middleware
 * 
 * Following the constitution:
 * - API-first. UI is only a client.
 * - Tenant isolation everywhere
 * - Security principles: least privilege, audit trail
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { nanoid } from 'nanoid';
import {
  AuthenticationError,
  RateLimitError,
  ValidationError,
  formatErrorResponse,
  normalizeError,
  isAppError,
} from '../core/errors';
import { logSecurityEvent } from '../events/audit-logger';

// ==========================================
// TYPES
// ==========================================

export interface APIContext {
  requestId: string;
  user: {
    id: string;
    email?: string;
  };
  organizationId: string;
  ipAddress: string;
  userAgent: string;
}

export type APIHandler = (
  request: NextRequest,
  context: APIContext
) => Promise<NextResponse>;

// ==========================================
// RATE LIMITING
// ==========================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMIT_CONFIG = {
  default: { requests: 100, windowMs: 60000 }, // 100 req/min
  auth: { requests: 10, windowMs: 60000 }, // 10 req/min for auth endpoints
  ai: { requests: 20, windowMs: 60000 }, // 20 req/min for AI endpoints
  extension: { requests: 300, windowMs: 60000 }, // 300 req/min for extension
};

function getRateLimitKey(ip: string, endpoint: string): string {
  return `${ip}:${endpoint}`;
}

function checkRateLimit(
  ip: string,
  endpoint: string,
  config: { requests: number; windowMs: number }
): { allowed: boolean; remaining: number; resetAt: number } {
  const key = getRateLimitKey(ip, endpoint);
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + config.windowMs,
    };
  }

  entry.count++;
  rateLimitStore.set(key, entry);

  const remaining = Math.max(0, config.requests - entry.count);
  const allowed = entry.count <= config.requests;

  return { allowed, remaining, resetAt: entry.resetAt };
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

// ==========================================
// AUTHENTICATION
// ==========================================

async function authenticateRequest(request: NextRequest): Promise<{
  user: { id: string; email?: string };
  organizationId: string;
} | null> {
  // Check for API key in header (for extension/external clients)
  const apiKey = request.headers.get('x-api-key');
  if (apiKey) {
    // TODO: Implement API key authentication
    // For now, fall back to session auth
  }

  // Check for Bearer token
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // TODO: Implement JWT verification
    // For now, fall back to session auth
  }

  // Session-based auth via Supabase
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() { }, // Read-only for API routes
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // For now, use user.id as organizationId until we implement multi-tenancy
  return {
    user: { id: user.id, email: user.email },
    organizationId: user.id, // TODO: Get actual organization ID
  };
}

// ==========================================
// REQUEST HELPERS
// ==========================================

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

function getUserAgent(request: NextRequest): string {
  return request.headers.get('user-agent') || 'unknown';
}

// ==========================================
// RESPONSE HELPERS
// ==========================================

export function successResponse<T>(data: T, meta?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    { status: 200 }
  );
}

export function createdResponse<T>(data: T, meta?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    { status: 201 }
  );
}

export function noContentResponse(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function errorResponse(error: Error, requestId?: string): NextResponse {
  const appError = normalizeError(error);
  const body = formatErrorResponse(appError) as {
    success: boolean;
    error: { code: string; message: string; details?: Record<string, unknown> };
    meta: Record<string, unknown>;
  };

  if (requestId) {
    body.meta = { ...body.meta, requestId };
  }

  return NextResponse.json(body, { status: appError.statusCode });
}

// ==========================================
// MIDDLEWARE WRAPPER
// ==========================================

export function withAuth(handler: APIHandler, options?: {
  rateLimit?: keyof typeof RATE_LIMIT_CONFIG;
  requireAuth?: boolean;
}): (request: NextRequest) => Promise<NextResponse> {
  const requireAuth = options?.requireAuth !== false; // Default to true
  const rateLimitType = options?.rateLimit || 'default';

  return async (request: NextRequest): Promise<NextResponse> => {
    const requestId = nanoid();
    const ipAddress = getClientIP(request);
    const userAgent = getUserAgent(request);

    try {
      // CORS headers
      const corsHeaders = {
        'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Request-ID',
        'X-Request-ID': requestId,
      };

      // Handle preflight
      if (request.method === 'OPTIONS') {
        return new NextResponse(null, { status: 204, headers: corsHeaders });
      }

      // Rate limiting
      const rateLimitConfig = RATE_LIMIT_CONFIG[rateLimitType];
      const rateLimit = checkRateLimit(ipAddress, request.nextUrl.pathname, rateLimitConfig);

      if (!rateLimit.allowed) {
        await logSecurityEvent(
          {
            organizationId: '00000000-0000-0000-0000-000000000000',
            userId: '00000000-0000-0000-0000-000000000000',
            requestId,
            ipAddress,
            userAgent
          },
          'RATE_LIMIT_EXCEEDED',
          { endpoint: request.nextUrl.pathname }
        );

        throw new RateLimitError(
          'Too many requests. Please try again later.',
          Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
        );
      }

      // Authentication
      let context: APIContext;

      if (requireAuth) {
        const auth = await authenticateRequest(request);

        if (!auth) {
          await logSecurityEvent(
            {
              organizationId: '00000000-0000-0000-0000-000000000000',
              userId: '00000000-0000-0000-0000-000000000000',
              requestId,
              ipAddress,
              userAgent
            },
            'AUTH_FAILED',
            { endpoint: request.nextUrl.pathname }
          );

          throw new AuthenticationError('Authentication required');
        }

        context = {
          requestId,
          user: auth.user,
          organizationId: auth.organizationId,
          ipAddress,
          userAgent,
        };
      } else {
        context = {
          requestId,
          user: { id: '00000000-0000-0000-0000-000000000000' }, // Use valid UUID for anonymous
          organizationId: '00000000-0000-0000-0000-000000000000', // Use valid UUID for public
          ipAddress,
          userAgent,
        };
      }

      // Execute handler
      const response = await handler(request, context);

      // Add standard headers
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining));
      response.headers.set('X-RateLimit-Reset', String(Math.ceil(rateLimit.resetAt / 1000)));

      return response;
    } catch (error) {
      console.error(`[API Error] ${requestId}:`, error);

      const response = errorResponse(error as Error, requestId);

      // Add CORS headers to error responses too
      response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
      response.headers.set('X-Request-ID', requestId);

      return response;
    }
  };
}

// ==========================================
// SPECIALIZED MIDDLEWARE
// ==========================================

/**
 * Middleware for extension API (allows anonymous but rate limited)
 */
export function withExtensionAuth(handler: APIHandler): (request: NextRequest) => Promise<NextResponse> {
  return withAuth(handler, { rateLimit: 'extension', requireAuth: false });
}

/**
 * Middleware for AI endpoints (authenticated with special rate limit)
 */
export function withAIAuth(handler: APIHandler): (request: NextRequest) => Promise<NextResponse> {
  return withAuth(handler, { rateLimit: 'ai', requireAuth: true });
}

// ==========================================
// INPUT PARSING HELPERS
// ==========================================

export async function parseJSONBody<T>(request: NextRequest): Promise<T> {
  try {
    return await request.json();
  } catch (error) {
    throw new ValidationError('Invalid JSON body');
  }
}

export function parseSearchParams(request: NextRequest): URLSearchParams {
  return request.nextUrl.searchParams;
}

export function getPathParam(request: NextRequest, name: string): string | null {
  const url = new URL(request.url);
  const segments = url.pathname.split('/');
  // This is a simple implementation; in practice, use the params from Next.js
  return null;
}
