'use client'

import React, { useState, useTransition } from 'react'
import { Pencil, Save, X, Check } from 'lucide-react'
import { toggleItemSelectionAction } from '@/app/actions/manage-workflows'

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
    const [isPending, startTransition] = useTransition()
    const [isEditing, setIsEditing] = useState(false)
    // Helper to strip surrounding quotes if present (fixes over-stringified AI output)
    const cleanString = (str: any): string => {
        if (typeof str !== 'string') return str
        let s = str.trim()

        // Max 3 passes to handle double-escaped or nested quotes
        for (let i = 0; i < 3; i++) {
            let changed = false

            // Standard quotes
            if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
                s = s.slice(1, -1).replace(/\\"/g, '"')
                changed = true
            }
            // Single quotes
            else if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
                s = s.slice(1, -1).replace(/\\'/g, "'")
                changed = true
            }
            // Smart quotes
            else if (s.length >= 2 && (s.startsWith('“') || s.startsWith('”')) && (s.endsWith('”') || s.endsWith('“'))) {
                s = s.slice(1, -1)
                changed = true
            }

            if (!changed) break
            s = s.trim()
        }
        return s
    }

    const initializeContent = (c: any) => {
        if (typeof c === 'string') return cleanString(c)
        if (Array.isArray(c)) {
            return c.map(item => {
                if (typeof item === 'object' && item !== null) {
                    const newItem = { ...item }
                    if (newItem.reply) newItem.reply = cleanString(newItem.reply)
                    if (newItem.text) newItem.text = cleanString(newItem.text)
                    if (newItem.content) newItem.content = cleanString(newItem.content)
                    return newItem
                }
                return cleanString(item)
            })
        }
        return JSON.stringify(c, null, 2)
    }

    const [editedContent, setEditedContent] = useState<string | any[]>(
        initializeContent(content)
    )

    // Keep state in sync with props when not editing
    React.useEffect(() => {
        if (!isEditing) {
            setEditedContent(initializeContent(content))
        }
    }, [content, isEditing])
    const [isSaving, setIsSaving] = useState(false)

    if (!content) return null

    const handleSave = async () => {
        setIsSaving(true)
        try {
            let parsedContent = editedContent

            // If it's a string, try to parse it (unless it was originally a string)
            if (typeof editedContent === 'string' && typeof content !== 'string') {
                if (editedContent.trim().startsWith('[') || editedContent.trim().startsWith('{')) {
                    try {
                        parsedContent = JSON.parse(editedContent)
                    } catch {
                        // Keep as string if not valid JSON
                    }
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
        setEditedContent(
            typeof content === 'string' ? content : (Array.isArray(content) ? [...content] : JSON.stringify(content, null, 2))
        )
        setIsEditing(false)
    }

    const handleArrayItemChange = (index: number, value: string) => {
        if (Array.isArray(editedContent)) {
            const newContent = [...editedContent];
            // Update the main text field of the item
            if (typeof newContent[index] === 'object') {
                if ('reply' in newContent[index]) newContent[index] = { ...newContent[index], reply: value };
                else if ('text' in newContent[index]) newContent[index] = { ...newContent[index], text: value };
                else if ('content' in newContent[index]) newContent[index] = { ...newContent[index], content: value };
                else newContent[index] = value; // Fallback
            } else {
                newContent[index] = value;
            }
            setEditedContent(newContent);
        }
    }

    // Handle Array content (View Mode)
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
                    {content.map((item: any, idx) => {
                        const isString = typeof item === 'string'
                        const isSelected = !isString ? item.selected !== false : true // Default string to selected/true (no checkbox logic for now)
                        const isReply = !isString && item.reply !== undefined

                        return (
                            <div key={idx} className={`relative bg-white/5 p-3 rounded border transition-all flex gap-3 ${isSelected ? 'border-white/5 opacity-100' : 'border-white/5 opacity-40'}`}>
                                {/* Checkbox */}
                                <div className="mt-1 shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => {
                                            startTransition(async () => {
                                                try {
                                                    await toggleItemSelectionAction(
                                                        taskId,
                                                        idx,
                                                        isReply ? 'reply' : (isString || (!isReply && !item.reason)) ? 'hook' : 'target'
                                                    )
                                                } catch (err) {
                                                    console.error('Failed to toggle', err)
                                                }
                                            })
                                        }}
                                        className="w-4 h-4 rounded border-white/20 bg-black/50 accent-accent cursor-pointer"
                                    />
                                </div>

                                <div className="flex-1 min-w-0">
                                    {isString ? (
                                        <div className="text-foreground/80 leading-relaxed whitespace-pre-wrap">{cleanString(item)}</div>
                                    ) : (
                                        <>
                                            {item.author && <div className="text-blue-400 font-bold mb-1">@{item.author.replace(/^@/, '')}</div>}

                                            {/* Original Text Context */}
                                            {item.original_text && (
                                                <div className="pl-2 border-l-2 border-white/10 text-foreground/40 italic mb-2 py-1 text-[10px] leading-relaxed">
                                                    "{item.original_text.length > 150 ? item.original_text.substring(0, 150) + '...' : item.original_text}"
                                                </div>
                                            )}

                                            <div className="text-foreground/80 leading-relaxed whitespace-pre-wrap">{cleanString(item.reply || item.text || item.content || JSON.stringify(item))}</div>
                                            {item.reason && (
                                                <div className="text-green-400/70 text-[10px] mt-1 italic">
                                                    → {item.reason}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    // Edit mode
    if (isEditing) {
        return (
            <div className="mt-2 bg-white/5 p-4 rounded-xl border border-accent/30 text-xs shadow-inner">
                {title && (
                    <div className="font-bold text-white mb-3 text-sm border-b border-white/5 pb-2 uppercase tracking-tight flex items-center gap-2">
                        <Pencil className="w-3 h-3 text-accent" />
                        Editing: {title}
                    </div>
                )}

                {Array.isArray(editedContent) ? (
                    <div className="space-y-4">
                        {editedContent.map((item: any, idx) => (
                            <div key={idx} className="bg-black/20 p-3 rounded border border-white/10">
                                {typeof item === 'object' && item.author && (
                                    <div className="text-blue-400 font-bold mb-2 text-xs">
                                        Replying to: @{item.author.replace('@', '')}
                                    </div>
                                )}
                                <textarea
                                    value={typeof item === 'string' ? item : (item.reply || item.text || item.content || JSON.stringify(item))}
                                    onChange={(e) => handleArrayItemChange(idx, e.target.value)}
                                    className="w-full min-h-[80px] bg-black/30 border border-white/10 rounded p-2 text-foreground/90 font-mono text-xs resize-y focus:outline-none focus:border-accent/50"
                                    placeholder="Enter text..."
                                />
                            </div>
                        ))}
                    </div>
                ) : (
                    <textarea
                        value={editedContent as string}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full min-h-[200px] bg-black/30 border border-white/10 rounded-lg p-3 text-foreground/90 font-mono text-xs resize-y focus:outline-none focus:border-accent/50"
                        placeholder="Edit content here..."
                    />
                )}

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

