'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export async function deleteProjectAction(projectId: string) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    // Supabase set to 'cascade' delete on foreign keys, so this one query is enough
    const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('user_id', user.id)

    if (error) {
        throw new Error('Failed to delete project')
    }

    revalidatePath('/dashboard')
}
