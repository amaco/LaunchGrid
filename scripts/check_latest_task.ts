
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!
    );

    // Get the most recent task of type SCAN_FEED
    const { data: task, error } = await supabase
        .from('tasks')
        .select(`*, step:steps(type)`)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();


    if (error) {
        console.error('Error:', error);
    } else {
        console.log(`Checking Latest Task: ${task.id}`);
        console.log('Status:', task.status);
        console.log('Output:', JSON.stringify(task.output_data, null, 2));
        console.log('Error Message:', task.error_message);
    }
}

main();
