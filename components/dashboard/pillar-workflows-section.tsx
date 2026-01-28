'use client'

/**
 * Pillar Workflows Section
 * 
 * Unified view: channels with their workflows, click to manage.
 * Compact, intuitive UI.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import CreateWorkflowModal from './create-workflow-modal'
import WorkflowCard from './workflow-card'

interface PillarWorkflowsSectionProps {
    pillars: Array<{
        id: string
        name: string
        type: string
    }>
    workflows: Array<{
        id: string
        pillar_id: string
        name: string
        description?: string
        status?: string
        steps?: Array<{
            id: string
            type: string
            position: number
            tasks?: Array<{
                id: string
                status: string
                created_at: string
                output_data?: any
            }>
        }>
    }>
    projectId: string
}

const PILLAR_ICONS: Record<string, string> = {
    'social_organic': '🐦',
    'community': '💬',
    'paid_ads': '💰',
    'email': '📧',
    'content_seo': '📝',
    'custom': '🔧',
}

export default function PillarWorkflowsSection({
    pillars,
    workflows,
    projectId,
}: PillarWorkflowsSectionProps) {
    const [modalOpen, setModalOpen] = useState(false)
    const [selectedPillar, setSelectedPillar] = useState<{ id: string, name: string } | null>(null)

    const handleNewWorkflow = (pillar: { id: string, name: string }) => {
        setSelectedPillar(pillar)
        setModalOpen(true)
    }

    const handleCloseModal = () => {
        setModalOpen(false)
        setSelectedPillar(null)
    }

    // Group workflows by pillar
    const workflowsByPillar = pillars.reduce((acc, pillar) => {
        acc[pillar.id] = workflows.filter(wf => wf.pillar_id === pillar.id)
        return acc
    }, {} as Record<string, typeof workflows>)

    return (
        <>
            <div className="space-y-4">
                {pillars.map((pillar) => {
                    const pillarWorkflows = workflowsByPillar[pillar.id] || []
                    const icon = PILLAR_ICONS[pillar.type] || '🚀'

                    return (
                        <div key={pillar.id} className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                            {/* Pillar Header - Compact */}
                            <div className="flex items-center justify-between px-4 py-3 bg-white/5">
                                <div className="flex items-center gap-3">
                                    <span className="text-xl">{icon}</span>
                                    <div>
                                        <h3 className="font-bold text-white text-sm">{pillar.name}</h3>
                                        <span className="text-[10px] text-foreground/40 font-mono uppercase">
                                            {pillar.type.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleNewWorkflow(pillar)}
                                    className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 hover:bg-accent/20 text-accent text-xs rounded-lg transition-colors"
                                >
                                    <Plus className="w-3 h-3" />
                                    <span className="hidden sm:inline">New Workflow</span>
                                </button>
                            </div>

                            {/* Workflow Cards */}
                            <div className="p-3">
                                {pillarWorkflows.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {pillarWorkflows.map((wf) => (
                                            <WorkflowCard
                                                key={wf.id}
                                                workflow={wf}
                                                projectId={projectId}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-4 text-foreground/30 text-xs">
                                        No workflows yet
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Create Workflow Modal */}
            {modalOpen && selectedPillar && (
                <CreateWorkflowModal
                    projectId={projectId}
                    pillarId={selectedPillar.id}
                    pillarName={selectedPillar.name}
                    onClose={handleCloseModal}
                />
            )}
        </>
    )
}
