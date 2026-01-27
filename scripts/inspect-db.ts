
import { createClient } from '@supabase/supabase-js';

import { config } from 'dotenv';
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function inspectDB() {
    console.log('--- WORKFLOWS ---');
    const { data: workflows, error: wfError } = await supabase.from('workflows').select('*');
    if (wfError) console.error(wfError);
    else console.log(`Found ${workflows.length} workflows`);

    if (workflows && workflows.length > 0) {
        const wf = workflows[0];
        console.log('Inspecting Workflow:', wf.id, wf.name);

        console.log('--- STEPS ---');
        const { data: steps, error: stepError } = await supabase.from('steps').select('*').eq('workflow_id', wf.id);
        if (stepError) console.error(stepError);
        else {
            console.log(`Found ${steps.length} steps:`);
            console.log(steps);
        }

        console.log('--- TASKS ---');
        const { data: tasks, error: taskError } = await supabase.from('tasks').select('*').eq('project_id', wf.project_id); // Assuming we can link via project_id
        if (taskError) console.error(taskError);
        else console.log(`Found ${tasks.length} tasks`);
    }
}

inspectDB();
