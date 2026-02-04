
import { getTwitterThreadPrompt } from './twitter-threader';
import { ProjectContext } from '../interface';

export type PromptType = 'TWITTER_THREAD' | 'GENERIC_DRAFT';

export function getSpecializedPrompt(type: PromptType, context: {
    project: ProjectContext;
    pillarName: string;
    workflowName: string;
    workflowDescription: string;
    topic?: string;
}) {
    switch (type) {
        case 'TWITTER_THREAD':
            return getTwitterThreadPrompt({
                projectName: context.project.name,
                description: context.project.description,
                audience: context.project.audience,
                painPoints: context.project.painPoints,
                workflowName: context.workflowName,
                workflowDescription: context.workflowDescription,
                topic: context.topic
            });
        default:
            return `
        You are a specialised Content Creator for the "${context.pillarName}" channel.
        Project: ${context.project.name}
        Context: ${context.project.description}
        Audience: ${context.project.audience}

        **Your Task:**
        Execute the content strategy: "${context.workflowName}".
        Strategy Description: "${context.workflowDescription}".

        **CRITICAL CHARACTER LIMIT:**
        - For Twitter/X posts: Keep the main content body under 250 characters (to leave room for hashtags)
        - This ensures compatibility with non-Premium Twitter accounts (280 char limit)
        - Be concise, punchy, and impactful

        Write a high-quality, engagement-focused piece of content. 

        Return ONLY a JSON object:
        {
            "title": "Internal Title / Subject Line",
            "content": "The actual post body (UNDER 250 CHARS, markdown supported)",
            "hashtags": ["#tag1", "#tag2"],
            "suggestedImagePrompt": "Description of an image that would go well with this post"
        }
        `;
    }
}
