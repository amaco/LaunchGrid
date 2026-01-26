'use client'

import { useState } from 'react'
import { executeWorkflowAction } from '@/app/actions/execute-workflow'
import { Play, Loader2, CheckCircle } from 'lucide-react'

import { useRouter } from 'next/navigation'

export default function RunWorkflowButton({ workflowId }: { workflowId: string }) {
    const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
    const router = useRouter()

    const handleRun = async () => {
        setStatus('running')
        try {
            await executeWorkflowAction(workflowId)
            setStatus('done')
            router.refresh()
            // Optional: Open a modal to show the logical Draft?
            // For now, just show success.
            setTimeout(() => setStatus('idle'), 3000)
        } catch (error: any) {
            alert(error.message)
            setStatus('error')
            setTimeout(() => setStatus('idle'), 3000)
        }
    }

    if (status === 'done') {
        return (
            <button className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-green-400 cursor-default">
                <CheckCircle className="w-3 h-3" /> Done
            </button>
        )
    }

    return (
        <button
            onClick={handleRun}
            disabled={status === 'running'}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent hover:text-white transition-colors disabled:opacity-50"
        >
            {status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Run Workflow
        </button>
    )
}
