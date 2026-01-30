
import { createClient } from '@/utils/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import EditContextButton from '@/components/dashboard/edit-context-button'
import RegenerateButton from '@/components/dashboard/regenerate-button'
import PillarWorkflowsSection from '@/components/dashboard/pillar-workflows-section'
import { ProjectTabs } from '@/components/dashboard/project-tabs'
import { JobsTable } from '@/components/dashboard/monitoring/jobs-table'
import { EngagementJob } from '@/lib/core/types'

// Define params type correctly for Next.js 15+
type Props = {
    params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: Props) {
    const { id } = await params
    const supabase = await createClient()

    // Parallel data fetching
    const [projectRes, pillarsRes, workflowsRes, jobsRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id).single(),
        supabase.from('pillars').select('*').eq('project_id', id),
        supabase.from('workflows').select(`
            *,
            steps (
                *,
                tasks (*)
            )
        `).eq('project_id', id).order('created_at', { ascending: true }),
        supabase.from('engagement_jobs').select(`
            *,
            task:tasks (
                step:steps (
                    type,
                    workflow:workflows (
                        id,
                        name
                    )
                )
            )
        `).eq('project_id', id).order('created_at', { ascending: false })
    ])

    if (projectRes.error || !projectRes.data) return notFound()

    const project = projectRes.data
    const pillars = pillarsRes.data || []
    const workflows = workflowsRes.data || []

    // Map raw DB response to EngagementJob type
    const jobs: EngagementJob[] = (jobsRes.data || []).map((row: any) => ({
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
        createdAt: new Date(row.created_at),
        // Map joined data
        workflowId: row.task?.step?.workflow?.id,
        workflowName: row.task?.step?.workflow?.name,
        sourceType: row.task?.step?.type
    }))

    return (
        <div className="space-y-8 pb-20">
            {/* Header */}
            <div>
                <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-white mb-6 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back to projects
                </Link>
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">{project.name}</h1>
                        <p className="text-foreground/50 max-w-2xl">{project.context?.description}</p>
                    </div>
                    <div className="flex gap-2">
                        <EditContextButton project={project} />
                        <RegenerateButton projectId={project.id} />
                    </div>
                </div>
            </div>

            <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]" />

            {/* Main Content Areas via Tabs */}
            <ProjectTabs
                strategyContent={
                    <PillarWorkflowsSection
                        pillars={pillars}
                        workflows={workflows}
                        projectId={project.id}
                    />
                }
                monitoringContent={
                    <JobsTable
                        jobs={jobs}
                        projectId={project.id}
                    />
                }
            />

        </div >
    )
}
