
import ApiKeyManager from '@/components/settings/api-key-manager'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function SecretsPage() {
    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <Link href="/dashboard/settings" className="flex items-center gap-2 text-sm text-foreground/50 hover:text-white transition-colors mb-8">
                <ArrowLeft className="w-4 h-4" /> Back to Settings
            </Link>

            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Secrets Vault</h1>
                <p className="text-foreground/50">
                    Securely manage your API keys. These are encrypted at rest and never exposed to the client-side without authorization.
                </p>
            </div>

            <ApiKeyManager />
        </div>
    )
}
