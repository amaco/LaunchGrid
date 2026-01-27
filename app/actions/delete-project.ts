'use server'

/**
 * Delete Project Server Action
 * 
 * Following the constitution:
 * - Uses service layer
 * - Emits events
 * - Full audit trail
 */

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { ProjectService, createServiceContext } from '@/lib/services'
import { validateInput, uuidSchema } from '@/lib/core/validation'
import { logUserAction } from '@/lib/events/audit-logger'
import { AuthenticationError } from '@/lib/core/errors'

export async function deleteProjectAction(projectId: string) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // Validate input
    const validatedId = validateInput(uuidSchema, projectId)

    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id,
        { requestId }
    )

    const projectService = new ProjectService(serviceContext)

    // Get project name for audit before deletion
    const project = await projectService.getById(validatedId)

    // Delete project (cascades to all related data)
    await projectService.delete(validatedId)

    // Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'DELETE_PROJECT',
        'project',
        projectId,
        { name: project.name }
    )

    revalidatePath('/dashboard')
}
