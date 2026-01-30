'use client'

import { useState } from 'react'
import { X, Save, AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { updateWorkflowAction } from '@/app/actions/manage-workflows'

export default function WorkflowSettings({ workflow, onClose }: { workflow: any, onClose: () => void }) {
    const [config, setConfig] = useState({
        requiresApproval: workflow.config?.requiresApproval ?? true,
        feedScanCount: workflow.config?.feedScanCount ?? 20,
        autoTrackEngagement: workflow.config?.autoTrackEngagement ?? true,
        aiStrictness: workflow.config?.aiStrictness ?? 'medium',
        aiStrictness: workflow.config?.aiStrictness ?? 'medium',
        replyCalibration: workflow.config?.replyCalibration ?? 'subtle_hint',
        timeout: workflow.config?.timeout ?? 30000,
    })
    const [isSaving, setIsSaving] = useState(false)
    const router = useRouter()

    const handleSave = async () => {
        setIsSaving(true)
        try {
            await updateWorkflowAction(workflow.id, {
                config: config
            })
            router.refresh()
            onClose()
        } catch (e: any) {
            console.error(e)
            alert(`Failed to save settings: ${e.message}`)
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="bg-black/95 rounded-lg p-6 border border-accent/20 space-y-6 w-full relative shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/10">
                <h4 className="text-lg font-bold text-accent uppercase tracking-wider flex items-center gap-2">
                    <span className="text-xl">⚙️</span> Settings
                </h4>
                <button
                    onClick={onClose}
                    className="text-foreground/50 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-full"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="space-y-6">

                {/* AI STRICTNESS */}
                <div className="group bg-white/5 p-4 rounded-lg border border-transparent hover:border-accent/30 transition-all">
                    <label className="block text-sm font-semibold text-white mb-2">AI Strictness</label>
                    <select
                        value={config.aiStrictness || 'medium'}
                        onChange={(e) => setConfig({ ...config, aiStrictness: e.target.value as any })}
                        className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-sm focus:border-accent focus:outline-none text-white"
                    >
                        <option value="low">Low (Permissive - Catch All)</option>
                        <option value="medium">Medium (Balanced)</option>
                        <option value="high">High (Strict - Perfect Matches Only)</option>
                    </select>
                    <p className="text-xs text-foreground/50 mt-2">
                        Controls how picky the AI is when selecting targets.
                        {config.aiStrictness === 'high' && <span className="text-amber-500 block mt-1">⚠️ 'High' may result in 0 targets if feed is low quality.</span>}
                    </p>
                </div>

                {/* REPLY CALIBRATION */}
                <div className="group bg-white/5 p-4 rounded-lg border border-transparent hover:border-accent/30 transition-all relative">
                    <label className="block text-sm font-semibold text-white mb-2 flex items-center gap-2">
                        Reply Calibration
                        <div className="relative group/tooltip cursor-help">
                            <span className="text-xs bg-white/20 rounded-full w-4 h-4 flex items-center justify-center text-white">?</span>
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 p-2 bg-black border border-white/20 rounded text-xs text-white opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl">
                                Controls how aggressively the AI mentions your project.
                            </div>
                        </div>
                    </label>
                    <select
                        value={config.replyCalibration || 'subtle_hint'}
                        onChange={(e) => setConfig({ ...config, replyCalibration: e.target.value as any })}
                        className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-sm focus:border-accent focus:outline-none text-white"
                    >
                        <option value="pure_engagement">Pure Engagement (No Project Mention)</option>
                        <option value="subtle_hint">Subtle Hint (The Standard)</option>
                        <option value="direct_push">Direct Push (Salesy/Bold)</option>
                    </select>
                    <p className="text-xs text-foreground/50 mt-2">
                        {config.replyCalibration === 'pure_engagement' && "Just helpful, human replies. Builds trust."}
                        {config.replyCalibration === 'subtle_hint' && "Engages first, then bridges to your worldview."}
                        {config.replyCalibration === 'direct_push' && <span className="text-amber-500">⚠️ Aggressively pitches the solution. Use carefully.</span>}
                    </p>
                </div>

                {/* AUTO TRACKING */}
                <div className="group bg-white/5 p-4 rounded-lg border border-transparent hover:border-accent/30 transition-all">
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-semibold text-white">Auto-Track Engagement</label>
                        <input
                            type="checkbox"
                            checked={config.autoTrackEngagement}
                            onChange={(e) => setConfig({ ...config, autoTrackEngagement: e.target.checked })}
                            className="w-5 h-5 accent-accent cursor-pointer"
                        />
                    </div>
                    <p className="text-xs text-foreground/60 leading-relaxed">
                        Automatically create a background tracking job for every post this workflow publishes.
                        Visible in the "Monitoring" tab.
                    </p>
                </div>

                {/* FEED SCAN LIMIT */}
                <div className="group bg-white/5 p-4 rounded-lg border border-transparent hover:border-accent/30 transition-all">
                    <label className="block text-sm font-semibold text-white mb-2">Feed Scan Limit</label>
                    <div className="flex items-center gap-3">
                        <input
                            type="number"
                            min={5}
                            max={100}
                            value={config.feedScanCount}
                            onChange={(e) => setConfig({ ...config, feedScanCount: parseInt(e.target.value) || 20 })}
                            className="bg-black/50 border border-white/20 rounded px-3 py-2 w-full text-sm focus:border-accent focus:outline-none"
                        />
                        <span className="text-xs text-foreground/40 whitespace-nowrap">posts / scan</span>
                    </div>
                    <p className="text-xs text-foreground/50 mt-2">
                        How many tweets the extension should scroll through when looking for targets.
                    </p>
                </div>

                {/* APPROVALS */}
                <div className="group bg-white/5 p-4 rounded-lg border border-transparent hover:border-accent/30 transition-all">
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-semibold text-white">Require Human Approval</label>
                        <input
                            type="checkbox"
                            checked={config.requiresApproval}
                            onChange={(e) => setConfig({ ...config, requiresApproval: e.target.checked })}
                            className="w-5 h-5 accent-accent cursor-pointer"
                        />
                    </div>
                    <p className="text-xs text-foreground/60 leading-relaxed">
                        If unchecked, the workflow will attempt to run autonomously (risky!).
                        <span className="text-amber-500 block mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Keep enabled for safety.
                        </span>
                    </p>
                </div>

            </div>

            <div className="pt-4 border-t border-white/10 flex justify-end gap-3">
                <button
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-medium text-foreground/60 hover:text-white transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-6 py-2 bg-accent hover:bg-accent/80 text-black font-bold text-xs rounded shadow-lg shadow-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                    <Save className="w-4 h-4" />
                </button>
            </div>
        </div>
    )
}
