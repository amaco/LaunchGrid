'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

interface TaskStatusPollerProps {
    taskId: string
    initialStatus: string
    onStatusChange?: (newStatus: string, outputData: any) => void
    onProgress?: (progress: string | null) => void
}

/**
 * Polls for task status changes when task is in 'extension_queued' or 'in_progress' state
 * 
 * Features:
 * - Polls every 2 seconds during active states
 * - Extracts and reports progress info
 * - Auto-stops when task completes or fails
 * - Soft refresh on status change
 */
export default function TaskStatusPoller({ 
    taskId, 
    initialStatus, 
    onStatusChange,
    onProgress 
}: TaskStatusPollerProps) {
    const router = useRouter()
    const [status, setStatus] = useState(initialStatus)
    const [lastProgress, setLastProgress] = useState<string | null>(null)
    const pollCountRef = useRef(0)

    // States that require polling
    const ACTIVE_STATES = ['extension_queued', 'in_progress']

    const checkStatus = useCallback(async () => {
        const supabase = createClient()
        const { data, error } = await supabase
            .from('tasks')
            .select('status, output_data')
            .eq('id', taskId)
            .single()

        if (error) {
            console.warn(`[TaskPoller] Error checking task ${taskId}:`, error)
            return
        }

        if (!data) return

        // Check for progress update
        const progressInfo = (data.output_data as any)?.progress_info
        if (progressInfo && progressInfo !== lastProgress) {
            setLastProgress(progressInfo)
            onProgress?.(progressInfo)
        }

        // Check for status change
        if (data.status !== status) {
            console.log(`[TaskPoller] Status changed: ${status} → ${data.status}`)
            setStatus(data.status)
            onStatusChange?.(data.status, data.output_data)

            // Clear progress when status changes to terminal state
            if (!ACTIVE_STATES.includes(data.status)) {
                setLastProgress(null)
                onProgress?.(null)
            }

            // Soft refresh the page data when status changes
            router.refresh()
        }

        pollCountRef.current++

        // Log occasionally for debugging
        if (pollCountRef.current % 10 === 0) {
            console.log(`[TaskPoller] Poll #${pollCountRef.current} for task ${taskId}, status: ${data.status}`)
        }
    }, [taskId, status, lastProgress, onStatusChange, onProgress, router])

    useEffect(() => {
        // Only poll if task is in an active state
        if (!ACTIVE_STATES.includes(status)) {
            console.log(`[TaskPoller] Task ${taskId} not in active state (${status}), stopping poll`)
            return
        }

        console.log(`[TaskPoller] Starting poll for task ${taskId} (status: ${status})`)
        pollCountRef.current = 0

        // Poll every 2 seconds
        const interval = setInterval(checkStatus, 2000)

        // Also check immediately
        checkStatus()

        return () => {
            console.log(`[TaskPoller] Stopping poll for task ${taskId}`)
            clearInterval(interval)
        }
    }, [status, taskId, checkStatus])

    // Update status when initialStatus prop changes
    useEffect(() => {
        if (initialStatus !== status) {
            setStatus(initialStatus)
        }
    }, [initialStatus])

    // This component doesn't render anything visible
    return null
}
