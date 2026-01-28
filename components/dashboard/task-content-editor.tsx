'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import EditableContentPreview from './editable-content-preview'
import { updateTaskContentAction } from '@/app/actions/execute-workflow'

interface TaskContentEditorProps {
    taskId: string
    projectId: string
    content: any
    title?: string
    type?: string
    contentKey?: string // e.g., 'content', 'selected_items', 'found_items'
}

/**
 * Wrapper component that connects EditableContentPreview to the server action
 * for saving edited content back to the database.
 */
export default function TaskContentEditor({
    taskId,
    projectId,
    content,
    title,
    type,
    contentKey = 'content'
}: TaskContentEditorProps) {
    const [isPending, startTransition] = useTransition()
    const router = useRouter()

    const handleSave = async (updatedContent: any) => {
        startTransition(async () => {
            try {
                // Build the update payload with the correct key
                const updatePayload = {
                    [contentKey]: updatedContent
                }

                await updateTaskContentAction(taskId, projectId, updatePayload)
                router.refresh()
            } catch (error) {
                console.error('Failed to save content:', error)
                throw error
            }
        })
    }

    return (
        <EditableContentPreview
            taskId={taskId}
            content={content}
            title={title}
            type={type}
            onSave={handleSave}
        />
    )
}
