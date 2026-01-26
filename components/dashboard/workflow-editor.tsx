'use client'

import { useState } from 'react'
import { addStepAction, deleteStepAction } from '@/app/actions/manage-steps'
import { Plus, Trash2, ArrowUp, ArrowDown, Save, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

const STEP_TYPES = [
    { type: 'GENERATE_DRAFT', label: '✍️ Generate Content (Draft)' },
    { type: 'GENERATE_OUTLINE', label: '📝 Generate Outline' },
    { type: 'GENERATE_HOOKS', label: '🪝 Generate Viral Hooks' },
    { type: 'SCAN_FEED', label: '🔍 Scan Social Feed' },
    { type: 'SELECT_TARGETS', label: '🎯 Select High-Value Targets' },
    { type: 'GENERATE_REPLIES', label: '🗣️ Draft AI Replies' },
    { type: 'REVIEW_CONTENT', label: '👀 Human Review' },
    { type: 'POST_API', label: '🚀 Publish to Platform' },
    { type: 'POST_REPLY', label: '↩️ Publish Reply' },
]

export default function WorkflowEditor({ workflow, onClose }: { workflow: any, onClose: () => void }) {
    const [steps, setSteps] = useState(workflow.steps || [])
    const [isSaving, setIsSaving] = useState(false)
    const router = useRouter()

    const handleAdd = async (type: string) => {
        setIsSaving(true)
        try {
            const nextPos = steps.length + 1
            await addStepAction(workflow.id, type, nextPos)
            router.refresh()
            // Optimistic update would be better, but refresh is safe
            onClose() // Close to force refresh? Or keep open?
        } catch (e) {
            alert('Failed to add step')
        } finally {
            setIsSaving(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Remove this block?')) return
        setIsSaving(true)
        try {
            await deleteStepAction(id)
            router.refresh()
            onClose() // simple refresh trigger
        } catch (e) {
            alert('Failed to delete')
        }
    }

    return (
        <div className="bg-black/80 rounded-lg p-4 border border-accent/20 space-y-4">
            <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-bold text-accent uppercase tracking-wider">Workflow Builder</h4>
                <button onClick={onClose} className="text-foreground/50 hover:text-white"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-2">
                {steps.sort((a: any, b: any) => a.position - b.position).map((step: any, idx: number) => (
                    <div key={step.id} className="flex items-center gap-3 bg-white/5 p-3 rounded hover:bg-white/10 group">
                        <div className="text-xs font-mono text-foreground/30">#{idx + 1}</div>
                        <div className="flex-1 font-medium text-sm">
                            {STEP_TYPES.find(t => t.type === step.type)?.label || step.type}
                        </div>
                        <button
                            onClick={() => handleDelete(step.id)}
                            className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>

            <div className="pt-4 border-t border-white/10">
                <div className="text-xs text-foreground/50 mb-2">Add a LEGO Block:</div>
                <div className="grid grid-cols-2 gap-2">
                    {STEP_TYPES.map(t => (
                        <button
                            key={t.type}
                            onClick={() => handleAdd(t.type)}
                            disabled={isSaving}
                            className="flex items-center gap-2 px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent/80 text-xs rounded transition-colors text-left"
                        >
                            <Plus className="w-3 h-3 shrink-0" />
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
