'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { rerunStepAction } from '@/app/actions/execute-workflow';
import { useRouter } from 'next/navigation';

export default function RerunStepButton({
    taskId,
    workflowId,
    className = ""
}: {
    taskId: string;
    workflowId: string;
    className?: string;
}) {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    async function handleRerun(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (loading) return;
        setLoading(true);
        try {
            await rerunStepAction(taskId, workflowId);
            router.refresh();
        } catch (err) {
            console.error('Failed to rerun step:', err);
        } finally {
            setLoading(false);
        }
    }

    return (
        <button
            onClick={handleRerun}
            disabled={loading}
            className={`p-1 rounded hover:bg-white/10 transition-colors flex items-center justify-center ${className}`}
            title="Rerun this step"
        >
            <RefreshCw size={12} className={loading ? 'animate-spin text-blue-400' : 'text-white/40 hover:text-white/80'} />
        </button>
    );
}
