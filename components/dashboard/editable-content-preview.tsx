'use client'

import React, { useState } from 'react'
import { Pencil, Save, X, Check } from 'lucide-react'

interface EditableContentPreviewProps {
    taskId: string
    content: string | any[]
    title?: string
    type?: string
    onSave?: (updatedContent: any) => Promise<void>
}

export default function EditableContentPreview({
    taskId,
    content,
    title,
    type,
    onSave
}: EditableContentPreviewProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [editedContent, setEditedContent] = useState<string>(
        typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    )
    const [isSaving, setIsSaving] = useState(false)

    if (!content) return null

    const handleSave = async () => {
        setIsSaving(true)
        try {
            let parsedContent = editedContent

            // Try to parse as JSON if it looks like JSON
            if (editedContent.trim().startsWith('[') || editedContent.trim().startsWith('{')) {
                try {
                    parsedContent = JSON.parse(editedContent)
                } catch {
                    // Keep as string if not valid JSON
                }
            }

            if (onSave) {
                await onSave(parsedContent)
            }
            setIsEditing(false)
        } catch (error) {
            console.error('Failed to save:', error)
        } finally {
            setIsSaving(false)
        }
    }

    const handleCancel = () => {
        setEditedContent(typeof content === 'string' ? content : JSON.stringify(content, null, 2))
        setIsEditing(false)
    }

    // Handle Array content (e.g. found_items, selected_items)
    if (Array.isArray(content) && !isEditing) {
        return (
            <div className="mt-2 bg-white/5 p-4 rounded-xl border border-white/10 text-xs shadow-inner relative group">
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => setIsEditing(true)}
                        className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white transition-all"
                        title="Edit content"
                    >
                        <Pencil className="w-3 h-3" />
                    </button>
                </div>

                {title && (
                    <div className="font-bold text-white mb-3 text-sm border-b border-white/5 pb-2 uppercase tracking-tight">
                        {title}
                    </div>
                )}
                <div className="space-y-3">
                    {content.map((item: any, idx) => (
                        <div key={idx} className="bg-white/5 p-2 rounded border border-white/5">
                            {item.author && <div className="text-blue-400 font-bold mb-1">@{item.author}</div>}
                            <div className="text-foreground/80 leading-relaxed whitespace-pre-wrap">{item.reply || item.text || item.content || JSON.stringify(item)}</div>
                            {item.reason && (
                                <div className="text-green-400/70 text-[10px] mt-1 italic">
                                    → {item.reason}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    // Edit mode (for both array and string content)
    if (isEditing) {
        return (
            <div className="mt-2 bg-white/5 p-4 rounded-xl border border-accent/30 text-xs shadow-inner">
                {title && (
                    <div className="font-bold text-white mb-3 text-sm border-b border-white/5 pb-2 uppercase tracking-tight flex items-center gap-2">
                        <Pencil className="w-3 h-3 text-accent" />
                        Editing: {title}
                    </div>
                )}

                <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full min-h-[200px] bg-black/30 border border-white/10 rounded-lg p-3 text-foreground/90 font-mono text-xs resize-y focus:outline-none focus:border-accent/50"
                    placeholder="Edit content here..."
                />

                <div className="flex justify-end gap-2 mt-3">
                    <button
                        onClick={handleCancel}
                        disabled={isSaving}
                        className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-white/70 hover:text-white transition-all text-xs flex items-center gap-1"
                    >
                        <X className="w-3 h-3" /> Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 rounded text-green-400 hover:text-green-300 transition-all text-xs flex items-center gap-1"
                    >
                        {isSaving ? (
                            <>Saving...</>
                        ) : (
                            <><Save className="w-3 h-3" /> Save Changes</>
                        )}
                    </button>
                </div>
            </div>
        )
    }

    // String content (non-edit mode)
    // Handle object with reply/content field
    let displayText: string = typeof content === 'string' ? content : ''
    if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
        // Extract the actual text from object - cast to any for dynamic property access
        const obj = content as Record<string, unknown>
        displayText = String(obj.reply || obj.content || obj.text || JSON.stringify(content, null, 2))
    }

    const isThread = typeof displayText === 'string' && displayText.includes('---')
    const parts = isThread
        ? (displayText as string).split('---').map(p => p.trim()).filter(Boolean)
        : [displayText]

    return (
        <div className="mt-2 bg-white/5 p-4 rounded-xl border border-white/10 text-xs shadow-inner relative group">
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={() => setIsEditing(true)}
                    className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white transition-all"
                    title="Edit content"
                >
                    <Pencil className="w-3 h-3" />
                </button>
            </div>

            {title && (
                <div className="font-bold text-white mb-3 text-sm border-b border-white/5 pb-2 uppercase tracking-tight">
                    {title}
                </div>
            )}

            <div className="space-y-4">
                {parts.map((part, index) => (
                    <div key={index} className="flex gap-3 relative">
                        {isThread && (
                            <div className="flex flex-col items-center shrink-0">
                                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-[10px]">
                                    {index + 1}
                                </div>
                                {index < parts.length - 1 && (
                                    <div className="w-[1px] h-full bg-white/10 my-1"></div>
                                )}
                            </div>
                        )}
                        <div className={`flex-1 ${isThread ? 'pt-0.5' : ''}`}>
                            <p className="text-foreground/80 leading-relaxed whitespace-pre-wrap">
                                {part}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

