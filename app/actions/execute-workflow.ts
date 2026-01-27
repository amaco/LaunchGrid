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

    // 2. Find the NEXT executable step
    // We want the first step that does NOT have a 'completed' or 'review_needed' task.
    // If a step has NO task, it is by definition pending.

    // Fetch all tasks for this workflow
    const { data: existingTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', workflow.project.id)
        .in('step_id', workflow.steps.map((s: any) => s.id))

    const stepsSorted = workflow.steps.sort((a: any, b: any) => a.position - b.position)

    // Debugging: Log what we see
    console.log("Steps found:", stepsSorted.length)
    console.log("Tasks found:", existingTasks?.length)

    let targetStep = stepsSorted.find((s: any) => {
        const task = existingTasks?.find((t: any) => t.step_id === s.id)
        // If no task exists, it's pending. If task exists but not done, it's pending.
        const isDone = task && (task.status === 'completed' || task.status === 'review_needed')
        return !isDone
    })

    if (!targetStep) {
        // Reset logic? If the user added a new step but "all previous" were done, this should have found the new one.
        // If we are here, TRULY everything is done.
        // Let's force a reset if they click run again? Or just alert.
        console.log("Workflow seems complete")
        return { message: "Workflow is complete!" }
    }

    console.log("Targeting Step:", targetStep.type, targetStep.id)

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
    let resultData: any;

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
                // Check if we are in "Simulation Mode" (for free testing)
                // In a real app, strict checks (env var or user setting) would go here.
                // For MVP, if we have NO extension connected, we fallback to mock? 
                // Actually, let's assume if they click Run, they want to try the real deal unless flagged.

                // For now, let's force Real Mode if "is_mock" isn't explicitly requested (or we can toggle it).
                // But previously I returned mock data. Let's start the queueing flow.

                // QUEUE FOR EXTENSION
                // We do NOT return resultData yet. We set a flag to save as 'extension_queued'.

                const useRealExtension = true; // Hardcoded for now to enable the feature

                if (useRealExtension) {
                    // We return NULL results but set a special flag
                    // The saving logic below needs to handle 'extension_queued' status.
                    resultData = { pending_extension: true };
                } else {
                    // Simulator
                    resultData = {
                        is_mock: true,
                        found_items: [
                            { id: 't1', text: "Just lost $5k trading crypto today. Risk management sucks.", author: "@sadtrader" },
                            { id: 't2', text: "What is the best trading journal app in 2026?", author: "@curiouswhale" }
                        ],
                        summary: "Found 2 high-intent engagement opportunities. (SIMULATION)"
                    }
                }
                break;

            case 'SELECT_TARGETS':
                // AI Logic: Pick the best ones from previous step
                resultData = {
                    is_mock: previousStepOutput?.is_mock || false,
                    selected_items: previousStepOutput?.found_items || [],
                    rationale: "Selected all high-relevance items."
                }
                break;

            case 'GENERATE_REPLIES':
                // AI Logic: Write replies for the selected targets
                const targets = previousStepOutput?.selected_items || []
                if (targets.length === 0) throw new Error("No targets to reply to.")

                // COST PROTECTION: If data is mock, DO NOT call OpenAI.
                if (previousStepOutput?.is_mock) {
                    console.log("Skipping OpenAI call for Mock Data (Saving Tokens)")
                    resultData = {
                        is_mock: true,
                        replies: targets.map((t: any) => ({
                            target_id: t.id,
                            reply: `(Simulated Reply) Hey ${t.author}, have you tried using a journal? It helps!`
                        })),
                        title: "Drafted 2 Replies (SIMULATED)"
                    }
                    break;
                }

                // Real Execution
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
    const existingTask = existingTasks?.find((t: any) => t.step_id === targetStep.id)

    // Determine status
    let newStatus = 'review_needed';
    if (resultData?.pending_extension) {
        newStatus = 'extension_queued';
        resultData = { info: "Waiting for Browser Extension..." }
    }

    if (existingTask) {
        const { error } = await supabase.from('tasks').update({
            status: newStatus,
            output_data: resultData,
            completed_at: newStatus === 'extension_queued' ? null : new Date().toISOString()
        }).eq('id', existingTask.id)

        if (error) throw new Error(`Database Update Failed: ${error.message}`)
    } else {
        const { error } = await supabase.from('tasks').insert({
            step_id: targetStep.id,
            project_id: project.id,
            status: newStatus,
            output_data: resultData,
            completed_at: newStatus === 'extension_queued' ? null : new Date().toISOString()
        })

        if (error) throw new Error(`Database Insert Failed: ${error.message}`)
    }

    revalidatePath(`/dashboard/project/${project.id}`)
    return resultData;
}
