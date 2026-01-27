/**
 * LaunchGrid Project API (Single Resource)
 * 
 * Following the constitution: API-first. UI is only a client.
 * 
 * Endpoints:
 * - GET /api/v1/projects/:id - Get project details
 * - PATCH /api/v1/projects/:id - Update project
 * - DELETE /api/v1/projects/:id - Delete project
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { withAuth, successResponse, noContentResponse, parseJSONBody, type APIContext } from '@/lib/api/middleware';
import { ProjectService, createServiceContext } from '@/lib/services';
import { validateInput, updateProjectSchema, uuidSchema } from '@/lib/core/validation';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/v1/projects/:id
async function handleGet(request: NextRequest, context: APIContext, params: { id: string }) {
  const projectId = validateInput(uuidSchema, params.id);

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
  const project = await projectService.getById(projectId);

  return successResponse(project);
}

// PATCH /api/v1/projects/:id
async function handleUpdate(request: NextRequest, context: APIContext, params: { id: string }) {
  const projectId = validateInput(uuidSchema, params.id);

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

  const body = await parseJSONBody(request);
  const input = validateInput(updateProjectSchema, body);

  const project = await projectService.update(projectId, input);

  return successResponse(project);
}

// DELETE /api/v1/projects/:id
async function handleDelete(request: NextRequest, context: APIContext, params: { id: string }) {
  const projectId = validateInput(uuidSchema, params.id);

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
  await projectService.delete(projectId);

  return noContentResponse();
}

// Wrap handlers with params extraction
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return withAuth(async (req, ctx) => handleGet(req, ctx, { id }))(request);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return withAuth(async (req, ctx) => handleUpdate(req, ctx, { id }))(request);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return withAuth(async (req, ctx) => handleDelete(req, ctx, { id }))(request);
}
