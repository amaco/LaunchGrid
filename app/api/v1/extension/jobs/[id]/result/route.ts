import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth, successResponse, APIContext } from '@/lib/api/middleware';
import { EngagementService } from '@/lib/services/engagement-service';
import { validateInput } from '@/lib/core/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const metricsSchema = z.object({
    views: z.number().optional(),
    likes: z.number().optional(),
    replies: z.number().optional(),
    retweets: z.number().optional(),
    timestamp: z.string().optional().default(() => new Date().toISOString())
});

/**
 * Report metrics for a job
 * POST /api/v1/extension/jobs/[id]/result
 */
async function handler(request: NextRequest, context: APIContext) {
    const params = context.params;
    const jobId = params.id; // Correct way to access dynamic route param

    if (!jobId) {
        return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    const body = await request.json();
    const { metrics } = validateInput(z.object({ metrics: metricsSchema }), body);

    const service = new EngagementService(context.serviceContext);
    const updatedJob = await service.reportMetrics(jobId, metrics);

    return successResponse({
        job: updatedJob
    });
}

export const POST = withExtensionAuth(handler);
