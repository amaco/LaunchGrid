'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

interface TaskStatusPollerProps {
    taskId: string
    initialStatus: string
    onStatusChange?: (newStatus: string, outputData: any) => void
}

/**
 * Polls for task status changes when task is in 'extension_queued' state
 * Uses Supabase realtime or polling to detect when extension completes
 */
export default function TaskStatusPoller({ taskId, initialStatus, onStatusChange }: TaskStatusPollerProps) {
    const router = useRouter()
    const [status, setStatus] = useState(initialStatus)

    const checkStatus = useCallback(async () => {
        const supabase = createClient()
        const { data, error } = await supabase
            .from('tasks')
            .select('status, output_data')
            .eq('id', taskId)
            .single()

        if (!error && data && data.status !== status) {
            console.log(`[TaskPoller] Status changed: ${status} → ${data.status}`)
            setStatus(data.status)
            onStatusChange?.(data.status, data.output_data)

            // Soft refresh the page data when status changes
            router.refresh()
        }
    }, [taskId, status, onStatusChange, router])

    useEffect(() => {
        // Only poll if task is waiting for extension
        if (status !== 'extension_queued') return

        console.log(`[TaskPoller] Starting poll for task ${taskId}`)

        // Poll every 2 seconds
        const interval = setInterval(checkStatus, 2000)

        // Also check immediately
        checkStatus()

        return () => {
            console.log(`[TaskPoller] Stopping poll for task ${taskId}`)
            clearInterval(interval)
        }
    }, [status, taskId, checkStatus])

    // This component doesn't render anything visible
    return null
}
