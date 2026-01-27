'use server'

/**
 * Manage Steps Server Actions
 * 
 * Following the constitution:
 * - Workflows are declarative, not hardcoded
 * - Emits events for all important actions
 */

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { WorkflowService, createServiceContext } from '@/lib/services'
import { validateInput, reorderStepsSchema, uuidSchema, stepTypeSchema } from '@/lib/core/validation'
import { logUserAction } from '@/lib/events/audit-logger'
import { AuthenticationError } from '@/lib/core/errors'
import type { StepType } from '@/lib/core/types'

export async function addStepAction(workflowId: string, type: string, position: number) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // Validate inputs
    const validatedWorkflowId = validateInput(uuidSchema, workflowId)
    const validatedType = validateInput(stepTypeSchema, type) as StepType

    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )

    const workflowService = new WorkflowService(serviceContext)

    // Add step using service
    const step = await workflowService.addStep({
        workflowId: validatedWorkflowId,
        type: validatedType,
        position,
        config: {},
    })

    // Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'ADD_STEP',
        'step',
        step.id,
        { workflowId, type, position }
    )

    // Revalidate the project page
    const workflow = await workflowService.getById(workflowId)
    revalidatePath(`/dashboard/project/${workflow.projectId}`)
}

export async function deleteStepAction(stepId: string) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    const validatedStepId = validateInput(uuidSchema, stepId)

    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )

    const workflowService = new WorkflowService(serviceContext)

    // Get step info before deletion for revalidation
    const { data: step } = await supabase
        .from('steps')
        .select('workflow_id, workflow:workflows(project_id)')
        .eq('id', validatedStepId)
        .single()

    // Delete step using service
    await workflowService.removeStep(validatedStepId)

    // Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'DELETE_STEP',
        'step',
        stepId,
        {}
    )

    // Revalidate
    if (step?.workflow) {
        revalidatePath(`/dashboard/project/${(step.workflow as any).project_id}`)
    }
}

export async function reorderStepsAction(steps: { id: string, position: number }[]) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // Validate input
    const validated = validateInput(reorderStepsSchema, steps)

    if (validated.length === 0) return

    // Get workflow ID from first step
    const { data: firstStep } = await supabase
        .from('steps')
        .select('workflow_id, workflow:workflows(project_id)')
        .eq('id', validated[0].id)
        .single()

    if (!firstStep) throw new Error('Step not found')

    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )

    const workflowService = new WorkflowService(serviceContext)

    // Reorder steps
    await workflowService.reorderSteps(firstStep.workflow_id, validated)

    // Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'REORDER_STEPS',
        'workflow',
        firstStep.workflow_id,
        { stepCount: validated.length }
    )

    // Revalidate
    revalidatePath(`/dashboard/project/${(firstStep.workflow as any).project_id}`)
}

export async function updateStepConfigAction(
    stepId: string, 
    config: Record<string, unknown>
) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    const validatedStepId = validateInput(uuidSchema, stepId)

    // Get step and verify ownership
    const { data: step, error: stepError } = await supabase
        .from('steps')
        .select('*, workflow:workflows(project_id, project:projects(user_id))')
        .eq('id', validatedStepId)
        .single()

    if (stepError || !step) {
        throw new Error('Step not found')
    }

    if ((step.workflow as any).project.user_id !== user.id) {
        throw new AuthenticationError('Access denied')
    }

    // Update config
    const { error } = await supabase
        .from('steps')
        .update({ config })
        .eq('id', validatedStepId)

    if (error) {
        throw new Error(`Failed to update step config: ${error.message}`)
    }

    // Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'UPDATE_STEP_CONFIG',
        'step',
        stepId,
        { configKeys: Object.keys(config) }
    )

    revalidatePath(`/dashboard/project/${(step.workflow as any).project_id}`)
}
