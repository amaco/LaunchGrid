'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export async function addStepAction(workflowId: string, type: string, position: number) {
    const supabase = await createClient()

    const { error } = await supabase.from('steps').insert({
        workflow_id: workflowId,
        type,
        position,
        config: {}
    })

    if (error) throw new Error(error.message)
    revalidatePath('/dashboard/project/[id]') // Wildcard revalidation not perfect but works for now or specific path
}

export async function deleteStepAction(stepId: string) {
    const supabase = await createClient()
    const { error } = await supabase.from('steps').delete().eq('id', stepId)
    if (error) throw new Error(error.message)
    revalidatePath('/dashboard/project/[id]')
}

export async function reorderStepsAction(steps: { id: string, position: number }[]) {
    const supabase = await createClient()

    for (const step of steps) {
        await supabase.from('steps').update({ position: step.position }).eq('id', step.id)
    }
    revalidatePath('/dashboard/project/[id]')
}
