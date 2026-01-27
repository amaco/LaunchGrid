'use server'

/**
 * Update Project Server Action
 * 
 * Following the constitution:
 * - Uses service layer
 * - Validates all inputs
 * - Emits events
 */

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { ProjectService, createServiceContext } from '@/lib/services'
import { validateInput, updateProjectSchema, uuidSchema } from '@/lib/core/validation'
import { logDataChange } from '@/lib/events/audit-logger'
import { AuthenticationError } from '@/lib/core/errors'

export async function updateProjectContextAction(projectId: string, formData: FormData) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // Validate project ID
    const validatedId = validateInput(uuidSchema, projectId)

    // Parse form data
    const rawData = {
        name: formData.get('name') as string,
        description: formData.get('description') as string,
        audience: formData.get('audience') as string,
        painPoints: formData.get('painPoints') as string,
        budget: parseInt(formData.get('budget') as string) || 0,
        aiProvider: formData.get('aiProvider') as string,
    }

    // Validate input
    const validated = validateInput(updateProjectSchema, rawData)

    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )

    const projectService = new ProjectService(serviceContext)

    // Get existing project for change tracking
    const existing = await projectService.getById(validatedId)

    // Update project
    const updated = await projectService.update(validatedId, validated)

    // Build changes object for audit
    const changes: Record<string, { old: unknown; new: unknown }> = {}
    if (validated.name && validated.name !== existing.name) {
        changes.name = { old: existing.name, new: validated.name }
    }
    if (validated.description && validated.description !== existing.context.description) {
        changes.description = { old: existing.context.description, new: validated.description }
    }
    if (validated.budget !== undefined && validated.budget !== existing.context.budget) {
        changes.budget = { old: existing.context.budget, new: validated.budget }
    }

    // Audit log if there were changes
    if (Object.keys(changes).length > 0) {
        await logDataChange(
            {
                organizationId: user.id,
                userId: user.id,
                requestId,
            },
            'UPDATE_PROJECT',
            'project',
            projectId,
            changes
        )
    }

    revalidatePath(`/dashboard/project/${projectId}`)
}
