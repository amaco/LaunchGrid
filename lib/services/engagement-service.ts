/**
 * LaunchGrid Engagement Service
 * 
 * Owns: Engagement tracking lifecycle
 * Responsibilities:
 * - Managing long-running tracking jobs
 * - Polling logic for the extension
 * - Storing metric history
 */

import { BaseService, ServiceContext } from './base-service';
import { DatabaseError, NotFoundError } from '../core/errors';
import type { EngagementJob, EngagementJobStatus, EngagementMetrics } from '../core/types';

export class EngagementService extends BaseService {
    protected serviceName = 'EngagementService';
    protected aggregateType = 'engagement_job' as any; // Allow custom type

    constructor(context: ServiceContext) {
        super(context);
    }

    /**
     * Create a new tracking job
     */
    async createJob(input: {
        projectId: string;
        targetUrl: string;
        sourceTaskId?: string;
        durationDays?: number;
    }): Promise<EngagementJob> {
        return this.execute('createJob', async () => {
            // Verify project access
            await this.verifyProjectAccess(input.projectId);

            const durationDays = input.durationDays || 7;
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + durationDays);

            const { data, error } = await this.db
                .from('engagement_jobs')
                .insert({
                    project_id: input.projectId,
                    target_url: input.targetUrl,
                    source_task_id: input.sourceTaskId,
                    expires_at: expiresAt.toISOString(),
                    next_check_at: new Date().toISOString(), // Check immediately
                    check_interval_minutes: 60,
                    current_status: 'active'
                })
                .select()
                .single();

            if (error) {
                throw new DatabaseError(`Failed to create engagement job: ${error.message}`, 'INSERT');
            }

            return this.mapToJob(data);
        });
    }

    /**
     * Poll for jobs that need checking
     * Used by the Extension
     */
    async pollJobs(limit: number = 5): Promise<EngagementJob[]> {
        return this.execute('pollJobs', async () => {
            // Note: This query assumes the user context (auth.uid) is properly set 
            // via the API middleware, so RLS will filter by project ownership.

            const now = new Date().toISOString();

            const { data, error } = await this.db
                .from('engagement_jobs')
                .select('*')
                .eq('current_status', 'active')
                .lte('next_check_at', now)
                .gt('expires_at', now) // Don't pick expired ones
                .order('next_check_at', { ascending: true })
                .limit(limit);

            if (error) {
                throw new DatabaseError(`Failed to poll jobs: ${error.message}`, 'SELECT');
            }

            // Optimistically update next_check_at to prevent double-polling?
            // For now, we rely on the extension to report back quickly.
            // Or we could bump it by 5 minutes here to "lock" it.

            return (data || []).map(this.mapToJob);
        });
    }

    /**
     * Report results from a check
     */
    async reportMetrics(id: string, metrics: EngagementMetrics): Promise<EngagementJob> {
        return this.execute('reportMetrics', async () => {
            const job = await this.getById(id);

            // Verify ownership via getById implies RLS check

            // Schedule next check
            // Logic: If viral (high metrics), check more often?
            // Simple logic: default interval (60 mins)
            const nextCheck = new Date();
            nextCheck.setMinutes(nextCheck.getMinutes() + job.checkIntervalMinutes);

            // Append to history
            // Note: simplified JSONB array append
            const historyUpdate = [...job.metricHistory, metrics];

            // Keep last 50 points to save space? 
            if (historyUpdate.length > 50) historyUpdate.shift();

            const { data, error } = await this.db
                .from('engagement_jobs')
                .update({
                    last_checked_at: new Date().toISOString(),
                    next_check_at: nextCheck.toISOString(),
                    last_metrics: metrics,
                    metric_history: historyUpdate,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .select()
                .single();

            if (error) {
                throw new DatabaseError(`Failed to update metrics: ${error.message}`, 'UPDATE');
            }

            return this.mapToJob(data);
        });
    }

    /**
     * Manually trigger a job to run now
     */
    async triggerNow(id: string): Promise<EngagementJob> {
        return this.execute('triggerNow', async () => {
            const job = await this.getById(id);

            const { data, error } = await this.db
                .from('engagement_jobs')
                .update({
                    next_check_at: new Date().toISOString(), // NOW
                    current_status: 'active' // Reactivate if stopped
                })
                .eq('id', id)
                .select()
                .single();

            if (error) {
                throw new DatabaseError(`Failed to trigger job: ${error.message}`, 'UPDATE');
            }

            return this.mapToJob(data);
        });
    }

    /**
     * Stop/Pause a job
     */
    async stopJob(id: string): Promise<EngagementJob> {
        return this.execute('stopJob', async () => {
            await this.getById(id);

            const { data, error } = await this.db
                .from('engagement_jobs')
                .update({
                    current_status: 'stopped'
                })
                .eq('id', id)
                .select()
                .single();

            if (error) throw new DatabaseError(error.message, 'UPDATE');
            return this.mapToJob(data);
        });
    }

    /**
     * Get job by ID with ownership check
     */
    async getById(id: string): Promise<EngagementJob> {
        const { data, error } = await this.db
            .from('engagement_jobs')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) {
            throw new NotFoundError('EngagementJob', id);
        }

        // Check project access if not implicit via RLS (DB service bypasses RLS usually? No, supabase-js client respects it if context user is set)
        // But BaseService uses a client that might be admin or user scoped.
        // We'll trust RLS or verifyProjectAccess.
        await this.verifyProjectAccess(data.project_id);

        return this.mapToJob(data);
    }

    /**
     * Map DB row to domain object
     */
    private mapToJob(row: any): EngagementJob {
        return {
            id: row.id,
            projectId: row.project_id,
            sourceTaskId: row.source_task_id,
            targetUrl: row.target_url,
            status: row.current_status,
            startedAt: new Date(row.started_at),
            expiresAt: new Date(row.expires_at),
            checkIntervalMinutes: row.check_interval_minutes,
            lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at) : undefined,
            nextCheckAt: new Date(row.next_check_at),
            lastMetrics: row.last_metrics || {},
            metricHistory: row.metric_history || [],
            createdAt: new Date(row.created_at)
        };
    }
}
