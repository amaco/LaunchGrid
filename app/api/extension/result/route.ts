
import { createAdminClient } from '@/utils/supabase/admin'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

export async function POST(request: Request) {
    const supabase = createAdminClient() // Bypass RLS
    const body = await request.json()
    const { taskId, result } = body

    if (!taskId || !result) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    // Update the task with the result from the extension
    const { error } = await supabase
        .from('tasks')
        .update({
            status: 'review_needed', // Or completed? Review needed lets user see it.
            output_data: result,
            completed_at: new Date().toISOString()
        })
        .eq('id', taskId)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Attempt to revalidate the project page if possible, though strict dynamic paths are hard here.
    // We can't easily know the project ID without fetching the task first.
    // For now, accept that the UI needs a refresh or polling.

    return NextResponse.json({ success: true }, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
    })
}

export async function OPTIONS() {
    return NextResponse.json({}, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
    })
}
