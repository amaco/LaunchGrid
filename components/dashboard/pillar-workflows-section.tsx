'use client'

/**
 * Pillar Workflows Section
 * 
 * Shows workflows grouped by pillar with "New Workflow" button.
 * Allows creating multiple workflows per channel.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import CreateWorkflowModal from './create-workflow-modal'

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
            <div className="space-y-6">
                {pillars.map((pillar) => {
                    const pillarWorkflows = workflowsByPillar[pillar.id] || []
                    const icon = PILLAR_ICONS[pillar.type] || '🚀'

                    return (
                        <div key={pillar.id} className="bg-white/5 rounded-xl p-4 border border-white/10">
                            {/* Pillar Header */}
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">{icon}</span>
                                    <div>
                                        <h3 className="font-bold text-white">{pillar.name}</h3>
                                        <span className="text-xs text-foreground/40 font-mono uppercase">
                                            {pillar.type.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleNewWorkflow(pillar)}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-sm rounded-lg transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                    New Workflow
                                </button>
                            </div>

                            {/* Workflow Cards */}
                            {pillarWorkflows.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {pillarWorkflows.map((wf) => (
                                        <a
                                            key={wf.id}
                                            href={`#workflow-${wf.id}`}
                                            className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/30 rounded-lg transition-all"
                                        >
                                            <div className="font-medium text-sm text-white">
                                                {wf.name}
                                            </div>
                                            {wf.description && (
                                                <div className="text-xs text-foreground/50 mt-1 line-clamp-1">
                                                    {wf.description}
                                                </div>
                                            )}
                                        </a>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-6 text-foreground/40 text-sm">
                                    No workflows yet. Click "New Workflow" to create one.
                                </div>
                            )}
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
