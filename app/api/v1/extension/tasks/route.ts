/**
 * LaunchGrid Extension Tasks API
 * 
 * Following the constitution:
 * - Human-in-the-loop for social posting
 * - Integrations are adapters, not business logic holders
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withExtensionAuth, successResponse, type APIContext } from '@/lib/api/middleware';
import { validateInput, extensionResultSchema } from '@/lib/core/validation';
import { logSecurityEvent } from '@/lib/events/audit-logger';
import { emitTaskEvent } from '@/lib/events/event-bus';

// GET /api/v1/extension/tasks - Get next queued task
async function handleGetTask(request: NextRequest, context: APIContext) {
  // Use admin client to bypass RLS for extension
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  // Get the oldest extension-queued task
  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      *,
      step:steps(*)
    `)
    .eq('status', 'extension_queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching extension task:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!task) {
    return successResponse({ task: null });
  }

  // Log extension access
  await logSecurityEvent(
    {
      organizationId: 'extension',
      userId: context.user.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    },
    'EXTENSION_TASK_FETCH',
    { taskId: task.id, stepType: task.step?.type }
  );

  // Format for extension
  const payload = {
    taskId: task.id,
    type: task.step?.type,
    platform: 'twitter', // Derive from pillar in production
    config: task.step?.config,
  };

  return successResponse({ task: payload });
}

// POST /api/v1/extension/tasks - Submit task result
async function handleSubmitResult(request: NextRequest, context: APIContext) {
  const body = await request.json();
  const { taskId, result } = validateInput(extensionResultSchema, body);

  // Use admin client to bypass RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  // Verify task exists and is in correct state
  const { data: existingTask, error: fetchError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (fetchError || !existingTask) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  if (existingTask.status !== 'extension_queued') {
    return NextResponse.json(
      { error: 'Task is not in extension_queued state' },
      { status: 400 }
    );
  }

  // Update task with result
  const newStatus = result.success ? 'review_needed' : 'failed';
  const { error: updateError } = await supabase
    .from('tasks')
    .update({
      status: newStatus,
      output_data: result.data || {},
      error_message: result.error,
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Emit event
  await emitTaskEvent(
    result.success ? 'TASK_COMPLETED' : 'TASK_FAILED',
    taskId,
    {
      source: 'extension',
      result: result.success,
    },
    {
      organizationId: 'extension',
      userId: context.user.id,
      correlationId: context.requestId,
      source: 'extension',
    }
  );

  // Log completion
  await logSecurityEvent(
    {
      organizationId: 'extension',
      userId: context.user.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    },
    'EXTENSION_TASK_COMPLETE',
    { taskId, success: result.success }
  );

  return successResponse({ success: true, status: newStatus });
}

export const GET = withExtensionAuth(handleGetTask);
export const POST = withExtensionAuth(handleSubmitResult);

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    },
  });
}
