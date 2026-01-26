'use client'

import { useState } from 'react'
import RunWorkflowButton from './run-workflow-button'
import WorkflowEditor from './workflow-editor'
import { Settings, X } from 'lucide-react'

export default function WorkflowCardActions({ workflow }: { workflow: any }) {
    const [isEditing, setIsEditing] = useState(false)

    if (isEditing) {
        return <WorkflowEditor workflow={workflow} onClose={() => setIsEditing(false)} />
    }

    return (
        <>
            <button
                onClick={() => setIsEditing(true)}
                className="text-foreground/30 hover:text-white transition-colors"
                title="Edit Workflow Steps"
            >
                <Settings className="w-4 h-4" />
            </button>
            <RunWorkflowButton workflowId={workflow.id} />
        </>
    )
}
