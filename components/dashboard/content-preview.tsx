'use client'

import React, { useTransition } from 'react';
import { toggleItemSelectionAction } from '@/app/actions/manage-workflows';

interface ContentPreviewProps {
    content: any;
    title?: string;
    type?: string;
    taskId?: string;
}

export default function ContentPreview({ content, title, type, taskId }: ContentPreviewProps) {
    const [isPending, startTransition] = useTransition();

    if (!content) return null;

    const handleToggle = (idx: number, itemType: 'target' | 'reply') => {
        if (!taskId) return;
        startTransition(async () => {
            try {
                await toggleItemSelectionAction(taskId, idx, itemType);
            } catch (e) {
                console.error('Failed to toggle selection', e);
            }
        });
    }

    // Handle Batch Post Results
    if (typeof content === 'object' && content !== null && (content as any).results && (content as any).summary) {
        const batch = content as any;
        return (
            <div className="mt-2 bg-white/5 p-4 rounded-xl border border-white/10 text-xs shadow-inner">
                <div className="flex items-center gap-2 font-bold text-white mb-3 text-sm border-b border-white/5 pb-2 uppercase tracking-tight">
                    <span className="text-blue-400">Post Result</span>
                    <span className="text-foreground/40 ml-auto">{batch.summary}</span>
                </div>
                <div className="space-y-2">
                    {batch.results.map((res: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between bg-white/5 p-2 rounded border border-white/5 group">
                            <div className="flex items-center gap-2 truncate">
                                <div className={`w-1.5 h-1.5 rounded-full ${res.success ? 'bg-green-500' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                                <span className="text-foreground/60 truncate group-hover:text-blue-400 transition-colors">
                                    {res.url.split('/status/')[1] || res.url}
                                </span>
                            </div>
                            <div className={`text-[10px] px-1.5 py-0.5 rounded ${res.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                {res.success ? 'Posted' : 'Failed'}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Handle Array content (Targets or Replies)
    if (Array.isArray(content)) {
        return (
            <div className="mt-2 bg-white/5 p-4 rounded-xl border border-white/10 text-xs shadow-inner">
                {title && <div className="font-bold text-white mb-3 text-sm border-b border-white/5 pb-2 uppercase tracking-tight">{title}</div>}
                <div className="space-y-3">
                    {content.map((item: any, idx) => {
                        const isReply = item.reply !== undefined;
                        const isTarget = item.reason !== undefined;
                        const isSelectable = taskId && (isReply || isTarget);
                        const isSelected = item.selected !== false; // Default to true

                        return (
                            <div key={idx} className={`relative bg-white/5 rounded border transition-all ${isSelected ? 'border-white/10 opacity-100' : 'border-white/5 opacity-50'}`}>

                                {/* Header / Selection */}
                                <div className="flex items-start gap-3 p-3">
                                    {/* Checkbox */}
                                    {isSelectable && (
                                        <div className="mt-0.5 shrink-0">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => handleToggle(idx, isReply ? 'reply' : 'target')}
                                                disabled={isPending}
                                                className="w-4 h-4 rounded border-white/20 bg-black/50 accent-accent cursor-pointer disabled:opacity-50"
                                            />
                                        </div>
                                    )}

                                    <div className="space-y-2 w-full min-w-0">
                                        {/* Author / Metadata */}
                                        <div className="flex items-center gap-2">
                                            {item.author && <span className="text-blue-400 font-bold">@{item.author}</span>}
                                            {item.reason && <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-foreground/60 truncate max-w-[200px]">{item.reason}</span>}
                                        </div>

                                        {/* Original Text (Muted for Reply Context) */}
                                        {isReply && item.original_text && (
                                            <div className="pl-2 border-l-2 border-white/10 text-foreground/40 italic mb-2 py-1">
                                                "{item.original_text.length > 140 ? item.original_text.substring(0, 140) + '...' : item.original_text}"
                                            </div>
                                        )}

                                        {/* Main Content */}
                                        <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
                                            {item.reply || item.text || JSON.stringify(item)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        );
    }

    // Check if it's a thread (separated by ---)
    const isThread = typeof content === 'string' && content.includes('---');
    const parts = isThread
        ? (content as string).split('---').map(p => p.trim()).filter(Boolean)
        : [content];

    return (
        <div className="mt-2 bg-white/5 p-4 rounded-xl border border-white/10 text-xs shadow-inner">
            {title && <div className="font-bold text-white mb-3 text-sm border-b border-white/5 pb-2 uppercase tracking-tight">{title}</div>}

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
                                {typeof part === 'string' ? part : JSON.stringify(part, null, 2)}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
