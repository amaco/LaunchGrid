'use client'

import { useState } from 'react'
import { deleteProjectAction } from '@/app/actions/delete-project'
import { Trash2, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function DeleteProjectButton({ projectId }: { projectId: string }) {
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const handleDelete = async (e: React.MouseEvent) => {
        e.preventDefault() // Prevent link navigation
        e.stopPropagation() // Prevent bubbling

        if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) return

        setLoading(true)
        try {
            await deleteProjectAction(projectId)
            router.refresh()
        } catch (error) {
            alert('Failed to delete project')
            console.error(error)
            setLoading(false)
        }
    }

    return (
        <button
            onClick={handleDelete}
            disabled={loading}
            className="absolute top-4 left-4 p-2 rounded bg-black/50 text-red-400 hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-10"
            title="Delete Project"
        >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
    )
}
