'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateProjectContextAction(projectId: string, formData: FormData) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    const rawData = {
        name: formData.get('name') as string,
        description: formData.get('description') as string,
        audience: formData.get('audience') as string,
        painPoints: formData.get('painPoints') as string,
        budget: parseInt(formData.get('budget') as string) || 0,
    }

    // Update Project Entry
    // existing context should be merged or overwritten?
    // Let's overwrite specific fields but keep others if any (though currently we just have these)

    const { error } = await supabase
        .from('projects')
        .update({
            name: rawData.name,
            context: rawData // Overwriting the context JSON
        })
        .eq('id', projectId)
        .eq('user_id', user.id)

    if (error) throw new Error(error.message)

    revalidatePath(`/dashboard/project/${projectId}`)
}
