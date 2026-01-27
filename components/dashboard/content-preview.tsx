
import React from 'react';

interface ContentPreviewProps {
    content: string;
    title?: string;
    type?: string;
}

export default function ContentPreview({ content, title, type }: ContentPreviewProps) {
    if (!content) return null;

    // Handle Array content (e.g. found_items)
    if (Array.isArray(content)) {
        return (
            <div className="mt-2 bg-white/5 p-4 rounded-xl border border-white/10 text-xs shadow-inner">
                {title && <div className="font-bold text-white mb-3 text-sm border-b border-white/5 pb-2 uppercase tracking-tight">{title}</div>}
                <div className="space-y-3">
                    {content.map((item: any, idx) => (
                        <div key={idx} className="bg-white/5 p-2 rounded border border-white/5">
                            {item.author && <div className="text-blue-400 font-bold mb-1">@{item.author}</div>}
                            <div className="text-foreground/80 leading-relaxed">{item.text || JSON.stringify(item)}</div>
                        </div>
                    ))}
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
