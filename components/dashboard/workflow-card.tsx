'use client'

/**
 * Workflow Card Component
 * 
 * Compact card showing workflow status, progress, and click to open detail modal.
 */

import { useState } from 'react'
import { Play, CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react'
import WorkflowDetailModal from './workflow-detail-modal'

interface WorkflowCardProps {
    workflow: {
        id: string
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
    }
    projectId: string
}

// Calculate workflow progress from steps/tasks
function getWorkflowStatus(workflow: WorkflowCardProps['workflow']) {
    const steps = workflow.steps || []
    if (steps.length === 0) return { status: 'empty', label: 'No steps', color: 'text-foreground/40' }

    const totalSteps = steps.length
    let completedSteps = 0
    let needsReview = false
    let inProgress = false

    for (const step of steps) {
        const latestTask = step.tasks?.sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )?.[0]

        if (latestTask?.status === 'completed' || latestTask?.status === 'review_needed') {
            completedSteps++
        }
        if (latestTask?.status === 'review_needed') {
            needsReview = true
        }
        if (latestTask?.status === 'in_progress' || latestTask?.status === 'extension_queued') {
            inProgress = true
        }
    }

    if (needsReview) {
        return { status: 'review', label: 'Needs Review', color: 'text-amber-400', icon: AlertCircle }
    }
    if (inProgress) {
        return { status: 'running', label: 'Running...', color: 'text-blue-400', icon: Loader2 }
    }
    if (completedSteps === totalSteps) {
        return { status: 'complete', label: 'Complete', color: 'text-green-400', icon: CheckCircle }
    }
    if (completedSteps > 0) {
        return { status: 'partial', label: `${completedSteps}/${totalSteps} steps`, color: 'text-accent', icon: Play }
    }
    return { status: 'ready', label: 'Ready to run', color: 'text-foreground/50', icon: Play }
}

export default function WorkflowCard({ workflow, projectId }: WorkflowCardProps) {
    const [modalOpen, setModalOpen] = useState(false)
    const statusInfo = getWorkflowStatus(workflow)
    const StatusIcon = statusInfo.icon || Clock

    return (
        <>
            <button
                onClick={() => setModalOpen(true)}
                className="w-full text-left p-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/30 rounded-lg transition-all group"
            >
                <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-white truncate group-hover:text-accent transition-colors">
                            {workflow.name}
                        </div>
                        {workflow.description && (
                            <div className="text-xs text-foreground/40 mt-0.5 truncate">
                                {workflow.description}
                            </div>
                        )}
                    </div>
                    <div className={`flex items-center gap-1.5 text-xs ${statusInfo.color} shrink-0`}>
                        <StatusIcon className={`w-3 h-3 ${statusInfo.status === 'running' ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">{statusInfo.label}</span>
                    </div>
                </div>

                {/* Step progress bar */}
                {workflow.steps && workflow.steps.length > 0 && (
                    <div className="mt-2 flex gap-0.5">
                        {workflow.steps.sort((a, b) => a.position - b.position).map((step) => {
                            const latestTask = step.tasks?.sort((a, b) =>
                                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                            )?.[0]

                            let bgColor = 'bg-white/10' // not started
                            if (latestTask?.status === 'completed') bgColor = 'bg-green-500'
                            if (latestTask?.status === 'review_needed') bgColor = 'bg-amber-500'
                            if (latestTask?.status === 'in_progress') bgColor = 'bg-blue-500 animate-pulse'
                            if (latestTask?.status === 'failed') bgColor = 'bg-red-500'

                            return (
                                <div
                                    key={step.id}
                                    className={`h-1 flex-1 rounded-full ${bgColor}`}
                                    title={step.type.replace(/_/g, ' ')}
                                />
                            )
                        })}
                    </div>
                )}
            </button>

            {/* Detail Modal */}
            {modalOpen && (
                <WorkflowDetailModal
                    workflow={workflow}
                    projectId={projectId}
                    onClose={() => setModalOpen(false)}
                />
            )}
        </>
    )
}
