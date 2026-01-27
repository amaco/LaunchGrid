
import { createClient } from '@/utils/supabase/server'
import Link from 'next/link'
import DeleteProjectButton from '@/components/dashboard/delete-project-button'

export default async function DashboardPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: projects } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">Projects</h1>
                    <p className="text-foreground/50">Manage your active marketing blueprints.</p>
                </div>
                <Link href="/dashboard/new" className="bg-accent hover:bg-accent/80 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                    + New Blueprint
                </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects && projects.length > 0 ? (
                    projects.map((project: any) => (
                        <Link key={project.id} href={`/dashboard/project/${project.id}`} className="group relative glass p-6 hover:border-accent/50 transition-all hover:-translate-y-1 block">
                            <div className="absolute top-4 right-4 text-xs font-mono text-accent/70 bg-accent/10 px-2 py-1 rounded">
                                v{project.context?.version || '1.0'}
                            </div>
                            <DeleteProjectButton projectId={project.id} />
                            <h3 className="text-xl font-bold mb-2 text-white group-hover:text-accent transition-colors">{project.name}</h3>
                            <p className="text-sm text-foreground/50 line-clamp-2 h-10 mb-4">
                                {project.context?.target_audience || 'No description provided.'}
                            </p>

                            <div className="flex items-center gap-4 text-xs text-foreground/40 border-t border-white/5 pt-4">
                                <div className="flex items-center gap-1">
                                    <span>📅</span>
                                    {new Date(project.created_at).toLocaleDateString()}
                                </div>
                                <div className="flex items-center gap-1">
                                    <span>🏗️</span>
                                    3 Pillars
                                </div>
                            </div>
                        </Link>
                    ))
                ) : (
                    <div className="col-span-full py-20 text-center glass border-dashed border-white/10">
                        <div className="text-4xl mb-4">🏗️</div>
                        <h3 className="text-xl font-medium text-white mb-2">No projects found</h3>
                        <p className="text-foreground/50 mb-6 max-w-md mx-auto">
                            You have not created any marketing blueprints yet. Start by defining your product.
                        </p>
                        <Link href="/dashboard/new" className="text-accent hover:underline">
                            Create your first blueprint →
                        </Link>
                    </div>
                )}
            </div>
        </div>
    )
}
