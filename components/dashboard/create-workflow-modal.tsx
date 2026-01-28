'use client'

/**
 * Create Workflow Modal
 * 
 * Allows users to create workflows from templates or start blank.
 * Follows constitution: human-friendly, modular UI components.
 */

import { useState, useTransition } from 'react'
import { X, Loader2, Clock, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
    WORKFLOW_TEMPLATES,
    CATEGORY_LABELS,
    type WorkflowTemplate
} from '@/lib/workflows/templates'
import { createWorkflowFromTemplateAction, createBlankWorkflowAction } from '@/app/actions/manage-workflows'

interface CreateWorkflowModalProps {
    projectId: string
    pillarId: string
    pillarName: string
    onClose: () => void
}

export default function CreateWorkflowModal({
    projectId,
    pillarId,
    pillarName,
    onClose,
}: CreateWorkflowModalProps) {
    const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null)
    const [workflowName, setWorkflowName] = useState('')
    const [step, setStep] = useState<'select' | 'name'>('select')
    const [isPending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    // Filter templates for this platform (twitter for now, could be dynamic)
    const relevantTemplates = WORKFLOW_TEMPLATES.filter(
        t => t.platform === 'twitter' || t.platform === 'all'
    )

    // Group by category
    const grouped = relevantTemplates.reduce((acc, t) => {
        if (!acc[t.category]) acc[t.category] = []
        acc[t.category].push(t)
        return acc
    }, {} as Record<string, WorkflowTemplate[]>)

    const handleSelectTemplate = (template: WorkflowTemplate) => {
        setSelectedTemplate(template)
        setWorkflowName(template.name)
        setStep('name')
    }

    const handleCreate = () => {
        if (!workflowName.trim()) {
            setError('Please enter a workflow name')
            return
        }

        setError(null)
        startTransition(async () => {
            try {
                if (selectedTemplate?.id === 'blank') {
                    await createBlankWorkflowAction(
                        projectId,
                        pillarId,
                        workflowName.trim()
                    )
                } else if (selectedTemplate) {
                    await createWorkflowFromTemplateAction(
                        projectId,
                        pillarId,
                        selectedTemplate.id,
                        workflowName.trim()
                    )
                }
                router.refresh()
                onClose()
            } catch (e: any) {
                setError(e.message || 'Failed to create workflow')
            }
        })
    }

    const handleBack = () => {
        setStep('select')
        setSelectedTemplate(null)
        setError(null)
    }

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-background border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <div>
                        <h2 className="text-lg font-bold">
                            {step === 'select' ? 'Create New Workflow' : 'Name Your Workflow'}
                        </h2>
                        <p className="text-xs text-foreground/50">
                            {pillarName}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 overflow-y-auto max-h-[60vh]">
                    {step === 'select' ? (
                        <div className="space-y-6">
                            {Object.entries(grouped).map(([category, templates]) => (
                                <div key={category}>
                                    <h3 className="text-sm font-bold text-foreground/70 mb-3">
                                        {CATEGORY_LABELS[category] || category}
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {templates.map((template) => (
                                            <button
                                                key={template.id}
                                                onClick={() => handleSelectTemplate(template)}
                                                className="text-left p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/50 rounded-lg transition-all group"
                                            >
                                                <div className="flex items-start gap-3">
                                                    <span className="text-2xl">{template.icon}</span>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-bold text-sm group-hover:text-accent transition-colors">
                                                            {template.name}
                                                        </div>
                                                        <div className="text-xs text-foreground/50 mt-1 line-clamp-2">
                                                            {template.description}
                                                        </div>
                                                        {template.estimatedTime && (
                                                            <div className="flex items-center gap-1 mt-2 text-xs text-foreground/40">
                                                                <Clock className="w-3 h-3" />
                                                                {template.estimatedTime}
                                                            </div>
                                                        )}
                                                        {template.steps.length > 0 && (
                                                            <div className="flex items-center gap-1 mt-1 text-xs text-foreground/40">
                                                                <Zap className="w-3 h-3" />
                                                                {template.steps.length} steps
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Selected template preview */}
                            {selectedTemplate && (
                                <div className="p-4 bg-accent/10 border border-accent/20 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl">{selectedTemplate.icon}</span>
                                        <span className="font-bold">{selectedTemplate.name}</span>
                                    </div>
                                    <p className="text-xs text-foreground/60 mt-1">
                                        {selectedTemplate.description}
                                    </p>
                                    {selectedTemplate.steps.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-1">
                                            {selectedTemplate.steps.map((s, i) => (
                                                <span
                                                    key={i}
                                                    className="text-[10px] px-2 py-0.5 bg-white/10 rounded-full"
                                                >
                                                    {s.type.replace(/_/g, ' ')}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Name input */}
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    Workflow Name
                                </label>
                                <input
                                    type="text"
                                    value={workflowName}
                                    onChange={(e) => setWorkflowName(e.target.value)}
                                    placeholder="e.g., Daily Engagement, Weekly Thread..."
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-colors"
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                                    {error}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-4 border-t border-white/10 bg-white/5">
                    {step === 'name' ? (
                        <>
                            <button
                                onClick={handleBack}
                                className="px-4 py-2 text-sm text-foreground/70 hover:text-white transition-colors"
                            >
                                ← Back
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={isPending || !workflowName.trim()}
                                className="px-6 py-2 bg-accent hover:bg-accent/80 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isPending ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Creating...
                                    </>
                                ) : (
                                    'Create Workflow'
                                )}
                            </button>
                        </>
                    ) : (
                        <div className="w-full text-center text-xs text-foreground/40">
                            Select a template to get started
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
