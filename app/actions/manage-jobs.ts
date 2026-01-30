'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { EngagementService } from '@/lib/services/engagement-service'
import { createServiceContext } from '@/lib/services/base-service'
// Wait, middleware helper might not be exportable to server actions cleanly due to request object dependency.
// We should construct ServiceContext manually or use a shared helper.

import { nanoid } from 'nanoid'

// We need a way to construct ServiceContext from server actions
// Copied pattern from execute-workflow.ts (implied)
async function getContext() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) throw new Error('Unauthorized')

    // Construct service context
    // We use user.id as organizationId for personal workspaces
    return {
        serviceContext: createServiceContext(
            supabase,
            { id: user.id },
            user.id, // organizationId
            {
                requestId: nanoid()
            }
        )
    }
}

export async function triggerJobAction(jobId: string, projectId: string) {
    const { serviceContext } = await getContext()
    const service = new EngagementService(serviceContext)

    await service.triggerNow(jobId)
    revalidatePath(`/dashboard/project/${projectId}`)
}

export async function stopJobAction(jobId: string, projectId: string) {
    const { serviceContext } = await getContext()
    const service = new EngagementService(serviceContext)

    await service.stopJob(jobId)
    revalidatePath(`/dashboard/project/${projectId}`)
}

// TODO: implementing delete if needed, for now Stop is enough
