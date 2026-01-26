'use server'

import { createClient } from '@/utils/supabase/server'
import { AIFactory, AIProviderID } from '@/utils/ai/factory'
import { decrypt } from '@/utils/encryption'
import { revalidatePath } from 'next/cache'
import { createDefaultWorkflowSteps } from '@/utils/workflow-utils'

export async function regenerateStrategyAction(projectId: string) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    // 1. Fetch Project & Context
    const { data: project } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()

    if (!project) throw new Error('Project not found')

    const context = project.context || {}
    const providerId = (context.aiProvider as AIProviderID) || 'gemini'

    // 2. Fetch Secrets
    const { data: secrets } = await supabase
        .from('user_secrets')
        .select('*')
        .eq('user_id', user.id)
        .single();

    // Decrypt API Key
    const userApiKey = secrets && secrets[`${providerId}_key`]
        ? decrypt(secrets[`${providerId}_key`])
        : undefined;

    // 3. Generate New Blueprint
    let blueprint;
    try {
        const provider = AIFactory.getProvider(providerId);
        // Reuse the same context structure
        blueprint = await provider.generateBlueprint({
            name: project.name,
            description: context.description,
            audience: context.audience,
            painPoints: context.painPoints,
            budget: context.budget
        }, userApiKey);
    } catch (e: any) {
        console.error("Regeneration Error", e)
        throw new Error(`AI Generation Failed: ${e.message}`)
    }

    // 4. Wipe Old Strategy (Cascading delete via Pillars? No, manually to be safe or just delete pillars)
    // Pillars cascade delete workflows, so deleting pillars is enough.
    // However, we want to keep the PROJECT.

    // Check constraint: triggers? RLS?
    // Let's delete all pillars for this project.
    const { error: deleteError } = await supabase
        .from('pillars')
        .delete()
        .eq('project_id', projectId)

    if (deleteError) throw new Error("Failed to clear old strategy")

    // 5. Save New Pillars & Workflows (Duplicate logic from create-project, should be shared function ideally)
    const pillarMap = new Map() // local_id -> db_uuid

    for (const p of blueprint.active_pillars) {
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

    // 6. Save Workflows
    for (const wf of blueprint.workflows) {
        // Find the pillar definition to get its type
        const pillarDef = blueprint.active_pillars.find(p => p.id === wf.pillar_ref)
        const pillarType = pillarDef ? pillarDef.type : 'custom'

        const dbPillarId = pillarMap.get(wf.pillar_ref)
        if (dbPillarId) {
            const { data: wfEntry } = await supabase
                .from('workflows')
                .insert({
                    project_id: project.id,
                    pillar_id: dbPillarId,
                    name: wf.name,
                    description: wf.description,
                    status: 'active'
                })
                .select()
                .single()

            if (wfEntry) {
                await createDefaultWorkflowSteps(supabase, wfEntry.id, pillarType, { name: wf.name, goal: wf.goal })
            }
        }
    }

    revalidatePath(`/dashboard/project/${projectId}`)
}
