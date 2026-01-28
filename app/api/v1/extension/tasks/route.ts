/**
 * LaunchGrid Extension Tasks API
 * 
 * Following the constitution:
 * - Human-in-the-loop for social posting
 * - Integrations are adapters, not business logic holders
 * 
 * Improvements:
 * - Atomic task claiming with optimistic locking
 * - Reduced zombie timeout for faster recovery
 * - Better heartbeat tracking
 * - Enhanced logging
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withExtensionAuth, successResponse, type APIContext } from '@/lib/api/middleware';
import { validateInput, extensionResultSchema } from '@/lib/core/validation';
import { logSecurityEvent } from '@/lib/events/audit-logger';
import { emitTaskEvent } from '@/lib/events/event-bus';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  // Zombie task recovery - reduced from 5 minutes to 2 minutes
  ZOMBIE_THRESHOLD_MS: 2 * 60 * 1000,  // 2 minutes
  
  // Heartbeat threshold - task is considered stale if no heartbeat in this time
  HEARTBEAT_THRESHOLD_MS: 45 * 1000,  // 45 seconds
  
  // Maximum tasks to return for debugging
  DEBUG_TASK_LIMIT: 5,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create admin Supabase client (bypasses RLS)
 */
function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

/**
 * Standard CORS headers
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Cache-Control': 'no-store, max-age=0',
};

/**
 * Add CORS headers to response
 */
function withCORS(response: NextResponse): NextResponse {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

// ============================================
// GET /api/v1/extension/tasks - Get next queued task
// ============================================

async function handleGetTask(request: NextRequest, context: APIContext) {
  const supabase = createAdminClient();
  const requestTime = new Date().toISOString();

  console.log(`[Extension API] GET /tasks - Request at ${requestTime}`);

  // 1. Auto-recover zombie tasks (stuck in in_progress)
  const zombieThreshold = new Date(Date.now() - CONFIG.ZOMBIE_THRESHOLD_MS).toISOString();

  const { data: zombieTasks, error: zombieCheckError } = await supabase
    .from('tasks')
    .select('id, started_at, output_data')
    .eq('status', 'in_progress')
    .lt('started_at', zombieThreshold);

  if (!zombieCheckError && zombieTasks && zombieTasks.length > 0) {
    console.log(`[Extension API] Found ${zombieTasks.length} zombie task(s), recovering...`);
    
    for (const zombie of zombieTasks) {
      // Check if there's been recent heartbeat
      const lastHeartbeat = (zombie.output_data as any)?.last_heartbeat;
      const heartbeatThreshold = new Date(Date.now() - CONFIG.HEARTBEAT_THRESHOLD_MS).toISOString();
      
      // Only reset if no recent heartbeat
      if (!lastHeartbeat || lastHeartbeat < heartbeatThreshold) {
        await supabase
          .from('tasks')
          .update({
            status: 'extension_queued',
            output_data: {
              ...(zombie.output_data as object || {}),
              _recovered_at: requestTime,
              _recovery_reason: 'zombie_task_no_heartbeat'
            }
          })
          .eq('id', zombie.id);
        
        console.log(`[Extension API] Recovered zombie task: ${zombie.id}`);
      }
    }
  }

  // 2. Get the oldest queued task with atomic claim
  // Use a transaction-like approach: select and update in one operation
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

  if (error && error.code !== 'PGRST116') {
    console.error('[Extension API] Error fetching task:', error);
    return withCORS(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  if (!task) {
    // Debug: Check how many tasks are queued
    const { count } = await supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'extension_queued');
    
    console.log(`[Extension API] No task found. Total queued in DB: ${count || 0}`);
    
    return withCORS(NextResponse.json({ task: null }));
  }

  // 3. Atomically claim the task (optimistic locking)
  const { data: claimedTask, error: claimError } = await supabase
    .from('tasks')
    .update({
      status: 'in_progress',
      started_at: requestTime,
      output_data: {
        ...(task.output_data as object || {}),
        _claimed_at: requestTime,
        _claim_request_id: context.requestId
      }
    })
    .eq('id', task.id)
    .eq('status', 'extension_queued')  // Only claim if still queued (optimistic lock)
    .select()
    .single();

  if (claimError || !claimedTask) {
    // Task was claimed by another request, try again on next poll
    console.log(`[Extension API] Task ${task.id} was claimed by another request`);
    return withCORS(NextResponse.json({ task: null }));
  }

  const userId = (task.project as any)?.user_id || '00000000-0000-0000-0000-000000000000';

  // 4. Log the task fetch
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

  // 5. Build response payload
  const stepConfig = task.step?.config || {};
  const taskOutputData = task.output_data || {};
  
  // Merge configs with priority: output_data > step config
  const mergedConfig = {
    ...stepConfig,
    ...taskOutputData,
  };

  // Determine best URL
  let targetUrl = 'https://x.com/home';
  if (taskOutputData.url) targetUrl = taskOutputData.url;
  else if (taskOutputData.targetUrl) targetUrl = taskOutputData.targetUrl;
  else if (taskOutputData.postUrl) targetUrl = taskOutputData.postUrl;
  else if (stepConfig.url) targetUrl = stepConfig.url;

  const payload = {
    taskId: task.id,
    type: task.step?.type || 'SCAN_FEED',  // Default to SCAN_FEED if type missing
    platform: 'twitter',
    config: {
      ...mergedConfig,
      url: targetUrl,
      targetUrl: targetUrl,
      // Pass through scan configuration
      targetTweetCount: mergedConfig.targetTweetCount || 25,
      keywords: mergedConfig.keywords || null,
    }
  };

  console.log(`[Extension API] Serving task:`, {
    id: task.id,
    type: payload.type,
    url: targetUrl,
    hasKeywords: !!mergedConfig.keywords
  });

  return withCORS(NextResponse.json({ task: payload }));
}

// ============================================
// POST /api/v1/extension/tasks - Submit task result
// ============================================

async function handleSubmitResult(request: NextRequest, context: APIContext) {
  const body = await request.json();
  
  console.log(`[Extension API] POST /tasks - Result submission:`, {
    taskId: body.taskId,
    success: body.result?.success,
    hasData: !!body.result?.data
  });

  const { taskId, result } = validateInput(extensionResultSchema, body);

  const supabase = createAdminClient();

  // Verify task exists
  const { data: existingTask, error: fetchError } = await supabase
    .from('tasks')
    .select('*, project:projects(user_id)')
    .eq('id', taskId)
    .single();

  if (fetchError || !existingTask) {
    console.error(`[Extension API] Task not found: ${taskId}`);
    return withCORS(NextResponse.json({ error: 'Task not found' }, { status: 404 }));
  }

  const userId = (existingTask.project as any)?.user_id || '00000000-0000-0000-0000-000000000000';

  // Validate task is in correct state
  const validStates = ['extension_queued', 'in_progress'];
  if (!validStates.includes(existingTask.status)) {
    console.warn(`[Extension API] Task ${taskId} in invalid state: ${existingTask.status}`);
    return withCORS(NextResponse.json(
      { error: `Task is in '${existingTask.status}' state. Expected: ${validStates.join(' or ')}` },
      { status: 400 }
    ));
  }

  // Determine new status
  const newStatus = result.success ? 'review_needed' : 'failed';
  
  // Build output data
  const outputData = {
    ...(result.data || {}),
    _completed_at: new Date().toISOString(),
    _completion_request_id: context.requestId,
  };

  // Update task
  const { error: updateError } = await supabase
    .from('tasks')
    .update({
      status: newStatus,
      output_data: outputData,
      error_message: result.success ? null : (result.data?.summary || result.data?.error || 'Unknown error'),
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (updateError) {
    console.error(`[Extension API] Failed to update task:`, updateError);
    return withCORS(NextResponse.json({ error: updateError.message }, { status: 500 }));
  }

  // Emit event
  await emitTaskEvent(
    result.success ? 'TASK_COMPLETED' : 'TASK_FAILED',
    taskId,
    {
      source: 'extension',
      success: result.success,
      itemCount: result.data?.found_items?.length || 0,
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
    { taskId, success: result.success, status: newStatus }
  );

  console.log(`[Extension API] Task ${taskId} completed with status: ${newStatus}`);

  return withCORS(successResponse({ success: true, status: newStatus }));
}

// ============================================
// PATCH /api/v1/extension/tasks - Update task progress (heartbeat)
// ============================================

async function handleUpdateProgress(request: NextRequest, context: APIContext) {
  const body = await request.json();
  const { taskId, progress, data = {} } = body;

  if (!taskId) {
    return withCORS(NextResponse.json({ error: 'Missing taskId' }, { status: 400 }));
  }

  console.log(`[Extension API] PATCH /tasks - Progress:`, { taskId, progress });

  const supabase = createAdminClient();

  // Get current task data
  const { data: task, error: fetchError } = await supabase
    .from('tasks')
    .select('output_data, status')
    .eq('id', taskId)
    .single();

  if (fetchError || !task) {
    console.warn(`[Extension API] Task not found for progress update: ${taskId}`);
    return withCORS(NextResponse.json({ error: 'Task not found' }, { status: 404 }));
  }

  // Only update if task is in progress
  if (task.status !== 'in_progress' && task.status !== 'extension_queued') {
    console.warn(`[Extension API] Ignoring progress for task in '${task.status}' state`);
    return withCORS(NextResponse.json({ 
      warning: `Task is in '${task.status}' state, progress ignored` 
    }));
  }

  // Update with progress and heartbeat
  const newOutputData = {
    ...(task.output_data as Record<string, unknown> || {}),
    ...data,
    progress_info: progress,
    last_heartbeat: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from('tasks')
    .update({ output_data: newOutputData })
    .eq('id', taskId);

  if (updateError) {
    console.error(`[Extension API] Failed to update progress:`, updateError);
    return withCORS(NextResponse.json({ error: updateError.message }, { status: 500 }));
  }

  return withCORS(successResponse({ success: true }));
}

// ============================================
// ROUTE HANDLERS
// ============================================

export const GET = withExtensionAuth(handleGetTask);
export const POST = withExtensionAuth(handleSubmitResult);
export const PATCH = withExtensionAuth(handleUpdateProgress);

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
