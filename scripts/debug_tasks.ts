
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!
    );

    console.log('--- ALL TASKS ---');
    const { data: tasks, error } = await supabase
        .from('tasks')
        .select(`
            id, 
            status, 
            step_id, 
            created_at,
            output_data,
            error_message,
            step:steps(type, workflow_id)
        `)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    tasks.forEach(t => {
        console.log(`[${t.status}] ${t.step?.type} (ID: ${t.id})`);
        if (t.output_data) {
            console.log('Output:', JSON.stringify(t.output_data, null, 2));
        }
        if (t.error_message) {
            console.log('Error:', t.error_message);
        }
        console.log('---');
    });
}

main();
