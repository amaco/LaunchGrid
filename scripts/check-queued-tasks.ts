
import { createClient } from '@supabase/supabase-js';

import { config } from 'dotenv';
config({ path: '.env.local' });

// Hardcoded for debugging script
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY!;

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
