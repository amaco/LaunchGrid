export interface AIStrategyProvider {
    generateBlueprint(context: ProjectContext, apiKey?: string): Promise<Blueprint>;
    generateContent(task: TaskContext, apiKey?: string): Promise<ContentDraft>;
}

export interface ProjectContext {
    name: string;
    description: string;
    audience: string;
    painPoints: string;
    budget: number;
}

export interface Blueprint {
    active_pillars: Array<{ id: string; type: string; name: string }>;
    workflows: Array<{
        workflow_id: string;
        pillar_ref: string;
        name: string;
        goal: string;
        frequency: string;
        description: string;
    }>;
}

export interface TaskContext {
    project: ProjectContext;
    pillarName: string;
    workflowName: string;
    workflowDescription: string;
    stepConfig?: any;
}

export interface ContentDraft {
    title?: string;
    content: string;
    hashtags: string[];
    suggestedImagePrompt?: string;
}
