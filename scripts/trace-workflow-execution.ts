
import { createClient } from '@supabase/supabase-js';

import { config } from 'dotenv';
config({ path: '.env.local' });

// Hardcoded creds
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Mock AIFactory
const AIFactory = {
    getProvider: (id: string) => ({
        generateContent: async () => {
            console.log("Mock AI Generate Called");
            return { pending_extension: true }; // Simulate what SCAN_FEED does
        }
    })
};

async function executeWorkflowAction(workflowId: string) {
    console.log("Starting Execution for:", workflowId);

    // 1. Fetch Workflow & Related Data
    const { data: workflow, error } = await supabase
        .from('workflows')
        .select(`
            *,
            pillar:pillars(*),
            project:projects(*),
            steps(*)
        `)
        .eq('id', workflowId)
        .single()

    if (error) console.error("Fetch Error:", error);
    if (!workflow) {
        console.log("Workflow not found");
        return;
    }

    // 2. Find the NEXT executable step
    const { data: existingTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', workflow.project.id)
        .in('step_id', workflow.steps.map((s: any) => s.id))

    const stepsSorted = workflow.steps.sort((a: any, b: any) => a.position - b.position)

    console.log("Steps found:", stepsSorted.length)
    console.log("Tasks found:", existingTasks?.length)

    const targetStep = stepsSorted.find((s: any) => {
        const task = existingTasks?.find((t: any) => t.step_id === s.id)
        const isDone = task && (task.status === 'completed' || task.status === 'review_needed')
        return !isDone
    })

    if (!targetStep) {
        console.log("Workflow seems complete")
        return;
    }

    console.log("Targeting Step:", targetStep.type, targetStep.id)

    // 5. Execute Step Handler
    let resultData: any;

    try {
        switch (targetStep.type) {
            case 'SCAN_FEED':
                console.log("Processing SCAN_FEED");
                const useRealExtension = true;
                if (useRealExtension) {
                    resultData = { pending_extension: true };
                }
                break;
            default:
                console.log("Unknown step type:", targetStep.type);
                throw new Error(`Step type ${targetStep.type} not ready yet.`)
        }

    } catch (e: any) {
        console.error("Workflow Execution Failed", e)
        return;
    }

    // 6. Save or Update Task Result
    console.log("Saving Task...");
    const existingTask = existingTasks?.find((t: any) => t.step_id === targetStep.id)

    let newStatus = 'review_needed';
    if (resultData?.pending_extension) {
        newStatus = 'extension_queued';
        resultData = { info: "Waiting for Browser Extension..." }
    }

    console.log("New Status:", newStatus);

    if (existingTask) {
        console.log("Updating existing task", existingTask.id);
        const { error } = await supabase.from('tasks').update({
            status: newStatus,
            output_data: resultData
        }).eq('id', existingTask.id);
        if (error) console.error("Update Error:", error);
    } else {
        console.log("Inserting new task");
        const { error } = await supabase.from('tasks').insert({
            step_id: targetStep.id,
            project_id: workflow.project.id,
            status: newStatus,
            output_data: resultData
        });
        if (error) console.error("Insert Error:", error);
    }
    console.log("Done.");
}

// RUN IT
executeWorkflowAction('85188f33-fad5-435e-992e-c5774a9713dc');
