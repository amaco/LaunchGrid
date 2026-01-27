/**
 * LaunchGrid Projects API
 * 
 * Following the constitution: API-first. UI is only a client.
 * 
 * Endpoints:
 * - GET /api/v1/projects - List projects
 * - POST /api/v1/projects - Create a new project
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { withAuth, successResponse, createdResponse, parseJSONBody, type APIContext } from '@/lib/api/middleware';
import { ProjectService, createServiceContext } from '@/lib/services';
import { validateInput, createProjectSchema, paginationSchema } from '@/lib/core/validation';

// GET /api/v1/projects
async function handleList(request: NextRequest, context: APIContext) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => { },
      },
    }
  );

  const serviceContext = createServiceContext(
    supabase,
    context.user,
    context.organizationId,
    {
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    }
  );

  const projectService = new ProjectService(serviceContext);

  // Parse query params
  const searchParams = request.nextUrl.searchParams;
  const pagination = validateInput(paginationSchema, {
    page: searchParams.get('page'),
    limit: searchParams.get('limit'),
  });

  const { projects, total } = await projectService.list({
    status: searchParams.get('status') || undefined,
    limit: pagination.limit,
    offset: (pagination.page - 1) * pagination.limit,
  });

  return successResponse(projects, {
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: pagination.page * pagination.limit < total,
    },
  });
}

// POST /api/v1/projects
async function handleCreate(request: NextRequest, context: APIContext) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => { },
      },
    }
  );

  const serviceContext = createServiceContext(
    supabase,
    context.user,
    context.organizationId,
    {
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    }
  );

  const projectService = new ProjectService(serviceContext);

  // Parse and validate body
  const body = await parseJSONBody(request);
  const input = validateInput(createProjectSchema, body);

  const project = await projectService.create(input);

  return createdResponse(project);
}

export const GET = withAuth(handleList);
export const POST = withAuth(handleCreate);
