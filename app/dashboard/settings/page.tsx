
import { createClient } from '@/utils/supabase/server'
import Link from 'next/link'
import { Settings, Key, Shield, Database } from 'lucide-react'

export default async function SettingsPage() {
    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                    <Settings className="h-8 w-8 text-accent" /> settings
                </h1>
                <p className="text-foreground/50">Manage your comprehensive LaunchGrid configuration.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* API Keys & Secrets */}
                <Link href="/dashboard/settings/secrets" className="group glass p-6 hover:border-accent/50 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-accent/10 rounded-lg text-accent">
                            <Key className="h-6 w-6" />
                        </div>
                        <span className="text-xs font-mono text-foreground/30 group-hover:text-accent transition-colors">SECURE_VAULT</span>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">API Keys & Secrets</h3>
                    <p className="text-sm text-foreground/50">
                        Configure connections to OpenAI, Gemini, X (Twitter), and Discord.
                        Keys are encrypted at rest.
                    </p>
                </Link>

                {/* Workflow Templates */}
                <Link href="/dashboard/settings/templates" className="group glass p-6 hover:border-accent/50 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-purple-500/10 rounded-lg text-purple-400">
                            <Database className="h-6 w-6" />
                        </div>
                        <span className="text-xs font-mono text-foreground/30 group-hover:text-purple-400 transition-colors">LEGO_LIBRARY</span>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Workflow Templates</h3>
                    <p className="text-sm text-foreground/50">
                        Edit the default "LEGO blocks" and prompt templates used for strategy generation.
                    </p>
                </Link>

                {/* Security & Access */}
                <Link href="/dashboard/settings/security" className="group glass p-6 hover:border-accent/50 transition-all opacity-50 cursor-not-allowed">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-green-500/10 rounded-lg text-green-400">
                            <Shield className="h-6 w-6" />
                        </div>
                        <span className="text-xs font-mono text-foreground/30">COMING_SOON</span>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Team & Security</h3>
                    <p className="text-sm text-foreground/50">
                        Manage team members, roles, and 2FA settings.
                    </p>
                </Link>
            </div>
        </div>
    )
}
