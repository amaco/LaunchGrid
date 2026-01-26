'use client'

import { useState, useEffect } from 'react'
import { saveUserSecretAction, hasUserSecretAction } from '@/app/actions/user-secrets'
import { Key, Save, CheckCircle, ShieldCheck } from 'lucide-react'

const PROVIDERS = [
    { id: 'openai_key', name: 'OpenAI API Key', placeholder: 'sk-...' },
    { id: 'gemini_key', name: 'Google Gemini Key', placeholder: 'AIza...' },
    { id: 'twitter_token', name: 'X (Twitter) Bearer Token', placeholder: 'AAAA...' },
    { id: 'discord_token', name: 'Discord Bot Token', placeholder: 'MTA...' },
]

export default function ApiKeyManager() {
    const [keys, setKeys] = useState<Record<string, string>>({})
    const [saving, setSaving] = useState<Record<string, boolean>>({})
    const [saved, setSaved] = useState<Record<string, boolean>>({})
    const [hasKey, setHasKey] = useState<Record<string, boolean>>({})

    // check which keys exist (but don't load them!)
    useEffect(() => {
        async function checkKeys() {
            const status: Record<string, boolean> = {}
            for (const p of PROVIDERS) {
                status[p.id] = await hasUserSecretAction(p.id)
            }
            setHasKey(status)
        }
        checkKeys()
    }, [])

    const handleSave = async (providerId: string) => {
        const key = keys[providerId]
        if (!key) return

        setSaving(prev => ({ ...prev, [providerId]: true }))

        try {
            await saveUserSecretAction(providerId, key)
            setKeys(prev => ({ ...prev, [providerId]: '' })) // Clear input for security
            setSaved(prev => ({ ...prev, [providerId]: true }))
            setHasKey(prev => ({ ...prev, [providerId]: true }))

            setTimeout(() => {
                setSaved(prev => ({ ...prev, [providerId]: false }))
            }, 3000)
        } catch (e: any) {
            alert('Failed to save: ' + e.message)
        } finally {
            setSaving(prev => ({ ...prev, [providerId]: false }))
        }
    }

    return (
        <div className="space-y-6">
            {PROVIDERS.map((provider) => (
                <div key={provider.id} className="glass p-6 group transition-all hover:border-accent/30">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold flex items-center gap-2 text-white">
                            <Key className="w-4 h-4 text-accent" />
                            {provider.name}
                        </h3>
                        {hasKey[provider.id] ? (
                            <span className="text-green-400 text-xs flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" /> Securely Stored
                            </span>
                        ) : (
                            <span className="text-foreground/30 text-xs">Not configured</span>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <input
                                type="password"
                                value={keys[provider.id] || ''}
                                onChange={(e) => setKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                                placeholder={hasKey[provider.id] ? "••••••••••••••••" : provider.placeholder}
                                className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-3 pr-10 text-sm font-mono focus:border-accent focus:ring-1 focus:ring-accent transition-all"
                            />
                        </div>

                        <button
                            onClick={() => handleSave(provider.id)}
                            disabled={saving[provider.id] || !keys[provider.id]}
                            className="bg-white/5 hover:bg-accent hover:text-white text-foreground/70 px-4 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving[provider.id] ? (
                                <span className="animate-spin text-xs">⏳</span>
                            ) : (
                                saved[provider.id] ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Save className="w-4 h-4" />
                            )}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    )
}
