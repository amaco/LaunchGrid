
export interface AIStrategyProvider {
    generateBlueprint(context: ProjectContext, apiKey?: string): Promise<Blueprint>;
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
