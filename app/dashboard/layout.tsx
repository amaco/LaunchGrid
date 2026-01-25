import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    return (
        <div className="flex h-screen bg-background text-foreground overflow-hidden">
            {/* Sidebar */}
            <aside className="w-64 border-r border-white/10 bg-black/20 backdrop-blur-xl flex flex-col">
                <div className="p-6 border-b border-white/5">
                    <Link href="/dashboard" className="text-xl font-bold tracking-tighter">
                        Launch<span className="text-accent">Grid</span>
                    </Link>
                </div>

                <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                    <div className="text-xs font-semibold text-foreground/40 uppercase tracking-widest px-2 mb-2 mt-4">
                        Command Center
                    </div>
                    <Link href="/dashboard" className="flex items-center gap-3 px-3 py-2 rounded-lg bg-accent/10 text-accent font-medium">
                        <span className="text-lg">📊</span> Projects
                    </Link>
                    <Link href="/dashboard/metrics" className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 text-foreground/70 transition-colors">
                        <span className="text-lg">📈</span> Analytics
                    </Link>
                    <Link href="/dashboard/settings" className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 text-foreground/70 transition-colors">
                        <span className="text-lg">⚙️</span> Settings
                    </Link>

                    <div className="text-xs font-semibold text-foreground/40 uppercase tracking-widest px-2 mb-2 mt-8">
                        My Blueprints
                    </div>
                    {/* TODO: List recent projects here */}
                    <div className="px-3 py-2 text-sm text-foreground/30 italic">
                        Connecting to core...
                    </div>
                </nav>

                <div className="p-4 border-t border-white/5">
                    <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-white/5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-accent to-purple-500 flex items-center justify-center font-bold text-xs">
                            {user.email?.[0].toUpperCase()}
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <div className="text-sm font-medium truncate">{user.email}</div>
                            <div className="text-xs text-foreground/40">Pro Plan</div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto bg-[url('/hero-pattern.svg')] bg-fixed bg-cover">
                <div className="max-w-7xl mx-auto p-8">
                    {children}
                </div>
            </main>
        </div>
    )
}
