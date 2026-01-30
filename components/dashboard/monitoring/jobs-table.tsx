'use client'

import { useState, useTransition } from 'react'
import { EngagementJob } from '@/lib/core/types'
import { triggerJobAction, stopJobAction } from '@/app/actions/manage-jobs'
import { Play, Square, ExternalLink, Loader2, Clock, CheckCircle, AlertCircle, BarChart2, Workflow } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface JobsTableProps {
    jobs: EngagementJob[]
    projectId: string
}

export function JobsTable({ jobs, projectId }: JobsTableProps) {
    const [isPending, startTransition] = useTransition()
    const [actionId, setActionId] = useState<string | null>(null)

    const handleRunNow = (jobId: string) => {
        setActionId(jobId)
        startTransition(async () => {
            await triggerJobAction(jobId, projectId)
            setActionId(null)
        })
    }

    const handleStop = (jobId: string) => {
        setActionId(jobId)
        startTransition(async () => {
            await stopJobAction(jobId, projectId)
            setActionId(null)
        })
    }

    if (jobs.length === 0) {
        return (
            <div className="text-center py-12 rounded-xl border border-white/5 bg-white/5 mx-auto max-w-2xl">
                <BarChart2 className="w-12 h-12 text-white/20 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">No Active Monitoring</h3>
                <p className="text-white/40 max-w-md mx-auto">
                    Engagement jobs appear here automatically when you complete a social posting workflow.
                </p>
            </div>
        )
    }

    return (
        <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
            <div className="overflow-x-visible">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-white/10 bg-white/5">
                            <th className="p-4 font-medium text-white/60">Target URL</th>
                            <th className="p-4 font-medium text-white/60">Source Workflow</th>
                            <th className="p-4 font-medium text-white/60">Status</th>
                            <th className="p-4 font-medium text-white/60">Metrics</th>
                            <th className="p-4 font-medium text-white/60">Schedule</th>
                            <th className="p-4 font-medium text-white/60 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {jobs.map((job) => {
                            const isBusy = isPending && actionId === job.id
                            const isActive = job.status === 'active'

                            return (
                                <tr key={job.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="p-4 max-w-[300px]">
                                        <div className="flex items-center gap-2">
                                            <a
                                                href={job.targetUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="truncate text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1"
                                            >
                                                {job.targetUrl.replace('https://', '')}
                                                <ExternalLink className="w-3 h-3 opacity-50" />
                                            </a>
                                        </div>
                                    </td>

                                    <td className="p-4">
                                        <div className="relative group/workflow w-fit">
                                            {job.workflowName ? (
                                                <>
                                                    <div className="flex items-center gap-2 cursor-help">
                                                        <span className="text-[10px] font-medium text-white/60 bg-white/5 px-2 py-1 rounded-md border border-white/5 group-hover/workflow:bg-white/10 transition-colors uppercase">
                                                            {job.sourceType?.replace('POST_', '').replace('_', ' ') || 'WF'}
                                                        </span>
                                                        {/* Visual hint for more info */}
                                                        <Workflow className="w-3 h-3 text-white/20 group-hover/workflow:text-white/40 transition-colors" />
                                                    </div>

                                                    {/* Custom Tooltip */}
                                                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 w-max max-w-[200px] bg-[#111] border border-white/10 rounded-lg p-2.5 shadow-xl opacity-0 group-hover/workflow:opacity-100 transition-all pointer-events-none z-50 -translate-x-2 group-hover/workflow:translate-x-0">
                                                        <div className="text-xs font-bold text-white mb-0.5 truncate">{job.workflowName}</div>
                                                        <div className="text-[10px] text-white/40 font-mono bg-white/5 px-1 rounded w-fit">
                                                            ID: {job.workflowId?.slice(0, 8)}...
                                                        </div>
                                                    </div>
                                                </>
                                            ) : (
                                                <span className="text-white/20 text-xs italic">Manual</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            {job.status === 'active' && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
                                            {job.status === 'completed' && <span className="w-2 h-2 rounded-full bg-blue-500" />}
                                            {job.status === 'expired' && <span className="w-2 h-2 rounded-full bg-white/20" />}
                                            {job.status === 'stopped' && <span className="w-2 h-2 rounded-full bg-red-500" />}
                                            <span className="capitalize text-white/80">{job.status}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-3 text-xs">
                                            <div className="flex flex-col">
                                                <span className="text-white/40 uppercase text-[10px] tracking-wider">Views</span>
                                                <span className="font-mono text-white/90">{job.lastMetrics.views?.toLocaleString() || '-'}</span>
                                            </div>
                                            <div className="w-px h-6 bg-white/10" />
                                            <div className="flex flex-col">
                                                <span className="text-white/40 uppercase text-[10px] tracking-wider">Likes</span>
                                                <span className="font-mono text-white/90">{job.lastMetrics.likes?.toLocaleString() || '-'}</span>
                                            </div>
                                            <div className="w-px h-6 bg-white/10" />
                                            <div className="flex flex-col">
                                                <span className="text-white/40 uppercase text-[10px] tracking-wider">Replies</span>
                                                <span className="font-mono text-white/90">{job.lastMetrics.replies?.toLocaleString() || '-'}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex flex-col gap-1 text-xs relative group/schedule w-fit cursor-help">
                                            {isActive && (
                                                <div className="flex items-center gap-1.5 text-emerald-400 font-medium bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20 w-fit">
                                                    <Clock className="w-3 h-3" />
                                                    <span>
                                                        {new Date(job.nextCheckAt) < new Date()
                                                            ? 'Now'
                                                            : formatDistanceToNow(new Date(job.nextCheckAt), { addSuffix: false })
                                                                .replace('less than a minute', '<1m')
                                                                .replace('minutes', 'm')
                                                                .replace('minute', 'm')
                                                                .replace('hours', 'h')
                                                                .replace('hour', 'h')
                                                        }
                                                    </span>
                                                </div>
                                            )}
                                            <div className="text-white/20 text-[10px] px-1">
                                                {formatDistanceToNow(new Date(job.expiresAt), { addSuffix: false })
                                                    .replace('days', 'd')
                                                    .replace('day', 'd')
                                                } left
                                            </div>

                                            {/* Schedule Tooltip */}
                                            <div className="absolute left-0 bottom-full mb-2 w-max bg-[#111] border border-white/10 rounded-lg p-3 shadow-xl opacity-0 group-hover/schedule:opacity-100 transition-all pointer-events-none z-50 translate-y-2 group-hover/schedule:translate-y-0">
                                                <div className="space-y-1">
                                                    <div className="text-xs text-white">
                                                        <span className="text-white/40">Next Check:</span>{' '}
                                                        {new Date(job.nextCheckAt).toLocaleTimeString()}
                                                    </div>
                                                    <div className="text-xs text-white">
                                                        <span className="text-white/40">Expires:</span>{' '}
                                                        {new Date(job.expiresAt).toLocaleDateString()}
                                                    </div>
                                                    <div className="text-xs text-white">
                                                        <span className="text-white/40">Interval:</span>{' '}
                                                        Every {job.checkIntervalMinutes}m
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {isActive ? (
                                                <>
                                                    <button
                                                        onClick={() => handleRunNow(job.id)}
                                                        disabled={isBusy}
                                                        className="p-1.5 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition-colors"
                                                        title="Run check now"
                                                    >
                                                        {isBusy && actionId === job.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleStop(job.id)}
                                                        disabled={isBusy}
                                                        className="p-1.5 hover:bg-red-500/20 rounded-md text-white/60 hover:text-red-400 transition-colors"
                                                        title="Stop tracking"
                                                    >
                                                        <Square className="w-4 h-4 fill-current" />
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => handleRunNow(job.id)}
                                                    disabled={isBusy}
                                                    className="p-1.5 hover:bg-green-500/20 rounded-md text-white/60 hover:text-green-400 transition-colors"
                                                    title="Restart tracking"
                                                >
                                                    <Play className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div >
        </div >
    )
}
