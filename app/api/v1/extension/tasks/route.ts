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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/v1/extension/tasks - Get next queued task
async function handleGetTask(request: NextRequest, context: APIContext) {
  // Use admin client to bypass RLS for extension
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  // 0. Auto-recover stuck tasks (Zombie Check)
  // If a task is 'in_progress' but started more than 5 minutes ago (and hasn't completed), reset it to 'extension_queued'.
  // Using started_at because updated_at migration failed in local env.
  const restartThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { error: recoveryError } = await supabase
    .from('tasks')
    .update({
      status: 'extension_queued'
    })
    .eq('status', 'in_progress')
    .lt('started_at', restartThreshold);

  if (recoveryError) {
    console.warn('Failed to recover stale tasks:', recoveryError);
  }

  // 1. Get the oldest queued task
  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      *,
      step:steps(*),
      project:projects(user_id)
    `)
    .eq('status', 'extension_queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  // DEBUG: Check if we are finding anything
  if (!task) {
    const { count } = await supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'extension_queued');
    console.log(`[ExtensionDebug] No task returned. DB Total queued: ${count}`);
  } else {
    console.log(`[ExtensionDebug] Found task: ${task.id}`);
  }

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching extension task:', error);
    return NextResponse.json({ error: error.message }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (!task) {
    const response = successResponse({ task: null });
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    return response;
  }

  // CRITICAL: Mark as in_progress immediately to prevent other polls (or this one)
  // from picking it up again and starting duplicate scans.
  const { error: updateStatusError } = await supabase
    .from('tasks')
    .update({
      status: 'in_progress'
    })
    .eq('id', task.id);

  if (updateStatusError) {
    console.error('Error marking task as in_progress:', updateStatusError);
    // Continue anyway as we have the task, but this log helps debug
  }

  const userId = (task.project as any)?.user_id || '00000000-0000-0000-0000-000000000000';

  // Log extension access
  await logSecurityEvent(
    {
      organizationId: userId,
      userId: userId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    },
    'EXTENSION_TASK_FETCH',
    { taskId: task.id, stepType: task.step?.type }
  );

  // Determine best start URL based on task type
  // User prefers starting on the home feed (x.com/home) for scanning
  let fallbackUrl = 'https://x.com/home';
  const mergedConfig = {
    ...task.step?.config,
    ...(task.output_data || {})
  };

  // Format for extension
  const payload = {
    taskId: task.id,
    type: task.step?.type,
    platform: 'twitter', // Derive from pillar in production
    config: {
      ...mergedConfig,
      // Smart URL injection: Use existing, or smart fallback
      url: (task.output_data as any)?.url || (task.output_data as any)?.targetUrl || (task.output_data as any)?.postUrl || fallbackUrl,
      targetUrl: (task.output_data as any)?.url || (task.output_data as any)?.targetUrl || fallbackUrl,
      postUrl: (task.output_data as any)?.url || fallbackUrl
    }
  };

  console.log('[ExtensionDebug] Serving task:', JSON.stringify({
    id: task.id,
    type: task.step?.type,
    keywords: mergedConfig.keywords,
    finalUrl: payload.config.url
  }, null, 2));

  // DO NOT use successResponse here - the extension expects a flat object with a "task" property
  const response = NextResponse.json({ task: payload });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}

// POST /api/v1/extension/tasks - Submit task result
async function handleSubmitResult(request: NextRequest, context: APIContext) {
  const body = await request.json();
  const { taskId, result } = validateInput(extensionResultSchema, body);

  // Use admin client to bypass RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
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
    .select('*, project:projects(user_id)')
    .eq('id', taskId)
    .single();

  if (fetchError || !existingTask) {
    return NextResponse.json({ error: 'Task not found' }, {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }

  const userId = (existingTask.project as any)?.user_id || '00000000-0000-0000-0000-000000000000';

  if (existingTask.status !== 'extension_queued' && existingTask.status !== 'in_progress') {
    return NextResponse.json(
      { error: `Task ${taskId} is in ${existingTask.status} state, cannot accept result (need extension_queued or in_progress)` },
      {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' }
      }
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
      organizationId: userId,
      userId: userId,
      correlationId: context.requestId,
      source: 'extension',
    }
  );

  // Log completion
  await logSecurityEvent(
    {
      organizationId: userId,
      userId: userId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    },
    'EXTENSION_TASK_COMPLETE',
    { taskId, success: result.success }
  );

  const response = successResponse({ success: true, status: newStatus });
  response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
}

// PATCH /api/v1/extension/tasks - Update task progress (heartbeat)
async function handleUpdateProgress(request: NextRequest, context: APIContext) {
  const body = await request.json();
  const { taskId, progress } = body;

  if (!taskId || !progress) {
    return NextResponse.json({ error: 'Missing taskId or progress' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  // Update task output_data with progress message
  const { data: task, error: fetchError } = await supabase
    .from('tasks')
    .select('output_data')
    .eq('id', taskId)
    .single();

  if (fetchError || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const newOutputData = {
    ...(task.output_data as Record<string, unknown> || {}),
    progress_info: progress,
    last_heartbeat: new Date().toISOString()
  };

  const { error: updateError } = await supabase
    .from('tasks')
    .update({ output_data: newOutputData })
    .eq('id', taskId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  console.log(`[ExtensionProgress] Task ${taskId}: ${progress}`);

  const response = successResponse({ success: true });
  response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
}

export const GET = withExtensionAuth(handleGetTask);
export const POST = withExtensionAuth(handleSubmitResult);
export const PATCH = withExtensionAuth(handleUpdateProgress);

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
