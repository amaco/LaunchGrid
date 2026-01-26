'use server'

import { createClient } from '@/utils/supabase/server'
import { AIFactory, AIProviderID } from '@/utils/ai/factory'
import { redirect } from 'next/navigation'
import { decrypt } from '@/utils/encryption'
import { createDefaultWorkflowSteps } from '@/utils/workflow-utils'

export async function createProjectAction(formData: FormData) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    const rawData = {
        name: formData.get('name') as string,
        description: formData.get('description') as string,
        audience: formData.get('audience') as string,
        painPoints: formData.get('painPoints') as string,
        budget: parseInt(formData.get('budget') as string) || 0,
    }

    const selectedProvider = (formData.get('aiProvider') as AIProviderID) || 'gemini';

    // 1. Create Project Entry
    const { data: project, error: projError } = await supabase
        .from('projects')
        .insert({
            user_id: user.id,
            name: rawData.name,
            context: rawData
        })
        .select()
        .single()

    if (projError) throw new Error(projError.message)

    // 2. Fetch User Secrets for the selected provider
    const { data: secrets } = await supabase
        .from('user_secrets')
        .select('*')
        .eq('user_id', user.id)
        .single();

    const userApiKey = secrets && secrets[`${selectedProvider}_key`]
        ? decrypt(secrets[`${selectedProvider}_key`])
        : undefined;

    // 3. Generate AI Strategy via Factory
    let blueprint;
    try {
        const provider = AIFactory.getProvider(selectedProvider);
        blueprint = await provider.generateBlueprint(rawData, userApiKey);
    } catch (e) {
        console.error("AI Error", e)
        // ROLLBACK: Delete the empty project we just created
        await supabase.from('projects').delete().eq('id', project.id)
        throw new Error(`AI Strategy Generation Failed using ${selectedProvider}. Project creation rolled back. Check your API Key in Settings.`);
    }

    // 4. Save Pillars
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

    // 5. Save Workflows
    for (const wf of blueprint.workflows) {
        // Find the pillar definition to get its type
        const pillarDef = blueprint.active_pillars.find(p => p.id === wf.pillar_ref)
        const pillarType = pillarDef ? pillarDef.type : 'custom'

        const dbPillarId = pillarMap.get(wf.pillar_ref)

        if (dbPillarId) {
            const { data: wfEntry, error: wfError } = await supabase
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

    redirect(`/dashboard/project/${project.id}`)
}
