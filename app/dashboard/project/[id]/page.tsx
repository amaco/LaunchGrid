
import { createClient } from '@/utils/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, LayoutGrid } from 'lucide-react'
import EditContextButton from '@/components/dashboard/edit-context-button'
import RegenerateButton from '@/components/dashboard/regenerate-button'
import PillarWorkflowsSection from '@/components/dashboard/pillar-workflows-section'

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

            {/* Channels with Workflows */}
            <section>
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <LayoutGrid className="w-5 h-5 text-accent" /> Channels & Workflows
                </h2>
                <PillarWorkflowsSection
                    pillars={pillars}
                    workflows={workflows}
                    projectId={project.id}
                />
            </section>

        </div >
    )
}
