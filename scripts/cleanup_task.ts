
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
    console.log(`Cleaning up task: ${taskId}`);

    const { error } = await supabase
        .from('tasks')
        .update({ error_message: null })
        .eq('id', taskId);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Success: Error message cleared.');
    }
}

main();
