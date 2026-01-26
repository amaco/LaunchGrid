'use client'

import { useState } from 'react'
import { regenerateStrategyAction } from '@/app/actions/regenerate-project'
import { RefreshCw, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function RegenerateButton({ projectId }: { projectId: string }) {
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const handleRegenerate = async () => {
        if (!confirm("Are you sure? This will DELETE all current pillars and workflows and generate new ones based on the current Context.")) return

        setLoading(true)
        try {
            await regenerateStrategyAction(projectId)
            router.refresh()
        } catch (error: any) {
            alert(error.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <button
            onClick={handleRegenerate}
            disabled={loading}
            className="bg-accent/10 hover:bg-accent/20 text-accent px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 border border-accent/20"
        >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Re-Generate Strategy
        </button>
    )
}
