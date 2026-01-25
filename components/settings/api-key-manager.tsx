'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Key, Save, Eye, EyeOff, CheckCircle } from 'lucide-react'

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
    const [showKey, setShowKey] = useState<Record<string, boolean>>({})
    const supabase = createClient()

    // Load existing keys (masked)
    useEffect(() => {
        async function loadKeys() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const { data } = await supabase.from('user_secrets').select('*').eq('user_id', user.id).single()
            if (data) {
                setKeys(data)
            }
        }
        loadKeys()
    }, [])

    const handleSave = async (providerId: string) => {
        const key = keys[providerId]
        if (!key) return

        setSaving(prev => ({ ...prev, [providerId]: true }))

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Upsert the specific key
        const updateData = { [providerId]: key, user_id: user.id }

        const { error } = await supabase
            .from('user_secrets')
            .upsert(updateData, { onConflict: 'user_id' })

        setSaving(prev => ({ ...prev, [providerId]: false }))

        if (!error) {
            setSaved(prev => ({ ...prev, [providerId]: true }))
            setTimeout(() => {
                setSaved(prev => ({ ...prev, [providerId]: false }))
            }, 3000)
        } else {
            alert('Failed to save key: ' + error.message)
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
                        {saved[provider.id] && (
                            <span className="text-green-400 text-xs flex items-center gap-1 animate-pulse">
                                <CheckCircle className="w-3 h-3" /> Saved Encrypted
                            </span>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <input
                                type={showKey[provider.id] ? "text" : "password"}
                                value={keys[provider.id] || ''}
                                onChange={(e) => setKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                                placeholder={provider.placeholder}
                                className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-3 pr-10 text-sm font-mono focus:border-accent focus:ring-1 focus:ring-accent transition-all"
                            />
                            <button
                                onClick={() => setShowKey(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                                className="absolute right-3 top-2.5 text-foreground/30 hover:text-white transition-colors"
                            >
                                {showKey[provider.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>

                        <button
                            onClick={() => handleSave(provider.id)}
                            disabled={saving[provider.id] || !keys[provider.id]}
                            className="bg-white/5 hover:bg-accent hover:text-white text-foreground/70 px-4 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving[provider.id] ? (
                                <span className="animate-spin text-xs">⏳</span>
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    )
}
