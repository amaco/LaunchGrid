/**
 * LaunchGrid Workflow Execution API
 * 
 * Following the constitution:
 * - Event-driven: Events are the system truth
 * - Workflows are declarative, not hardcoded
 * - AI is asynchronous and stateless
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { withAIAuth, successResponse, parseJSONBody, type APIContext } from '@/lib/api/middleware';
import { WorkflowService, TaskService, AIService, createServiceContext } from '@/lib/services';
import { validateInput, uuidSchema } from '@/lib/core/validation';
import { WorkflowError, StepExecutionError } from '@/lib/core/errors';
import type { AIProviderID } from '@/lib/core/types';

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/v1/workflows/:id/execute
async function handleExecute(request: NextRequest, context: APIContext, params: { id: string }) {
  const workflowId = validateInput(uuidSchema, params.id);

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

  const workflowService = new WorkflowService(serviceContext);
  const taskService = new TaskService(serviceContext);
  const aiService = new AIService(serviceContext);

  // Get workflow execution state
  const executionState = await workflowService.getExecutionState(workflowId);
  const { workflow, nextStep } = executionState;

  if (!nextStep) {
    return successResponse({
      status: 'completed',
      message: 'Workflow is complete!',
      progress: 100,
    });
  }

  if (!nextStep.canExecute) {
    throw new WorkflowError(
      `Step is blocked by dependencies: ${nextStep.blockedBy.join(', ')}`,
      workflowId,
      { blockedBy: nextStep.blockedBy }
    );
  }

  const step = nextStep.step;

  // Get or create task for this step
  let task = await taskService.getByStepId(step.id);
  if (!task) {
    task = await taskService.create({
      stepId: step.id,
      projectId: workflow.projectId,
    });
  }

  // Mark task as started
  task = await taskService.start(task.id);

  // Get project context for AI
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', workflow.projectId)
    .single();

  if (!project) {
    throw new WorkflowError('Project not found', workflowId);
  }

  const { data: pillar } = await supabase
    .from('pillars')
    .select('*')
    .eq('id', workflow.pillarId)
    .single();

  const projectContext = project.context || {};
  const providerId = (projectContext.aiProvider as AIProviderID) || 'gemini';

  // Get previous step output for chaining
  let previousOutput: Record<string, unknown> | undefined;
  if (nextStep.completedDependencies.length > 0) {
    const prevTask = await taskService.getByStepId(nextStep.completedDependencies[0]);
    previousOutput = prevTask?.outputData;
  }

  try {
    let result: Record<string, unknown>;

    switch (step.type) {
      case 'GENERATE_DRAFT':
      case 'GENERATE_OUTLINE': {
        const content = await aiService.generateContent(
          {
            project: {
              name: project.name,
              description: projectContext.description || '',
              audience: projectContext.audience || 'General Audience',
              painPoints: projectContext.painPoints || '',
              budget: projectContext.budget || 0,
            },
            pillarName: pillar?.name || 'Unknown',
            workflowName: workflow.name,
            workflowDescription: workflow.description || '',
            stepConfig: step.config,
            previousOutput,
          },
          providerId
        );
        result = content as unknown as Record<string, unknown>;
        break;
      }

      case 'SCAN_FEED': {
        // Queue for browser extension (human-in-the-loop)
        await taskService.queueForExtension(task.id);
        return successResponse({
          status: 'extension_queued',
          message: 'Task queued for browser extension',
          taskId: task.id,
        });
      }

      case 'SELECT_TARGETS': {
        // AI selects from previous scan results
        const foundItems = (previousOutput as any)?.found_items || [];
        result = {
          selected_items: foundItems,
          rationale: 'Selected all high-relevance items.',
        };
        break;
      }

      case 'GENERATE_REPLIES': {
        const targets = (previousOutput as any)?.selected_items || [];
        if (targets.length === 0) {
          throw new StepExecutionError('No targets to reply to', step.id, step.type);
        }

        const replies = await aiService.generateReplies(
          {
            project: {
              name: project.name,
              description: projectContext.description || '',
              audience: projectContext.audience || '',
              painPoints: projectContext.painPoints || '',
              budget: projectContext.budget || 0,
            },
            pillarName: pillar?.name || 'Unknown',
            workflowName: workflow.name,
            workflowDescription: workflow.description || '',
            stepConfig: step.config,
          },
          targets,
          providerId
        );

        result = {
          replies,
          title: `Drafted ${replies.length} Replies`,
        };
        break;
      }

      case 'REVIEW_CONTENT':
      case 'WAIT_APPROVAL': {
        // Human-in-the-loop: mark for review
        await taskService.markForReview(task.id, previousOutput || {});
        return successResponse({
          status: 'awaiting_approval',
          message: 'Content ready for review',
          taskId: task.id,
        });
      }

      case 'POST_API':
      case 'POST_REPLY':
      case 'POST_EXTENSION': {
        // Human-in-the-loop: queue for approval before posting
        await taskService.markForReview(task.id, {
          ...previousOutput,
          pendingAction: step.type,
        });
        return successResponse({
          status: 'awaiting_approval',
          message: 'Ready to post - awaiting approval',
          taskId: task.id,
        });
      }

      default:
        throw new StepExecutionError(
          `Step type ${step.type} not implemented`,
          step.id,
          step.type
        );
    }

    // Mark task for review (human-in-the-loop principle)
    await taskService.markForReview(task.id, result);

    return successResponse({
      status: 'review_needed',
      message: 'Step completed - ready for review',
      taskId: task.id,
      output: result,
    });
  } catch (error: any) {
    // Mark task as failed
    await taskService.fail(task.id, error.message);
    throw error;
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return withAIAuth(async (req, ctx) => handleExecute(req, ctx, { id }))(request);
}
