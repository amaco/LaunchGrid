'use client'

import { useState } from 'react'
import { updateProjectContextAction } from '@/app/actions/update-project'
import { Pencil, X, Save, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function EditContextButton({ project }: { project: any }) {
    const [isOpen, setIsOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const router = useRouter()

    const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setLoading(true)
        setErrorMsg(null)
        const formData = new FormData(e.currentTarget)

        try {
            await updateProjectContextAction(project.id, formData)
            setIsOpen(false)
            router.refresh()
        } catch (error: any) {
            console.error("Update failed:", error)
            setErrorMsg(error.message || 'Failed to update project')
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 border border-white/5 hover:border-white/20"
            >
                <Pencil className="w-3 h-3" /> Edit Context
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[#0A0A0A] border border-white/10 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl relative">
                        <div className="flex justify-between items-center p-6 border-b border-white/10">
                            <h3 className="text-xl font-bold text-white">Edit Strategy Context</h3>
                            <button onClick={() => setIsOpen(false)} className="text-foreground/50 hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {errorMsg && (
                            <div className="bg-red-500/10 border-l-2 border-red-500 p-4 mx-6 mt-6 text-red-200 text-sm">
                                {errorMsg}
                            </div>
                        )}

                        <form onSubmit={handleSave} className="p-6 space-y-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-foreground/70">Product Name</label>
                                    <input name="name" defaultValue={project.name} required className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-accent transition-colors" />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1 text-foreground/70">Description</label>
                                    <textarea name="description" defaultValue={project.context?.description} rows={3} required className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-accent transition-colors" />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1 text-foreground/70">Target Audience</label>
                                        <textarea name="audience" defaultValue={project.context?.audience} rows={2} required className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-accent transition-colors" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 text-foreground/70">Pain Points</label>
                                        <textarea name="painPoints" defaultValue={project.context?.painPoints} rows={2} required className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-accent transition-colors" />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1 text-foreground/70">Monthly Budget (USD)</label>
                                    <input type="number" name="budget" defaultValue={project.context?.budget} required min="0" className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-accent transition-colors" />
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                                <button type="button" onClick={() => setIsOpen(false)} className="px-4 py-2 hover:bg-white/5 rounded-lg text-sm text-foreground/70 transition-colors">Cancel</button>
                                <button disabled={loading} className="bg-white text-black px-6 py-2 rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors flex items-center gap-2">
                                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    )
}
