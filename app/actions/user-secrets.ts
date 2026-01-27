'use server'

/**
 * User Secrets Server Actions
 * 
 * Following the constitution:
 * - Encrypted secrets vault
 * - Full audit of user decisions
 */

import { createClient } from '@/utils/supabase/server'
import { encrypt } from '@/utils/encryption'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { validateInput, saveSecretSchema } from '@/lib/core/validation'
import { logSecurityEvent } from '@/lib/events/audit-logger'
import { ValidationError, AuthenticationError } from '@/lib/core/errors'

export async function saveUserSecretAction(providerId: string, value: string) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // Validate input
    const validated = validateInput(saveSecretSchema, { providerId, value })

    if (!validated.value) {
        throw new ValidationError('API key value is required')
    }

    // Encrypt the value
    const encryptedValue = encrypt(validated.value)

    // Upsert the secret
    const { error } = await supabase
        .from('user_secrets')
        .upsert({
            user_id: user.id,
            [validated.providerId]: encryptedValue,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })

    if (error) {
        console.error('Failed to save secret:', error)
        throw new Error('Failed to save API key')
    }

    // Audit log (don't log the actual value!)
    await logSecurityEvent(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'SECRET_UPDATED',
        { 
            provider: validated.providerId,
            // Never log the actual secret
        }
    )

    revalidatePath('/dashboard/settings')
    revalidatePath('/dashboard/settings/secrets')
}

export async function hasUserSecretAction(providerId: string): Promise<boolean> {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    // Validate providerId to prevent SQL injection-like issues
    const validProviders = ['openai_key', 'gemini_key', 'anthropic_key', 'twitter_token', 'discord_token']
    if (!validProviders.includes(providerId)) {
        return false
    }

    const { data } = await supabase
        .from('user_secrets')
        .select(providerId)
        .eq('user_id', user.id)
        .single()

    // @ts-expect-error - dynamic column access
    return !!(data && data[providerId])
}

export async function deleteUserSecretAction(providerId: string) {
    const supabase = await createClient()
    const requestId = nanoid()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new AuthenticationError('Unauthorized')

    // Validate providerId
    const validProviders = ['openai_key', 'gemini_key', 'anthropic_key', 'twitter_token', 'discord_token']
    if (!validProviders.includes(providerId)) {
        throw new ValidationError('Invalid provider ID')
    }

    // Set the specific key to null
    const { error } = await supabase
        .from('user_secrets')
        .update({
            [providerId]: null,
            updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)

    if (error) {
        console.error('Failed to delete secret:', error)
        throw new Error('Failed to delete API key')
    }

    // Audit log
    await logSecurityEvent(
        {
            organizationId: user.id,
            userId: user.id,
            requestId,
        },
        'SECRET_DELETED',
        { provider: providerId }
    )

    revalidatePath('/dashboard/settings')
    revalidatePath('/dashboard/settings/secrets')
}
