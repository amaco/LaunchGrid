
import { createAdminClient } from '@/utils/supabase/admin'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { logUserAction } from '@/lib/events/audit-logger'

export async function POST(request: Request) {
    const supabase = createAdminClient() // Bypass RLS
    const body = await request.json()
    const { taskId, result } = body

    if (!taskId || !result) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    // First, get the task to find the project_id and user context
    const { data: task } = await supabase
        .from('tasks')
        .select('project_id, projects(user_id)')
        .eq('id', taskId)
        .single()

    // Update the task with the result from the extension
    const { error } = await supabase
        .from('tasks')
        .update({
            status: 'review_needed',
            output_data: result,
            completed_at: new Date().toISOString()
        })
        .eq('id', taskId)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Audit log the extension result
    const userId = (task?.projects as any)?.user_id || 'extension'
    await logUserAction(
        {
            organizationId: task?.project_id || 'unknown',
            userId: userId,
            requestId: `ext-${taskId}`,
        },
        'EXTENSION_SCAN_COMPLETE',
        'task',
        taskId,
        {
            itemCount: result?.found_items?.length || 0,
            summary: result?.summary || 'No summary',
        }
    )

    // Revalidate the project page so UI updates without manual refresh
    if (task?.project_id) {
        revalidatePath(`/dashboard/project/${task.project_id}`)
    }

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
