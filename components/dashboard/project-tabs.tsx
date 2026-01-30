'use client'

import { useState } from 'react'
import { LayoutGrid, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProjectTabsProps {
    strategyContent: React.ReactNode
    monitoringContent: React.ReactNode
}

export function ProjectTabs({ strategyContent, monitoringContent }: ProjectTabsProps) {
    const [activeTab, setActiveTab] = useState<'strategy' | 'monitoring'>('strategy')

    return (
        <div className="space-y-8">
            {/* Tab Navigation */}
            <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg w-fit border border-white/5 mx-auto sm:mx-0">
                <button
                    onClick={() => setActiveTab('strategy')}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
                        activeTab === 'strategy'
                            ? "bg-accent/20 text-accent ring-1 ring-accent/50"
                            : "text-foreground/60 hover:text-white hover:bg-white/5"
                    )}
                >
                    <LayoutGrid className="w-4 h-4" />
                    Strategy & Workflows
                </button>
                <button
                    onClick={() => setActiveTab('monitoring')}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
                        activeTab === 'monitoring'
                            ? "bg-accent/20 text-accent ring-1 ring-accent/50"
                            : "text-foreground/60 hover:text-white hover:bg-white/5"
                    )}
                >
                    <Activity className="w-4 h-4" />
                    Monitoring
                </button>
            </div>

            {/* Content Area */}
            <div className="min-h-[500px]">
                {activeTab === 'strategy' ? (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {strategyContent}
                    </div>
                ) : (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {monitoringContent}
                        {/* Empty state hint if needed, handled by child */}
                    </div>
                )}
            </div>
        </div>
    )
}
