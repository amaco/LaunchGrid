
import { createClient } from '@/utils/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Play, Pause, MoreVertical, LayoutGrid, CheckCircle } from 'lucide-react'
import EditContextButton from '@/components/dashboard/edit-context-button'
import RegenerateButton from '@/components/dashboard/regenerate-button'
import WorkflowCardActions from '@/components/dashboard/workflow-card-actions'
import ContentPreview from '@/components/dashboard/content-preview'
import RerunStepButton from '@/components/dashboard/rerun-step-button'

// Define params type correctly for Next.js 15+
type Props = {
    params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: Props) {
    const { id } = await params
    const supabase = await createClient()

    // Parallel data fetching
    const [projectRes, pillarsRes, workflowsRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id).single(),
        supabase.from('pillars').select('*').eq('project_id', id),
        supabase.from('workflows').select(`
            *,
            steps (
                *,
                tasks (*)
            )
        `).eq('project_id', id).order('created_at', { ascending: true })
    ])

    if (projectRes.error || !projectRes.data) return notFound()

    const project = projectRes.data
    const pillars = pillarsRes.data || []
    const workflows = workflowsRes.data || []

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

            {/* Channels Grid */}
            <section>
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <LayoutGrid className="w-5 h-5 text-accent" /> Active Channels
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {pillars.map((pillar: any) => (
                        <div key={pillar.id} className="glass p-5 border-l-4 border-l-accent flex items-center justify-between group">
                            <div>
                                <span className="text-xs font-mono uppercase text-foreground/40 mb-1 block">{pillar.type}</span>
                                <h3 className="font-bold text-white">{pillar.name}</h3>
                            </div>
                            <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]" />
                        </div>
                    ))}
                </div>
            </section>

            {/* Workflows (LEGO Blocks) */}
            < section >
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <span className="text-2xl">🧩</span> Active Workflows
                </h2>
                <div className="space-y-4">
                    {workflows.map((wf: any) => (
                        <div key={wf.id} className="glass p-6 group hover:border-white/20 transition-all">
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white/5 rounded-lg text-xl">
                                        {wf.name.includes('Twitter') ? '🐦' : wf.name.includes('Discord') ? '💬' : '🚀'}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg text-white">{wf.name}</h3>
                                        <p className="text-sm text-foreground/50">{wf.description}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="px-2 py-1 bg-white/5 rounded text-xs font-mono text-foreground/60 uppercase">
                                        {wf.status || 'Active'}
                                    </span>
                                    <button className="p-2 hover:bg-white/10 rounded-lg text-foreground/50 hover:text-white transition-colors">
                                        <MoreVertical className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Steps Dynamic */}
                            <div className="pl-4 ml-4 border-l border-white/10 space-y-4">
                                {wf.steps?.sort((a: any, b: any) => a.position - b.position).map((step: any) => {
                                    // Robustly find the latest task
                                    const sortedTasks = step.tasks?.sort((a: any, b: any) =>
                                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                                    ) || []
                                    const latestTask = sortedTasks[0]
                                    const isDone = latestTask?.status === 'review_needed' || latestTask?.status === 'completed'

                                    return (
                                        <div key={step.id} className="flex items-start gap-3 text-sm text-foreground/70">
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isDone ? 'bg-green-500/20 text-green-500' : 'bg-white/5 text-foreground/30'}`}>
                                                {isDone ? <CheckCircle className="w-3 h-3" /> : step.position}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-center">
                                                    <span className={isDone ? 'text-white font-medium' : ''}>
                                                        {step.type === 'GENERATE_DRAFT' ? 'Generate Content (AI)' :
                                                            step.type === 'POST_API' ? 'Publish to Platform' :
                                                                step.type === 'SCAN_FEED' ? 'Scan Feed for Keywords' :
                                                                    step.type === 'SELECT_TARGETS' ? 'Select High-Value Targets' :
                                                                        step.type === 'GENERATE_REPLIES' ? 'Draft Replies (AI)' :
                                                                            step.type === 'POST_REPLY' ? 'Post Reply' :
                                                                                step.type.replace(/_/g, ' ')}
                                                    </span>

                                                    <div className="flex items-center gap-2">
                                                        {isDone && (
                                                            <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded uppercase tracking-wider font-bold">
                                                                Ready
                                                            </span>
                                                        )}
                                                        {latestTask?.status === 'extension_queued' && (
                                                            <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded uppercase tracking-wider font-bold animate-pulse">
                                                                Waiting for Browser...
                                                            </span>
                                                        )}
                                                        {isDone && latestTask && (
                                                            <RerunStepButton taskId={latestTask.id} workflowId={wf.id} />
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Draft Preview if ready - Collapsible */}
                                                {isDone && latestTask?.output_data && (
                                                    <details className="mt-2 group">
                                                        <summary className="text-[11px] text-white/40 cursor-pointer hover:text-white/60 transition-colors list-none flex items-center gap-1 select-none">
                                                            <span className="group-open:rotate-90 transition-transform duration-200">▶</span>
                                                            {latestTask.output_data.title || 'View Step Result'}
                                                        </summary>
                                                        <div className="mt-2 pl-4 border-l border-white/10">
                                                            <ContentPreview
                                                                content={
                                                                    latestTask.output_data.found_items ||
                                                                    latestTask.output_data.selected_items ||
                                                                    latestTask.output_data.replies ||
                                                                    latestTask.output_data.content ||
                                                                    latestTask.output_data.summary
                                                                }
                                                                title={latestTask.output_data.title || 'Step Result'}
                                                            />
                                                        </div>
                                                    </details>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            <div className="mt-6 pt-4 border-t border-white/5 flex justify-between items-center">
                                <WorkflowCardActions workflow={wf} />
                            </div>
                        </div>
                    ))}
                </div>
            </section >
        </div >
    )
}
