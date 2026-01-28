
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!
    );

    const taskId = 'b6c83c64-898e-4fa2-8e40-1db826f8745f';
    console.log(`Checking task: ${taskId}`);

    const { data: task, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Task Status:', task.status);
        console.log('Task Output:', JSON.stringify(task.output_data, null, 2));
        console.log('Error Message:', task.error_message);
    }
}

main();
