'use server'

import { createClient } from '@/utils/supabase/server'
import { AIFactory, AIProviderID } from '@/utils/ai/factory'
import { decrypt } from '@/utils/encryption'
import { revalidatePath } from 'next/cache'

export async function executeWorkflowAction(workflowId: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    // 1. Fetch Workflow & Related Data
    const { data: workflow } = await supabase
        .from('workflows')
        .select(`
            *,
            pillar:pillars(*),
            project:projects(*),
            steps(*)
        `)
        .eq('id', workflowId)
        .single()

    if (!workflow) throw new Error('Workflow not found')

    // 2. Find the NEXT executable step (Pending or Review Needed?)
    // For this MVP, we actually want to run a specific step OR the next pending one.
    // Let's assume the button simply "Runs the next pending step".

    // Fetch all tasks for this workflow to check status
    const { data: existingTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', workflow.project.id) // Corrected: project.id from workflow
        .in('step_id', workflow.steps.map((s: any) => s.id))

    // Find the first step that is NOT completed
    const stepsSorted = workflow.steps.sort((a: any, b: any) => a.position - b.position)
    let targetStep = stepsSorted.find((s: any) => {
        const task = existingTasks?.find((t: any) => t.step_id === s.id)
        return !task || (task.status !== 'completed' && task.status !== 'review_needed')
    })

    if (!targetStep) {
        // If all are done, maybe reset? For now, just pick the last one or error
        // Actually, if we want to "Run" a specific behavior, we might need a distinct action per step.
        // For simplicity: We run the "next" step.
        return { message: "Workflow is complete!" }
    }

    // 3. Prepare AI Context & Dependencies
    const project = workflow.project
    const context = project.context || {}
    const providerId = (context.aiProvider as AIProviderID) || 'gemini'

    // CHAINING LOGIC: Look for output from the PREVIOUS step to pass as input
    let previousStepOutput = null;
    const prevStepIndex = stepsSorted.findIndex((s: any) => s.id === targetStep.id) - 1;
    if (prevStepIndex >= 0) {
        const prevStep = stepsSorted[prevStepIndex];
        const prevTask = existingTasks?.find((t: any) => t.step_id === prevStep.id);
        if (prevTask && prevTask.output_data) {
            previousStepOutput = prevTask.output_data;
        }
    }

    // 4. Get API Key
    const { data: secrets } = await supabase
        .from('user_secrets')
        .select('*')
        .eq('user_id', user.id)
        .single();

    const userApiKey = secrets && secrets[`${providerId}_key`]
        ? decrypt(secrets[`${providerId}_key`])
        : undefined;

    // 5. Execute Step Handler
    const provider = AIFactory.getProvider(providerId);
    let resultData;

    try {
        switch (targetStep.type) {
            case 'GENERATE_DRAFT':
            case 'GENERATE_OUTLINE':
                resultData = await provider.generateContent({
                    project: {
                        name: project.name,
                        description: context.description,
                        audience: context.audience || "General Audience",
                        painPoints: context.painPoints || "None specified",
                        budget: context.budget || 0
                    },
                    pillarName: workflow.pillar.name,
                    workflowName: workflow.name,
                    workflowDescription: workflow.description || workflow.name,
                    stepConfig: targetStep.config
                }, userApiKey);
                break;

            case 'SCAN_FEED':
                // Simulator: In real life, this calls Twitter API
                resultData = {
                    found_items: [
                        { id: 't1', text: "Just lost $5k trading crypto today. Risk management sucks.", author: "@sadtrader" },
                        { id: 't2', text: "What is the best trading journal app in 2026?", author: "@curiouswhale" }
                    ],
                    summary: "Found 2 high-intent engagement opportunities."
                }
                break;

            case 'SELECT_TARGETS':
                // AI Logic: Pick the best ones from previous step
                // For MVP: Pass through
                resultData = {
                    selected_items: previousStepOutput?.found_items || [],
                    rationale: "Selected all high-relevance items."
                }
                break;

            case 'GENERATE_REPLIES':
                // AI Logic: Write replies for the selected targets
                const targets = previousStepOutput?.selected_items || []
                if (targets.length === 0) throw new Error("No targets to reply to.")

                // We'll just generate one bulk object for now or array
                const comments = await Promise.all(targets.map(async (t: any) => {
                    const draft = await provider.generateContent({
                        project: {
                            name: project.name,
                            description: context.description,
                            audience: context.audience,
                            painPoints: context.painPoints,
                            budget: context.budget
                        },
                        pillarName: workflow.pillar.name,
                        workflowName: "Reply to " + t.author,
                        workflowDescription: `Write a helpful, subtle reply to this tweet: "${t.text}"`,
                        stepConfig: targetStep.config
                    }, userApiKey);
                    return { target_id: t.id, reply: draft.content }
                }))

                resultData = { replies: comments, title: "Drafted 2 Replies" }
                break;

            default:
                throw new Error(`Step type ${targetStep.type} not ready yet.`)
        }

    } catch (e: any) {
        console.error("Workflow Execution Failed", e)
        throw new Error(`Execution Failed: ${e.message}`)
    }

    // 6. Save or Update Task Result
    // Check if task exists (retry?)
    const existingTask = existingTasks?.find((t: any) => t.step_id === targetStep.id)

    if (existingTask) {
        await supabase.from('tasks').update({
            status: 'review_needed',
            output_data: resultData,
            completed_at: new Date().toISOString()
        }).eq('id', existingTask.id)
    } else {
        await supabase.from('tasks').insert({
            step_id: targetStep.id,
            project_id: project.id,
            status: 'review_needed', // or completed depending on step type
            output_data: resultData,
            completed_at: new Date().toISOString()
        })
    }

    revalidatePath(`/dashboard/project/${project.id}`)
    return resultData;
}
