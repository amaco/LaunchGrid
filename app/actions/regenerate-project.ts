'use server'

/**
 * Regenerate Project Strategy Server Action
 * 
 * Following the constitution:
 * - Uses service layer
 * - Event-driven
 * - Full audit trail
 */

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { ProjectService, AIService, createServiceContext } from '@/lib/services'
import { validateInput, uuidSchema } from '@/lib/core/validation'
import { emitProjectEvent } from '@/lib/events/event-bus'
import { logUserAction } from '@/lib/events/audit-logger'
import { createDefaultWorkflowSteps } from '@/utils/workflow-utils'
import { AuthenticationError } from '@/lib/core/errors'
import type { AIProviderID } from '@/lib/core/types'

export async function regenerateStrategyAction(projectId: string) {
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
    const aiService = new AIService(serviceContext)

    // 1. Fetch Project & Context
    const project = await projectService.getById(validatedId)
    const context = project.context || {}
    const providerId = (context.aiProvider as AIProviderID) || 'gemini'

    // 2. Generate New Blueprint
    let blueprint
    try {
        blueprint = await aiService.generateBlueprint(
            {
                name: project.name,
                description: context.description || '',
                audience: context.audience || '',
                painPoints: context.painPoints || '',
                budget: context.budget || 0,
            },
            providerId
        )
    } catch (e: any) {
        console.error("Regeneration Error", e)
        throw new Error(`AI Generation Failed: ${e.message}`)
    }

    // 3. Delete old strategy (pillars cascade to workflows and steps)
    const { error: deleteError } = await supabase
        .from('pillars')
        .delete()
        .eq('project_id', validatedId)

    if (deleteError) {
        throw new Error("Failed to clear old strategy")
    }

    // 4. Save New Pillars & Workflows
    const pillarMap = new Map<string, string>()

    for (const p of blueprint.activePillars) {
        const { data: pillar } = await supabase
            .from('pillars')
            .insert({
                project_id: project.id,
                type: p.type,
                name: p.name,
                status: 'active'
            })
            .select()
            .single()

        if (pillar) pillarMap.set(p.id, pillar.id)
    }

    // 5. Save Workflows
    for (const wf of blueprint.workflows) {
        const pillarDef = blueprint.activePillars.find(p => p.id === wf.pillarRef)
        const pillarType = pillarDef ? pillarDef.type : 'custom'
        const dbPillarId = pillarMap.get(wf.pillarRef)

        if (dbPillarId) {
            const { data: wfEntry } = await supabase
                .from('workflows')
                .insert({
                    project_id: project.id,
                    pillar_id: dbPillarId,
                    name: wf.name,
                    description: wf.description,
                    status: 'active',
                    config: {
                        requiresApproval: true,
                        maxRetries: 3,
                        timeout: 30000,
                    }
                })
                .select()
                .single()

            if (wfEntry) {
                await createDefaultWorkflowSteps(supabase, wfEntry.id, pillarType, { 
                    name: wf.name, 
                    goal: wf.goal 
                })
            }
        }
    }

    // 6. Emit event
    await emitProjectEvent(
        'BLUEPRINT_REGENERATED',
        project.id,
        {
            pillarCount: blueprint.activePillars.length,
            workflowCount: blueprint.workflows.length,
            provider: providerId,
        },
        {
            organizationId: user.id,
            userId: user.id,
            correlationId: requestId,
            source: 'ui',
        }
    )

    // 7. Audit log
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'REGENERATE_STRATEGY',
        'project',
        projectId,
        {
            pillarCount: blueprint.activePillars.length,
            workflowCount: blueprint.workflows.length,
        }
    )

    revalidatePath(`/dashboard/project/${projectId}`)
}
