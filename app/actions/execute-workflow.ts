'use server'

/**
 * Execute Workflow Server Action
 * 
 * Following the constitution:
 * - Uses service layer with proper boundaries
 * - Event-driven execution
 * - Human-in-the-loop for social posting
 * - Workflows are declarative, not hardcoded
 */

import { createClient } from '@/utils/supabase/server'
import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { WorkflowService, TaskService, AIService, createServiceContext } from '@/lib/services'
import { emitWorkflowEvent, emitTaskEvent } from '@/lib/events/event-bus'
import { logUserAction } from '@/lib/events/audit-logger'
import { WorkflowError, StepExecutionError } from '@/lib/core/errors'
import type { AIProviderID } from '@/lib/core/types'

export async function executeWorkflowAction(workflowId: string) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    // Create service context
    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )

    const workflowService = new WorkflowService(serviceContext)
    const taskService = new TaskService(serviceContext)
    const aiService = new AIService(serviceContext)

    // 1. Get workflow execution state
    const executionState = await workflowService.getExecutionState(workflowId)
    const { workflow, nextStep, steps } = executionState

    // Log execution attempt
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'EXECUTE_WORKFLOW',
        'workflow',
        workflowId,
        {
            progress: executionState.progress,
            hasNextStep: !!nextStep,
        }
    )

    // 2. Check if workflow is complete
    if (!nextStep) {
        await emitWorkflowEvent(
            'WORKFLOW_COMPLETED',
            workflowId,
            { progress: 100 },
            {
                organizationId: user.id,
                userId: user.id,
                correlationId: requestId,
                source: 'ui',
            }
        )
        return { message: "Workflow is complete!" }
    }

    // 3. Check if step can be executed
    if (!nextStep.canExecute) {
        throw new WorkflowError(
            `Step blocked by dependencies: ${nextStep.blockedBy.join(', ')}`,
            workflowId,
            { blockedBy: nextStep.blockedBy }
        )
    }

    const targetStep = nextStep.step
    console.log(`[Workflow] Executing step: ${targetStep.type} (${targetStep.id})`)

    // 4. Get or create task for this step
    let task = await taskService.getByStepId(targetStep.id)
    if (!task) {
        task = await taskService.create({
            stepId: targetStep.id,
            projectId: workflow.projectId,
        })
    }

    // Start task
    task = await taskService.start(task.id)

    // 5. Fetch project and pillar context
    const { data: project } = await supabase
        .from('projects')
        .select('*')
        .eq('id', workflow.projectId)
        .single()

    if (!project) throw new WorkflowError('Project not found', workflowId)

    const { data: pillar } = await supabase
        .from('pillars')
        .select('*')
        .eq('id', workflow.pillarId)
        .single()

    const context = project.context || {}
    const providerId = (context.aiProvider as AIProviderID) || 'gemini'

    // 6. Get previous step output for chaining
    let previousStepOutput: Record<string, unknown> | undefined
    if (nextStep.completedDependencies.length > 0) {
        const prevTask = await taskService.getByStepId(nextStep.completedDependencies[0])
        previousStepOutput = prevTask?.outputData
    } else {
        // Find previous positional step
        const prevStepIdx = steps.findIndex(s => s.id === targetStep.id) - 1
        if (prevStepIdx >= 0) {
            const prevTask = await taskService.getByStepId(steps[prevStepIdx].id)
            previousStepOutput = prevTask?.outputData
        }
    }

    // 7. Execute step based on type
    let resultData: Record<string, unknown>

    try {
        switch (targetStep.type) {
            case 'GENERATE_DRAFT':
            case 'GENERATE_OUTLINE': {
                const content = await aiService.generateContent(
                    {
                        project: {
                            name: project.name,
                            description: context.description || '',
                            audience: context.audience || 'General Audience',
                            painPoints: context.painPoints || '',
                            budget: context.budget || 0,
                        },
                        pillarName: pillar?.name || 'Unknown',
                        workflowName: workflow.name,
                        workflowDescription: workflow.description || '',
                        stepConfig: targetStep.config,
                        previousOutput: previousStepOutput,
                    },
                    providerId
                )
                resultData = content as unknown as Record<string, unknown>
                break
            }

            case 'SCAN_FEED': {
                // Queue for browser extension (human-in-the-loop)
                await taskService.queueForExtension(task.id)

                await emitTaskEvent(
                    'EXTENSION_TASK_QUEUED',
                    task.id,
                    { stepType: 'SCAN_FEED' },
                    {
                        organizationId: user.id,
                        userId: user.id,
                        correlationId: requestId,
                        source: 'ui',
                    }
                )

                revalidatePath(`/dashboard/project/${project.id}`)
                return { 
                    pending_extension: true, 
                    message: 'Task queued for browser extension' 
                }
            }

            case 'SELECT_TARGETS': {
                const foundItems = (previousStepOutput as any)?.found_items || []
                resultData = {
                    is_mock: (previousStepOutput as any)?.is_mock || false,
                    selected_items: foundItems,
                    rationale: 'Selected all high-relevance items.',
                }
                break
            }

            case 'GENERATE_REPLIES': {
                const targets = (previousStepOutput as any)?.selected_items || []
                
                if (targets.length === 0) {
                    throw new StepExecutionError(
                        'No targets to reply to',
                        targetStep.id,
                        targetStep.type
                    )
                }

                // Check if mock data - skip AI call
                if ((previousStepOutput as any)?.is_mock) {
                    console.log('[Workflow] Skipping AI call for mock data')
                    resultData = {
                        is_mock: true,
                        replies: targets.map((t: any) => ({
                            target_id: t.id,
                            reply: `(Simulated Reply) Hey ${t.author}, have you tried using a journal? It helps!`
                        })),
                        title: `Drafted ${targets.length} Replies (SIMULATED)`
                    }
                    break
                }

                // Real AI execution
                const replies = await aiService.generateReplies(
                    {
                        project: {
                            name: project.name,
                            description: context.description || '',
                            audience: context.audience || '',
                            painPoints: context.painPoints || '',
                            budget: context.budget || 0,
                        },
                        pillarName: pillar?.name || 'Unknown',
                        workflowName: workflow.name,
                        workflowDescription: workflow.description || '',
                        stepConfig: targetStep.config,
                    },
                    targets,
                    providerId
                )

                resultData = {
                    replies,
                    title: `Drafted ${replies.length} Replies`,
                }
                break
            }

            case 'REVIEW_CONTENT':
            case 'WAIT_APPROVAL': {
                // Human-in-the-loop: mark for review
                await taskService.markForReview(task.id, previousStepOutput || {})
                
                revalidatePath(`/dashboard/project/${project.id}`)
                return {
                    awaiting_approval: true,
                    message: 'Content ready for review',
                }
            }

            case 'POST_API':
            case 'POST_REPLY':
            case 'POST_EXTENSION': {
                // Human-in-the-loop: require approval before posting
                await taskService.markForReview(task.id, {
                    ...previousStepOutput,
                    pending_action: targetStep.type,
                    message: 'Ready to post - awaiting approval',
                })
                
                revalidatePath(`/dashboard/project/${project.id}`)
                return {
                    awaiting_approval: true,
                    message: 'Ready to post - awaiting approval',
                }
            }

            default:
                throw new StepExecutionError(
                    `Step type ${targetStep.type} not implemented yet`,
                    targetStep.id,
                    targetStep.type
                )
        }

        // 8. Mark task for review (human-in-the-loop principle)
        await taskService.markForReview(task.id, resultData)

        // 9. Emit step completed event
        await emitTaskEvent(
            'TASK_COMPLETED',
            task.id,
            {
                stepType: targetStep.type,
                hasOutput: !!resultData,
            },
            {
                organizationId: user.id,
                userId: user.id,
                correlationId: requestId,
                source: 'ui',
            }
        )

        revalidatePath(`/dashboard/project/${project.id}`)
        return resultData

    } catch (e: any) {
        console.error('[Workflow] Execution failed:', e)
        
        // Mark task as failed
        await taskService.fail(task.id, e.message)

        // Emit failure event
        await emitTaskEvent(
            'TASK_FAILED',
            task.id,
            {
                stepType: targetStep.type,
                error: e.message,
            },
            {
                organizationId: user.id,
                userId: user.id,
                correlationId: requestId,
                source: 'ui',
            }
        )

        throw new Error(`Execution Failed: ${e.message}`)
    }
}

/**
 * Approve a task (human-in-the-loop)
 */
export async function approveTaskAction(taskId: string) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )

    const taskService = new TaskService(serviceContext)
    const task = await taskService.approve(taskId)

    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'APPROVE_TASK',
        'task',
        taskId,
        {}
    )

    // Get project ID to revalidate
    const { data: taskData } = await supabase
        .from('tasks')
        .select('project_id')
        .eq('id', taskId)
        .single()

    if (taskData) {
        revalidatePath(`/dashboard/project/${taskData.project_id}`)
    }

    return { success: true }
}

/**
 * Reject a task (human-in-the-loop)
 */
export async function rejectTaskAction(taskId: string, reason: string) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )

    const taskService = new TaskService(serviceContext)
    await taskService.reject(taskId, reason)

    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'REJECT_TASK',
        'task',
        taskId,
        { reason }
    )

    // Get project ID to revalidate
    const { data: taskData } = await supabase
        .from('tasks')
        .select('project_id')
        .eq('id', taskId)
        .single()

    if (taskData) {
        revalidatePath(`/dashboard/project/${taskData.project_id}`)
    }

    return { success: true }
}
