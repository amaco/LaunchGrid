'use server'

/**
 * Create Project Server Action
 * 
 * Following the constitution:
 * - Uses service layer with proper boundaries
 * - Emits events for all important actions
 * - Validates all inputs
 */

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { nanoid } from 'nanoid'
import { ProjectService, AIService, createServiceContext } from '@/lib/services'
import { validateInput, createProjectSchema } from '@/lib/core/validation'
import { emitProjectEvent } from '@/lib/events/event-bus'
import { logUserAction } from '@/lib/events/audit-logger'
import { createDefaultWorkflowSteps } from '@/utils/workflow-utils'
import type { AIProviderID } from '@/lib/core/types'

export async function createProjectAction(formData: FormData) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    // Parse form data
    const rawData = {
        name: formData.get('name') as string,
        description: formData.get('description') as string,
        audience: formData.get('audience') as string,
        painPoints: formData.get('painPoints') as string,
        budget: parseInt(formData.get('budget') as string) || 0,
        aiProvider: (formData.get('aiProvider') as AIProviderID) || 'gemini',
    }

    // Validate input
    const validated = validateInput(createProjectSchema, rawData)

    // Create service context
    const serviceContext = createServiceContext(
        supabase,
        user,
        user.id, // Use user.id as org until multi-tenancy
        { requestId }
    )

    const projectService = new ProjectService(serviceContext)
    const aiService = new AIService(serviceContext)

    // 1. Create Project Entry
    const project = await projectService.create(validated)

    // 2. Generate AI Strategy
    let blueprint
    try {
        blueprint = await aiService.generateBlueprint(
            {
                name: validated.name,
                description: validated.description,
                audience: validated.audience,
                painPoints: validated.painPoints,
                budget: validated.budget,
            },
            validated.aiProvider
        )
    } catch (e: any) {
        console.error("AI Error", e)
        // ROLLBACK: Delete the empty project we just created
        await projectService.delete(project.id)
        throw new Error(`AI Strategy Generation Failed using ${validated.aiProvider}. Project creation rolled back. Check your API Key in Settings.`)
    }

    // 3. Save Pillars
    const pillarMap = new Map<string, string>()

    for (const p of blueprint.activePillars) {
        const { data: pillar, error } = await supabase
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

    // 4. Save Workflows
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

    // 5. Emit event for blueprint generation
    await emitProjectEvent(
        'BLUEPRINT_GENERATED',
        project.id,
        {
            pillarCount: blueprint.activePillars.length,
            workflowCount: blueprint.workflows.length,
        },
        {
            organizationId: user.id,
            userId: user.id,
            correlationId: requestId,
            source: 'ui',
        }
    )

    // 6. Log action
    await logUserAction(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'CREATE_PROJECT_WITH_BLUEPRINT',
        'project',
        project.id,
        {
            name: validated.name,
            pillarCount: blueprint.activePillars.length,
            workflowCount: blueprint.workflows.length,
        }
    )

    redirect(`/dashboard/project/${project.id}`)
}
