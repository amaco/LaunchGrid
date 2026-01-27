
import { createAdminClient } from '@/utils/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET() {
    const supabase = createAdminClient() // Bypass RLS

    // Find the oldest task waiting for the extension
    // "extension_queued" is the status we'll use
    const { data: task, error } = await supabase
        .from('tasks')
        .select(`
            *,
            step:steps(*)
        `)
        .eq('status', 'extension_queued')
        .order('created_at', { ascending: true })
        .limit(1)
        .single() // Expect 0 or 1

    if (error && error.code !== 'PGRST116') { // 116 is "No rows found"
        console.error("Supabase Error in /api/extension/tasks:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!task) {
        console.log("No 'extension_queued' tasks found in DB (RLS check?)")
        return NextResponse.json({ task: null }, {
            headers: { 'Access-Control-Allow-Origin': '*' }
        })
    }

    // Format for extension
    const payload = {
        taskId: task.id,
        type: task.step.type, // e.g., 'SCAN_FEED'
        platform: 'twitter', // We could derive this from pillar later
        config: {
            ...task.step.config,
            ...task.output_data
        }
    }

    return NextResponse.json({ task: payload }, {
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
