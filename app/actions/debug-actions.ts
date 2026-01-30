'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { EngagementService } from '@/lib/services/engagement-service'

export async function retriggerEngagementAction(workflowId: string) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        throw new Error('Unauthorized')
    }

    // 1. Get workflow tasks that are POST types and COMPLETED
    // 1. Get workflow tasks that are POST types and COMPLETED
    // We need to join with 'steps' because 'tasks' doesn't have 'workflow_id'
    const { data: tasks, error } = await supabase
        .from('tasks')
        .select(`
            *,
            step:steps!inner (
                workflow_id,
                type
            )
        `)
        .eq('step.workflow_id', workflowId)
        .eq('status', 'completed')
        .in('step.type', ['POST_REPLY', 'POST_EXTENSION', 'POST_API'])

    if (error) throw new Error(`Failed to fetch tasks: ${error.message}`)
    if (!tasks || tasks.length === 0) {
        throw new Error('No completed posting tasks found in this workflow.')
    }

    // 2. Initialize Service with CORRECT context (Fixing previous bugs)
    const engagementService = new EngagementService({
        supabase,
        tenant: {
            organizationId: user.id, // Simplification for now, assuming 1:1
            userId: user.id,
            role: 'owner'
        },
        requestId: `debug-${Date.now()}`,
        ipAddress: '0.0.0.0',
        userAgent: 'Manual Debug Trigger'
    })

    let queuedCount = 0

    // 3. Loop and create jobs
    for (const task of tasks) {
        const results = task.output_data?.results || []

        if (!Array.isArray(results)) continue

        for (const res of results) {
            if (res.success && res.url) {
                try {
                    await engagementService.createJob({
                        projectId: task.project_id,
                        targetUrl: res.url,
                        sourceTaskId: task.id,
                        durationDays: 7
                    })
                    queuedCount++
                } catch (e: any) {
                    console.error(`[ManualTrigger] Failed to create job for ${res.url}:`, e.message)
                    // Continue to next...
                }
            }
        }
    }

    revalidatePath('/dashboard')
    return { success: true, count: queuedCount }
}
