'use client'

import { useState } from 'react'
import { createProjectAction } from '@/app/actions/create-project'
import { ArrowRight, Sparkles, Target, DollarSign, AlertCircle } from 'lucide-react'

export default function NewProjectWizard() {
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setLoading(true)
        const formData = new FormData(e.currentTarget)
        try {
            await createProjectAction(formData)
        } catch (error) {
            console.error(error)
            setLoading(false)
            alert("Failed to generate strategy. Check API keys.")
        }
    }

    return (
        <div className="max-w-2xl mx-auto py-12">
            <div className="mb-10 text-center">
                <h1 className="text-4xl font-bold text-white mb-4 tracking-tighter">
                    Architect Your <span className="text-accent">Growth</span>
                </h1>
                <p className="text-foreground/50 text-lg">
                    Tell us about your product. Our AI CMO will design a custom 2026 marketing blueprint.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8 glass p-8">
                {/* Step 1: Identity */}
                <div className="space-y-4">
                    <label className="block text-sm font-medium text-accent uppercase tracking-widest">1. Product Identity</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input name="name" required placeholder="Product Name (e.g. Acme SaaS)" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 focus:border-accent focus:ring-1 focus:ring-accent transition-all" />
                        <input name="url" placeholder="Website URL (Optional)" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 focus:border-accent focus:ring-1 focus:ring-accent transition-all" />
                    </div>
                    <textarea name="description" required rows={3} placeholder="What does your product do? What is the core value proposition?" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 focus:border-accent focus:ring-1 focus:ring-accent transition-all" />
                </div>

                {/* Step 2: Market */}
                <div className="space-y-4">
                    <label className="block text-sm font-medium text-accent uppercase tracking-widest">2. Target Market</label>
                    <div className="flex gap-3">
                        <Target className="w-5 h-5 text-foreground/50 mt-3" />
                        <textarea name="audience" required rows={2} placeholder="Who is this for? (e.g. 'Solo founders building in public', 'Enterprise CTOs')" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 focus:border-accent focus:ring-1 focus:ring-accent transition-all" />
                    </div>
                    <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-foreground/50 mt-3" />
                        <textarea name="painPoints" required rows={2} placeholder="What keeps them up at night? (e.g. 'High churn', 'Complex deployments')" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 focus:border-accent focus:ring-1 focus:ring-accent transition-all" />
                    </div>
                </div>


                {/* Step 3: Resources */}
                <div className="space-y-4">
                    <label className="block text-sm font-medium text-accent uppercase tracking-widest">3. Resources & Intelligence</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-3 w-5 h-5 text-foreground/50" />
                            <input type="number" name="budget" required min="0" placeholder="Monthly Budget (USD)" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 pl-10 focus:border-accent focus:ring-1 focus:ring-accent transition-all" />
                        </div>
                        <div>
                            <select name="aiProvider" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-accent focus:ring-1 focus:ring-accent transition-all">
                                <option value="gemini">Google Gemini 2.0 (Fast & Free)</option>
                                <option value="openai">OpenAI GPT-4o (High Precision)</option>
                            </select>
                        </div>
                    </div>
                    <p className="text-xs text-foreground/40">* Ensure you have added the corresponding API Key in Settings.</p>
                </div>

                <button disabled={loading} className="w-full bg-white text-black font-bold py-4 rounded-xl hover:scale-[1.02] transition-transform flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading ? (
                        <span className="animate-pulse">Consulting AI Architect...</span>
                    ) : (
                        <>
                            Generate Blueprint <Sparkles className="w-5 h-5 text-purple-600 group-hover:rotate-12 transition-transform" />
                        </>
                    )}
                </button>
            </form>
        </div>
    )
}
