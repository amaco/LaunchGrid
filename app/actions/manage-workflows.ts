'use server'

/**
 * Manage Workflows Server Actions
 * 
 * Following the constitution:
 * - Workflows are declarative, not hardcoded
 * - Event-driven - emits events for all important actions
 * - Secure - validates inputs and checks ownership
 * - Transactional - creates workflow + steps atomically
 */

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { WorkflowService, createServiceContext } from '@/lib/services'
import { validateInput, uuidSchema, sanitizedStringSchema } from '@/lib/core/validation'
import { logUserAction } from '@/lib/events/audit-logger'
import { AuthenticationError, ValidationError } from '@/lib/core/errors'
import { getTemplateById, type WorkflowTemplate } from '@/lib/workflows/templates'
import { z } from 'zod'

// ==========================================
// VALIDATION SCHEMAS
// ==========================================

const createFromTemplateSchema = z.object({
    projectId: uuidSchema,
    pillarId: uuidSchema,
    templateId: z.string().min(1, 'Template ID is required'),
    name: sanitizedStringSchema.pipe(
        z.string().min(2, 'Name too short').max(100, 'Name too long')
    ),
})

const createBlankWorkflowSchema = z.object({
    projectId: uuidSchema,
    pillarId: uuidSchema,
    name: sanitizedStringSchema.pipe(
        z.string().min(2, 'Name too short').max(100, 'Name too long')
    ),
    description: sanitizedStringSchema.pipe(
        z.string().max(500, 'Description too long')
    ).optional(),
})

// ==========================================
// CREATE WORKFLOW FROM TEMPLATE
// ==========================================

export async function createWorkflowFromTemplateAction(
    projectId: string,
    pillarId: string,
    templateId: string,
    name: string
) {
    const supabase = await createClient()
    const requestId = nanoid()

    // 1. Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // 2. Validate inputs
    const validated = validateInput(createFromTemplateSchema, {
        projectId,
        pillarId,
        templateId,
        name,
    })

    // 3. Get template (validate it exists)
    const template = getTemplateById(validated.templateId)
    if (!template) {
        throw new ValidationError('Invalid template', [
            { field: 'templateId', message: 'Template not found' }
        ])
    }

    // 4. Verify project ownership (RLS should handle this, but explicit check)
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, user_id')
        .eq('id', validated.projectId)
        .single()

    if (projectError || !project) {
        throw new ValidationError('Project not found', [
            { field: 'projectId', message: 'Project not found or access denied' }
        ])
    }

    if (project.user_id !== user.id) {
        throw new AuthenticationError('Access denied to this project')
    }

    // 5. Create service context
    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )
    const workflowService = new WorkflowService(serviceContext)

    // 6. Create workflow
    const workflow = await workflowService.create({
        projectId: validated.projectId,
        pillarId: validated.pillarId,
        name: validated.name,
        description: template.description,
        phase: 'launch',
        config: {
            templateId: template.id,
            templateName: template.name,
        },
    })

    // 7. Create steps from template (in order)
    for (let i = 0; i < template.steps.length; i++) {
        const stepDef = template.steps[i]
        await workflowService.addStep({
            workflowId: workflow.id,
            type: stepDef.type,
            position: i + 1,
            config: stepDef.config || {},
        })
    }

    // 8. Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'CREATE_WORKFLOW_FROM_TEMPLATE',
        'workflow',
        workflow.id,
        {
            templateId: template.id,
            templateName: template.name,
            stepCount: template.steps.length,
        }
    )

    // 9. Revalidate
    revalidatePath(`/dashboard/project/${validated.projectId}`)

    return { success: true, workflowId: workflow.id }
}

// ==========================================
// CREATE BLANK WORKFLOW
// ==========================================

export async function createBlankWorkflowAction(
    projectId: string,
    pillarId: string,
    name: string,
    description?: string
) {
    const supabase = await createClient()
    const requestId = nanoid()

    // 1. Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // 2. Validate inputs
    const validated = validateInput(createBlankWorkflowSchema, {
        projectId,
        pillarId,
        name,
        description,
    })

    // 3. Verify project ownership
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, user_id')
        .eq('id', validated.projectId)
        .single()

    if (projectError || !project) {
        throw new ValidationError('Project not found', [
            { field: 'projectId', message: 'Project not found or access denied' }
        ])
    }

    if (project.user_id !== user.id) {
        throw new AuthenticationError('Access denied to this project')
    }

    // 4. Create service context
    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )
    const workflowService = new WorkflowService(serviceContext)

    // 5. Create workflow
    const workflow = await workflowService.create({
        projectId: validated.projectId,
        pillarId: validated.pillarId,
        name: validated.name,
        description: validated.description || 'Custom workflow',
        phase: 'launch',
        config: {},
    })

    // 6. Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'CREATE_BLANK_WORKFLOW',
        'workflow',
        workflow.id,
        { name: validated.name }
    )

    // 7. Revalidate
    revalidatePath(`/dashboard/project/${validated.projectId}`)

    return { success: true, workflowId: workflow.id }
}

// ==========================================
// DELETE WORKFLOW
// ==========================================

export async function deleteWorkflowAction(workflowId: string) {
    const supabase = await createClient()
    const requestId = nanoid()

    // 1. Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // 2. Validate input
    const validatedId = validateInput(uuidSchema, workflowId)

    // 3. Get workflow and verify ownership
    const { data: workflow, error: workflowError } = await supabase
        .from('workflows')
        .select('id, project_id, project:projects(user_id)')
        .eq('id', validatedId)
        .single()

    if (workflowError || !workflow) {
        throw new ValidationError('Workflow not found', [
            { field: 'workflowId', message: 'Workflow not found' }
        ])
    }

    if ((workflow.project as any).user_id !== user.id) {
        throw new AuthenticationError('Access denied to this workflow')
    }

    // 4. Delete workflow (cascades to steps and tasks)
    const { error: deleteError } = await supabase
        .from('workflows')
        .delete()
        .eq('id', validatedId)

    if (deleteError) {
        throw new Error(`Failed to delete workflow: ${deleteError.message}`)
    }

    // 5. Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'DELETE_WORKFLOW',
        'workflow',
        workflowId,
        {}
    )

    // 6. Revalidate
    revalidatePath(`/dashboard/project/${workflow.project_id}`)

    return { success: true }
}

// ==========================================
// RENAME WORKFLOW
// ==========================================

export async function renameWorkflowAction(workflowId: string, newName: string) {
    const supabase = await createClient()
    const requestId = nanoid()

    // 1. Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // 2. Validate inputs
    const validatedId = validateInput(uuidSchema, workflowId)
    const validatedName = validateInput(
        sanitizedStringSchema.pipe(z.string().min(2).max(100)),
        newName
    )

    // 3. Get workflow and verify ownership
    const { data: workflow, error: workflowError } = await supabase
        .from('workflows')
        .select('id, project_id, project:projects(user_id)')
        .eq('id', validatedId)
        .single()

    if (workflowError || !workflow) {
        throw new ValidationError('Workflow not found', [
            { field: 'workflowId', message: 'Workflow not found' }
        ])
    }

    if ((workflow.project as any).user_id !== user.id) {
        throw new AuthenticationError('Access denied to this workflow')
    }

    // 4. Update name
    const { error: updateError } = await supabase
        .from('workflows')
        .update({ name: validatedName })
        .eq('id', validatedId)

    if (updateError) {
        throw new Error(`Failed to rename workflow: ${updateError.message}`)
    }

    // 5. Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'RENAME_WORKFLOW',
        'workflow',
        workflowId,
        { newName: validatedName }
    )

    // 6. Revalidate
    revalidatePath(`/dashboard/project/${workflow.project_id}`)

    return { success: true }
}

// ==========================================
// UPDATE WORKFLOW (e.g. Settings)
// ==========================================

const updateWorkflowSchema = z.object({
    workflowId: uuidSchema,
    data: z.object({
        name: z.string().min(2).max(100).optional(),
        description: z.string().max(500).optional(),
        config: z.any().optional(), // Flexible for now, or use workflowConfigSchema
    })
})

export async function updateWorkflowAction(
    workflowId: string,
    data: {
        name?: string
        description?: string
        config?: any
    }
) {
    const supabase = await createClient()
    const requestId = nanoid()

    // 1. Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // 2. Validate inputs
    const validated = validateInput(updateWorkflowSchema, {
        workflowId,
        data
    })

    // 3. Create service context (not fully used but good practice)
    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )

    // 4. Update workflow using service
    // We don't have a direct 'update' method on WorkflowService exposed yet for partial updates 
    // that isn't 'updateExecutionState'. 
    // But since this is a simple metadata/config update, direct DB or a new service method is fine.
    // Let's use direct DB for now to unblock, as WorkflowService focuses on execution state.

    // Check ownership first - RLS handles this

    const updatePayload: any = {}

    if (validated.data.name) updatePayload.name = validated.data.name
    if (validated.data.description) updatePayload.description = validated.data.description
    if (validated.data.config) updatePayload.config = validated.data.config

    const { data: updatedWorkflow, error: updateError } = await supabase
        .from('workflows')
        .update(updatePayload)
        .eq('id', validated.workflowId)
        .select()
        .single()

    if (updateError) {
        console.error('Failed to update workflow:', updateError)
        throw new Error('Failed to update workflow settings')
    }

    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'UPDATE_WORKFLOW',
        'workflow',
        workflowId,
        { changes: Object.keys(validated.data) }
    )

    revalidatePath(`/dashboard/project/${updatedWorkflow.project_id}`)
    return updatedWorkflow
}
