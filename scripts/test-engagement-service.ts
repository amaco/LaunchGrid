
import { createClient } from '@supabase/supabase-js';
import { EngagementService } from '../lib/services/engagement-service';

// Environment variables should be loaded from .env.local or provided via CLI
// process.env.NEXT_PUBLIC_SUPABASE_URL and process.env.SUPABASE_SECRET_KEY are used below

async function main() {
    console.log("Testing EngagementService...");

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } }
    );

    // Mock User ID (use a real one if possible, or a placeholder)
    // We need a valid UUID
    const userId = '00000000-0000-0000-0000-000000000000';

    try {
        const service = new EngagementService({
            supabase,
            tenant: {
                organizationId: userId,
                userId: userId,
                role: 'owner' // This is the fix
            },
            requestId: 'test-req-id',
            ipAddress: '127.0.0.1',
            userAgent: 'test-script'
        });

        // Test pollJobs (simulating extension)
        console.log("Polling jobs...");
        const jobs = await service.pollJobs();
        console.log("Poll successful:", jobs);

    } catch (err: any) {
        console.error("Test FAILED:", err);
    }
}

main();
