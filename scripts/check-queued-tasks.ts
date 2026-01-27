
import { createClient } from '@supabase/supabase-js';

// Hardcoded for debugging script
const supabaseUrl = 'https://plxchjkftdbfccbqxuve.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBseGNoamtmdGRiZmNjYnF4dXZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTM2Mzc2MywiZXhwIjoyMDg0OTM5NzYzfQ.vXaC1Z3qdrmWgwZpIPsMuFf4V-2qrlFD6d7UB13TjvQ';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkTasks() {
    console.log('Checking for tasks with status "extension_queued"...');
    const { data, error } = await supabase
        .from('tasks')
        .select('*')
    // .eq('status', 'extension_queued');

    if (error) {
        console.error('Error fetching tasks:', error);
    } else {
        console.log(`Found ${data.length} tasks:`);
        console.log(JSON.stringify(data, null, 2));
    }
}

checkTasks();
