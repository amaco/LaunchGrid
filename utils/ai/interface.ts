/**
 * LaunchGrid AI Provider Interface
 * 
 * Following the constitution:
 * - AI is asynchronous and stateless
 * - AI consumes APIs and events, never databases
 */

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

/**
 * Blueprint - The AI-generated marketing strategy
 * Uses snake_case for JSON compatibility with AI responses
 */
export interface Blueprint {
    active_pillars: Array<{
        id: string;
        type: string;
        name: string;
    }>;
    workflows: Array<{
        workflow_id: string;
        pillar_ref: string;
        name: string;
        goal: string;
        frequency: string;
        description: string;
    }>;
}

/**
 * Normalized Blueprint for internal use (camelCase)
 */
export interface NormalizedBlueprint {
    activePillars: Array<{
        id: string;
        type: string;
        name: string;
    }>;
    workflows: Array<{
        workflowId: string;
        pillarRef: string;
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
    stepConfig?: Record<string, unknown>;
    previousOutput?: Record<string, unknown>;
    systemPrompt?: string;
    customPrompt?: string;
}

export interface ContentDraft {
    title?: string;
    content: string;
    hashtags: string[];
    suggestedImagePrompt?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Convert snake_case Blueprint from AI to camelCase for internal use
 */
export function normalizeBlueprint(blueprint: Blueprint): NormalizedBlueprint {
    return {
        activePillars: blueprint.active_pillars.map(p => ({
            id: p.id,
            type: p.type,
            name: p.name,
        })),
        workflows: blueprint.workflows.map(w => ({
            workflowId: w.workflow_id,
            pillarRef: w.pillar_ref,
            name: w.name,
            goal: w.goal,
            frequency: w.frequency,
            description: w.description,
        })),
    };
}
