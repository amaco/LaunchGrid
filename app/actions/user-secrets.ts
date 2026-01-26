'use server'

import { createClient } from '@/utils/supabase/server'
import { encrypt, decrypt } from '@/utils/encryption'
import { revalidatePath } from 'next/cache'

export async function saveUserSecretAction(providerId: string, value: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    if (!value) return; // Don't save empty values

    const encryptedValue = encrypt(value)

    const { error } = await supabase
        .from('user_secrets')
        .upsert({
            user_id: user.id,
            [providerId]: encryptedValue
        }, { onConflict: 'user_id' })

    if (error) throw new Error(error.message)

    revalidatePath('/dashboard/settings')
}

export async function hasUserSecretAction(providerId: string) {
    // Returns true if a key exists, without revealing it
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { data } = await supabase
        .from('user_secrets')
        .select(providerId)
        .eq('user_id', user.id)
        .single()

    // @ts-ignore
    return data && data[providerId] ? true : false
}
