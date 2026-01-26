
import { createClient } from '@/utils/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Play, Pause, MoreVertical, LayoutGrid } from 'lucide-react'
import EditContextButton from '@/components/dashboard/edit-context-button'
import RegenerateButton from '@/components/dashboard/regenerate-button'

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
        supabase.from('workflows').select('*').eq('project_id', id)
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

            {/* Pillars Grid */}
            <section>
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <LayoutGrid className="w-5 h-5 text-accent" /> Active Pillars
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
            <section>
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

                            {/* Steps Preview (Static for now) */}
                            <div className="pl-4 ml-4 border-l border-white/10 space-y-3">
                                <div className="flex items-center gap-3 text-sm text-foreground/70">
                                    <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold">1</div>
                                    <span>Generate Draft Content (AI)</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-foreground/70">
                                    <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-foreground/30 text-xs font-bold">2</div>
                                    <span>Human Review & Approve</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-foreground/70">
                                    <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-foreground/30 text-xs font-bold">3</div>
                                    <span>Schedule / Post API</span>
                                </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-white/5 flex justify-end">
                                <button className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent hover:text-white transition-colors">
                                    <Play className="w-3 h-3" /> Run Workflow
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    )
}
