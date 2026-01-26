
import { SupabaseClient } from '@supabase/supabase-js'


export async function createDefaultWorkflowSteps(
    supabase: SupabaseClient,
    workflowId: string,
    pillarType: string,
    workflowContext: { name: string, goal: string }
) {
    let steps: any[] = []

    const isEngagement = /engage|reply|growth|interact|comment/i.test(workflowContext.name + workflowContext.goal)

    switch (pillarType) {
        case 'content_seo':
            steps = [
                { type: 'GENERATE_OUTLINE', position: 1, config: { prompt_type: 'outline' }, dependency_ids: [] },
                { type: 'GENERATE_DRAFT', position: 2, config: { prompt_type: 'full_article' }, dependency_ids: [] }, // Will need logic to verify dep on prev step in future
                { type: 'REVIEW_CONTENT', position: 3, config: {}, dependency_ids: [] },
                { type: 'POST_API', position: 4, config: {}, dependency_ids: [] }
            ]
            break;

        case 'paid_ads':
            steps = [
                { type: 'GENERATE_HOOKS', position: 1, config: { count: 5 }, dependency_ids: [] },
                { type: 'GENERATE_IMAGE', position: 2, config: { style: 'cinematic' }, dependency_ids: [] },
                { type: 'REVIEW_CONTENT', position: 3, config: {}, dependency_ids: [] }
            ]
            break;

        case 'social_organic':
        case 'community':
        default:
            if (isEngagement) {
                // **Complex Interaction Chains**
                steps = [
                    // 1. Discovery Phase
                    { type: 'SCAN_FEED', position: 1, config: { source: 'keywords', criteria: 'high_engagement' }, dependency_ids: [] },
                    // 2. Selection Phase (AI decides which posts are worth replying to)
                    { type: 'SELECT_TARGETS', position: 2, config: { max_select: 3 }, dependency_ids: [] },
                    // 3. Execution Phase
                    { type: 'GENERATE_REPLIES', position: 3, config: { tone: 'insightful' }, dependency_ids: [] },
                    { type: 'REVIEW_CONTENT', position: 4, config: {}, dependency_ids: [] },
                    { type: 'POST_REPLY', position: 5, config: {}, dependency_ids: [] }
                ]
            } else {
                // **Standard Content Creation**
                steps = [
                    { type: 'GENERATE_DRAFT', position: 1, config: { prompt_template: 'standard_v1' }, dependency_ids: [] },
                    { type: 'REVIEW_CONTENT', position: 2, config: {}, dependency_ids: [] },
                    { type: 'POST_API', position: 3, config: {}, dependency_ids: [] }
                ]
            }
            break;
    }

    // Assign workflow_id to all items
    const stepsToInsert = steps.map(s => ({ ...s, workflow_id: workflowId }))

    const { error } = await supabase.from('steps').insert(stepsToInsert)
    if (error) console.error("Failed to create steps for workflow", workflowId, error)
}
