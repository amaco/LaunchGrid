import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth, successResponse, APIContext } from '@/lib/api/middleware';
import { EngagementService } from '@/lib/services/engagement-service';

export const dynamic = 'force-dynamic';

/**
 * Poll for active engagement jobs
 * GET /api/v1/extension/jobs/poll
 */
async function handler(request: NextRequest, context: APIContext) {
    const service = new EngagementService(context.serviceContext);

    // Poll top 5 jobs
    const jobs = await service.pollJobs(5);

    return successResponse({
        jobs,
        count: jobs.length
    });
}

export const GET = withExtensionAuth(handler);
