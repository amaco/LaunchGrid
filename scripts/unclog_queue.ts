
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!
    );

    console.log('--- FINDING QUEUED EXTENSION TASKS ---');
    const { data: tasks, error } = await supabase
        .from('tasks')
        .select('id, status, created_at, step_id')
        .eq('status', 'extension_queued')
        .order('created_at', { ascending: true });

    if (error) {
        console.error(error);
        return;
    }

    console.log(`Found ${tasks.length} tasks blocking the queue.`);

    for (const t of tasks) {
        console.log(`Cancelling task ${t.id} (Created: ${t.created_at})`);
        await supabase
            .from('tasks')
            .update({ status: 'cancelled', error_message: 'Cancelled to unclog queue' })
            .eq('id', t.id);
    }

    console.log('--- QUEUE CLEARED ---');
}

main();
