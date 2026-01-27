
import { createClient } from '@supabase/supabase-js';

// Hardcoded creds
const supabaseUrl = 'https://plxchjkftdbfccbqxuve.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBseGNoamtmdGRiZmNjYnF4dXZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTM2Mzc2MywiZXhwIjoyMDg0OTM5NzYzfQ.vXaC1Z3qdrmWgwZpIPsMuFf4V-2qrlFD6d7UB13TjvQ';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkPolicies() {
    console.log("Checking RLS Policies on 'tasks' table...");

    // We can't query pg_policies directly via PostgREST unless exposed.
    // But we can try to insert a row with a random user_id and see what error we get, 
    // OR we can rely on the fact that if we use Service Role we bypass it.

    // Actually, we can use the rpc call if we had a function, but we don't.
    // Let's rely on the previous symptom: The user says "nothing".

    // Let's check if the MIGRATION history table exists (supabase_migrations is usually internal).

    // Instead, let's look at the tasks table again. Maybe the insert IS working but the query is failing?

    const { data: tasks } = await supabase.from('tasks').select('*');
    console.log(`Admin sees ${tasks?.length} tasks.`);
    if (tasks && tasks.length > 0) {
        console.log("Latest task:", tasks[tasks.length - 1]);
    }
}

checkPolicies();
