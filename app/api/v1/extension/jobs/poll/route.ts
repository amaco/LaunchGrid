import { NextRequest, NextResponse } from 'next/server';
import { withEngagementPollAuth, successResponse, APIContext } from '@/lib/api/middleware';
import { EngagementService } from '@/lib/services/engagement-service';

export const dynamic = 'force-dynamic';

/**
 * Poll for active engagement jobs
 * GET /api/v1/extension/jobs/poll
 * 
 * Rate limited to 5 req/min for anti-spam protection.
 */
async function handler(request: NextRequest, context: APIContext) {
    // Need to create admin client for background polling if we want it to work without specific user context
    // However, EngagementService expects a user context for RLS filtering.
    // Since this is the extension polling for ALL jobs (that it should see?), or is it specific?
    // The previous implementation utilized 'withExtensionAuth' which used a system/service account.

    // Check if we have a service account or real user
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } }
    );

    const service = new EngagementService({
        supabase,
        tenant: {
            organizationId: context.organizationId,
            userId: context.user.id,
            role: 'owner'
        },
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
    });

    // Poll top 5 jobs
    const jobs = await service.pollJobs(5);

    return successResponse({
        jobs,
        count: jobs.length
    });
}

export const GET = withEngagementPollAuth(handler);
