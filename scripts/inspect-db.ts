
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://plxchjkftdbfccbqxuve.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBseGNoamtmdGRiZmNjYnF4dXZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTM2Mzc2MywiZXhwIjoyMDg0OTM5NzYzfQ.vXaC1Z3qdrmWgwZpIPsMuFf4V-2qrlFD6d7UB13TjvQ';

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
