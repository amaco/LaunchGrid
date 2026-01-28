'use client'

/**
 * Workflow Detail Modal
 * 
 * Full workflow management: view steps, run workflow, see outputs, edit blocks.
 */

import { useState, useTransition } from 'react'
import { X, Play, Loader2, CheckCircle, AlertCircle, Clock, Trash2, Settings, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { executeWorkflowAction, rerunStepAction } from '@/app/actions/execute-workflow'
import { deleteWorkflowAction } from '@/app/actions/manage-workflows'
import WorkflowEditor from './workflow-editor'
import ContentPreview from './content-preview'
import TaskContentEditor from './task-content-editor'

interface WorkflowDetailModalProps {
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
    onClose: () => void
}

const STEP_LABELS: Record<string, string> = {
    'GENERATE_DRAFT': '✍️ Generate Content',
    'GENERATE_OUTLINE': '📝 Generate Outline',
    'GENERATE_HOOKS': '🪝 Generate Hooks',
    'SCAN_FEED': '🔍 Scan Feed',
    'SELECT_TARGETS': '🎯 Select Targets',
    'GENERATE_REPLIES': '🗣️ Draft Replies',
    'REVIEW_CONTENT': '👀 Human Review',
    'POST_API': '🔌 Publish (API)',
    'POST_EXTENSION': '📤 Publish (Extension)',
    'POST_REPLY': '↩️ Post Reply',
    'TRACK_ENGAGEMENT': '📊 Track Engagement',
}

export default function WorkflowDetailModal({
    workflow,
    projectId,
    onClose,
}: WorkflowDetailModalProps) {
    const [isPending, startTransition] = useTransition()
    const [isDeleting, setIsDeleting] = useState(false)
    const [showEditor, setShowEditor] = useState(false)
    const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    const sortedSteps = workflow.steps?.sort((a, b) => a.position - b.position) || []

    // Find next step to run
    const getNextStepIndex = () => {
        for (let i = 0; i < sortedSteps.length; i++) {
            const step = sortedSteps[i]
            const latestTask = step.tasks?.sort((a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )?.[0]

            if (!latestTask || latestTask.status === 'failed') {
                return i
            }
        }
        return -1 // All complete
    }

    const nextStepIndex = getNextStepIndex()

    const handleRunNext = () => {
        if (nextStepIndex === -1) return
        const step = sortedSteps[nextStepIndex]

        setError(null)
        startTransition(async () => {
            try {
                // executeWorkflowAction runs the entire workflow from current position
                await executeWorkflowAction(workflow.id)
                router.refresh()
            } catch (e: any) {
                setError(e.message || 'Failed to execute step')
            }
        })
    }

    const handleRunStep = (_stepId: string) => {
        // Note: Currently executeWorkflowAction runs the full workflow
        // In the future, we could add a runSingleStepAction for granular control
        setError(null)
        startTransition(async () => {
            try {
                await executeWorkflowAction(workflow.id)
                router.refresh()
            } catch (e: any) {
                setError(e.message || 'Failed to execute step')
            }
        })
    }

    const handleDelete = async () => {
        if (!confirm('Delete this workflow? This cannot be undone.')) return

        setIsDeleting(true)
        try {
            await deleteWorkflowAction(workflow.id)
            router.refresh()
            onClose()
        } catch (e: any) {
            setError(e.message || 'Failed to delete workflow')
            setIsDeleting(false)
        }
    }

    const toggleStep = (stepId: string) => {
        const newExpanded = new Set(expandedSteps)
        if (newExpanded.has(stepId)) {
            newExpanded.delete(stepId)
        } else {
            newExpanded.add(stepId)
        }
        setExpandedSteps(newExpanded)
    }

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-background border border-white/10 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-bold truncate">{workflow.name}</h2>
                        {workflow.description && (
                            <p className="text-xs text-foreground/50 truncate">{workflow.description}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                        <button
                            onClick={() => setShowEditor(!showEditor)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-foreground/50 hover:text-white"
                            title="Edit steps"
                        >
                            <Settings className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-foreground/50 hover:text-red-400"
                            title="Delete workflow"
                        >
                            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Error display */}
                {error && (
                    <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm shrink-0">
                        {error}
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {showEditor ? (
                        <WorkflowEditor workflow={workflow} onClose={() => setShowEditor(false)} />
                    ) : (
                        <div className="space-y-2">
                            {sortedSteps.length === 0 ? (
                                <div className="text-center py-8 text-foreground/40">
                                    <p>No steps yet. Click ⚙️ to add blocks.</p>
                                </div>
                            ) : (
                                sortedSteps.map((step, idx) => {
                                    const latestTask = step.tasks?.sort((a, b) =>
                                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                                    )?.[0]

                                    const hasOutput = latestTask?.output_data && Object.keys(latestTask.output_data).length > 0
                                    const isExpanded = expandedSteps.has(step.id)
                                    const isNext = idx === nextStepIndex

                                    // Status styling - review_needed shows as complete unless it's REVIEW_CONTENT step
                                    let statusIcon = <Clock className="w-4 h-4 text-foreground/30" />
                                    let statusBg = 'bg-white/5'

                                    const isActuallyComplete = latestTask?.status === 'completed' ||
                                        (latestTask?.status === 'review_needed' && step.type !== 'REVIEW_CONTENT')

                                    if (isActuallyComplete) {
                                        statusIcon = <CheckCircle className="w-4 h-4 text-green-400" />
                                        statusBg = 'bg-green-500/10'
                                    } else if (latestTask?.status === 'review_needed' && step.type === 'REVIEW_CONTENT') {
                                        statusIcon = <AlertCircle className="w-4 h-4 text-amber-400" />
                                        statusBg = 'bg-amber-500/10'
                                    } else if (latestTask?.status === 'in_progress' || latestTask?.status === 'extension_queued') {
                                        statusIcon = <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                                        statusBg = 'bg-blue-500/10'
                                    } else if (latestTask?.status === 'failed') {
                                        statusIcon = <AlertCircle className="w-4 h-4 text-red-400" />
                                        statusBg = 'bg-red-500/10'
                                    }

                                    // Check if content is editable (AI-generated vs raw data)
                                    // REVIEW_CONTENT typically holds replies from previous step
                                    const hasReplies = latestTask?.output_data?.replies
                                    const isEditable = hasReplies || step.type === 'GENERATE_REPLIES' || step.type === 'GENERATE_DRAFT' || step.type === 'GENERATE_HOOKS'

                                    return (
                                        <div key={step.id} className={`rounded-lg border border-white/10 overflow-hidden ${isNext ? 'ring-1 ring-accent' : ''}`}>
                                            {/* Step header */}
                                            <div
                                                className={`flex items-center gap-3 p-3 ${statusBg} cursor-pointer hover:bg-white/10 transition-colors`}
                                                onClick={() => hasOutput && toggleStep(step.id)}
                                            >
                                                <div className="shrink-0">{statusIcon}</div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-sm">
                                                        {STEP_LABELS[step.type] || step.type}
                                                    </div>
                                                    {latestTask?.status && (
                                                        <div className="text-xs text-foreground/40">
                                                            {latestTask.status === 'review_needed' && step.type === 'REVIEW_CONTENT'
                                                                ? 'Waiting for your approval'
                                                                : latestTask.status === 'review_needed'
                                                                    ? 'Completed (data ready)'
                                                                    : latestTask.status === 'extension_queued'
                                                                        ? 'Extension action pending'
                                                                        : latestTask.status === 'completed'
                                                                            ? 'Completed'
                                                                            : latestTask.status}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {/* Re-run button for completed steps */}
                                                    {latestTask && (latestTask.status === 'completed' || latestTask.status === 'review_needed') && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                startTransition(async () => {
                                                                    try {
                                                                        await rerunStepAction(latestTask.id, workflow.id);
                                                                        router.refresh();
                                                                    } catch (err: any) {
                                                                        setError(err.message || 'Failed to rerun step');
                                                                    }
                                                                });
                                                            }}
                                                            disabled={isPending}
                                                            className="p-1 hover:bg-white/10 rounded text-foreground/40 hover:text-white transition-colors"
                                                            title="Re-run this step"
                                                        >
                                                            <RotateCcw className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                    {isNext && !isPending && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleRunStep(step.id); }}
                                                            className="px-3 py-1 bg-accent hover:bg-accent/80 text-white text-xs font-bold rounded transition-colors flex items-center gap-1"
                                                        >
                                                            <Play className="w-3 h-3" /> Run
                                                        </button>
                                                    )}
                                                    {isPending && isNext && (
                                                        <Loader2 className="w-4 h-4 animate-spin text-accent" />
                                                    )}
                                                    {hasOutput && (
                                                        isExpanded ?
                                                            <ChevronDown className="w-4 h-4 text-foreground/40" /> :
                                                            <ChevronRight className="w-4 h-4 text-foreground/40" />
                                                    )}
                                                </div>
                                            </div>

                                            {/* Step output (expanded) */}
                                            {hasOutput && isExpanded && (
                                                <div className="p-3 border-t border-white/10 bg-black/20">
                                                    {isEditable && latestTask ? (
                                                        <TaskContentEditor
                                                            taskId={latestTask.id}
                                                            projectId={projectId}
                                                            content={latestTask.output_data.replies || latestTask.output_data.content}
                                                            contentKey={latestTask.output_data.replies ? 'replies' : 'content'}
                                                        />
                                                    ) : (
                                                        <ContentPreview
                                                            content={
                                                                latestTask?.output_data?.replies ||
                                                                latestTask?.output_data?.selected_items ||
                                                                latestTask?.output_data?.found_items ||
                                                                latestTask?.output_data?.content ||
                                                                latestTask?.output_data
                                                            }
                                                        />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    )}
                </div>

                {/* Footer with Run All button */}
                {!showEditor && sortedSteps.length > 0 && nextStepIndex !== -1 && (
                    <div className="p-4 border-t border-white/10 bg-white/5 shrink-0">
                        <button
                            onClick={handleRunNext}
                            disabled={isPending}
                            className="w-full py-3 bg-accent hover:bg-accent/80 text-white font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Running...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" />
                                    Run Next Step
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* All complete message */}
                {!showEditor && sortedSteps.length > 0 && nextStepIndex === -1 && (
                    <div className="p-4 border-t border-white/10 bg-green-500/10 shrink-0 text-center">
                        <div className="flex items-center justify-center gap-2 text-green-400 font-medium">
                            <CheckCircle className="w-5 h-5" />
                            All steps complete!
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
