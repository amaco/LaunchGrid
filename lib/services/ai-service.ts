/**
 * LaunchGrid AI Service
 * 
 * Following the constitution:
 * - AI is asynchronous and stateless
 * - AI consumes APIs and events, never databases
 * - Event → Fetch context via APIs → Generate output → Store via API → Emit event
 * - AI never blocks user actions
 */

import { BaseService, ServiceContext } from './base-service';
import { AIProviderError, ConfigurationError } from '../core/errors';
import { logAIDecision } from '../events/audit-logger';
import type { AIProviderID, Blueprint, ContentDraft, ProjectContext, AggregateType } from '../core/types';
import type {
  AIStrategyProvider,
  Blueprint as RawBlueprint,
  ContentDraft as RawContentDraft,
  ProjectContext as RawProjectContext,
  TaskContext as RawTaskContext
} from '../../utils/ai/interface';
import { getSpecializedPrompt, PromptType } from '../../utils/ai/prompts';

// ==========================================
// AI PROVIDER INTERFACE
// ==========================================

export interface AIProvider {
  generateBlueprint(context: ProjectContext, apiKey?: string): Promise<Blueprint>;
  generateContent(task: ContentTaskContext, apiKey?: string): Promise<ContentDraft>;
}

export interface ContentTaskContext {
  project: ProjectContext;
  pillarName: string;
  workflowName: string;
  workflowDescription: string;
  stepConfig?: Record<string, unknown>;
  previousOutput?: Record<string, unknown>;
  customPrompt?: string;
}

// ==========================================
// PROVIDER ADAPTER
// ==========================================

/**
 * Adapter to convert raw AI provider to our AIProvider interface
 */
class AIProviderAdapter implements AIProvider {
  constructor(private rawProvider: AIStrategyProvider) { }

  async generateBlueprint(context: ProjectContext, apiKey?: string): Promise<Blueprint> {
    const rawContext: RawProjectContext = {
      name: context.name,
      description: context.description,
      audience: context.audience,
      painPoints: context.painPoints,
      budget: context.budget,
    };

    const rawBlueprint = await this.rawProvider.generateBlueprint(rawContext, apiKey);

    // Convert snake_case to camelCase
    return {
      activePillars: rawBlueprint.active_pillars.map(p => ({
        id: p.id,
        type: p.type as any,
        name: p.name,
      })),
      workflows: rawBlueprint.workflows.map(w => ({
        workflowId: w.workflow_id,
        pillarRef: w.pillar_ref,
        name: w.name,
        goal: w.goal,
        frequency: w.frequency,
        description: w.description,
      })),
    };
  }

  async generateContent(task: ContentTaskContext, apiKey?: string): Promise<ContentDraft> {
    const rawTask: RawTaskContext = {
      project: {
        name: task.project.name,
        description: task.project.description,
        audience: task.project.audience,
        painPoints: task.project.painPoints,
        budget: task.project.budget,
      },
      pillarName: task.pillarName,
      workflowName: task.workflowName,
      workflowDescription: task.workflowDescription,
      stepConfig: task.stepConfig,
      previousOutput: task.previousOutput,
      customPrompt: task.customPrompt,
    };

    const rawContent = await this.rawProvider.generateContent(rawTask, apiKey);

    return {
      title: rawContent.title,
      content: rawContent.content,
      hashtags: rawContent.hashtags,
      suggestedImagePrompt: rawContent.suggestedImagePrompt,
    };
  }
}

// ==========================================
// AI SERVICE
// ==========================================

export class AIService extends BaseService {
  protected serviceName = 'AIService';
  protected aggregateType: AggregateType = 'task';

  private providers: Map<AIProviderID, AIProvider> = new Map();

  constructor(context: ServiceContext) {
    super(context);
    this.registerProviders();
  }

  /**
   * Register AI providers
   */
  private registerProviders(): void {
    // Lazy load providers to avoid circular dependencies
    // Providers are registered on first use
  }

  /**
   * Get an AI provider
   */
  private async getProvider(providerId: AIProviderID): Promise<AIProvider> {
    if (!this.providers.has(providerId)) {
      // Dynamically import and instantiate provider, then wrap with adapter
      switch (providerId) {
        case 'gemini':
          const { GeminiProvider } = await import('../../utils/ai/gemini');
          this.providers.set('gemini', new AIProviderAdapter(new GeminiProvider()));
          break;
        case 'openai':
          const { OpenAIProvider } = await import('../../utils/ai/openai');
          this.providers.set('openai', new AIProviderAdapter(new OpenAIProvider()));
          break;
        default:
          throw new ConfigurationError(`AI provider ${providerId} not implemented`);
      }
    }

    return this.providers.get(providerId)!;
  }

  /**
   * Get user's API key for a provider
   */
  private async getUserApiKey(providerId: AIProviderID): Promise<string | undefined> {
    const keyColumn = `${providerId}_key`;

    const { data } = await this.db
      .from('user_secrets')
      .select('*')
      .eq('user_id', this.userId)
      .single();

    if (!data) {
      return undefined;
    }

    // Access the key using the column name
    const encryptedKey = (data as Record<string, unknown>)[keyColumn] as string | undefined;

    if (!encryptedKey) {
      return undefined;
    }

    // Decrypt the key
    const { decrypt } = await import('../../utils/encryption');
    return decrypt(encryptedKey);
  }

  /**
   * Generate a marketing blueprint
   */
  async generateBlueprint(
    projectContext: ProjectContext,
    providerId: AIProviderID = 'gemini'
  ): Promise<Blueprint> {
    return this.execute('generateBlueprint', async () => {
      const startTime = Date.now();

      await this.emitEvent('AI_GENERATION_STARTED', 'blueprint', {
        provider: providerId,
        type: 'blueprint',
      });

      try {
        const provider = await this.getProvider(providerId);
        const apiKey = await this.getUserApiKey(providerId);

        const blueprint = await provider.generateBlueprint(projectContext, apiKey);

        const duration = Date.now() - startTime;

        // Log AI decision for audit
        await logAIDecision(
          {
            organizationId: this.organizationId,
            userId: this.userId,
            requestId: this.context.requestId,
          },
          providerId,
          'generateBlueprint',
          { projectName: projectContext.name, budget: projectContext.budget },
          { pillarCount: blueprint.activePillars.length, workflowCount: blueprint.workflows.length },
          duration
        );

        await this.emitEvent('AI_GENERATION_COMPLETED', 'blueprint', {
          provider: providerId,
          type: 'blueprint',
          duration,
        });

        return blueprint;
      } catch (error: any) {
        const duration = Date.now() - startTime;

        await this.emitEvent('AI_GENERATION_FAILED', 'blueprint', {
          provider: providerId,
          type: 'blueprint',
          error: error.message,
          duration,
        });

        throw new AIProviderError(
          providerId,
          error.message || 'Failed to generate blueprint',
          { duration }
        );
      }
    });
  }

  /**
   * Generate content for a workflow step
   */
  async generateContent(
    taskContext: ContentTaskContext,
    providerId: AIProviderID = 'gemini'
  ): Promise<ContentDraft> {
    return this.execute('generateContent', async () => {
      const startTime = Date.now();

      await this.emitEvent('AI_GENERATION_STARTED', taskContext.workflowName, {
        provider: providerId,
        type: 'content',
        pillar: taskContext.pillarName,
      });

      try {
        const provider = await this.getProvider(providerId);
        const apiKey = await this.getUserApiKey(providerId);

        // Check for specialized prompts
        let customPrompt: string | undefined;
        if (taskContext.pillarName.toLowerCase().includes('twitter') || taskContext.pillarName.toLowerCase().includes(' x')) {
          customPrompt = getSpecializedPrompt('TWITTER_THREAD', taskContext);
        }

        const content = await provider.generateContent({
          ...taskContext,
          customPrompt
        }, apiKey);

        const duration = Date.now() - startTime;

        // Log AI decision for audit
        await logAIDecision(
          {
            organizationId: this.organizationId,
            userId: this.userId,
            requestId: this.context.requestId,
          },
          providerId,
          'generateContent',
          {
            projectName: taskContext.project.name,
            pillar: taskContext.pillarName,
            workflow: taskContext.workflowName,
          },
          { hasTitle: !!content.title, contentLength: content.content.length },
          duration
        );

        await this.emitEvent('AI_GENERATION_COMPLETED', taskContext.workflowName, {
          provider: providerId,
          type: 'content',
          duration,
        });

        return content;
      } catch (error: any) {
        const duration = Date.now() - startTime;

        await this.emitEvent('AI_GENERATION_FAILED', taskContext.workflowName, {
          provider: providerId,
          type: 'content',
          error: error.message,
          duration,
        });

        throw new AIProviderError(
          providerId,
          error.message || 'Failed to generate content',
          { duration, pillar: taskContext.pillarName }
        );
      }
    });
  }

  /**
   * Generate replies for engagement workflow
   */
  async generateReplies(
    taskContext: ContentTaskContext,
    targets: Array<{ id: string; text: string; author?: string }>,
    providerId: AIProviderID = 'gemini'
  ): Promise<Array<{ targetId: string; reply: string }>> {
    return this.execute('generateReplies', async () => {
      const startTime = Date.now();

      await this.emitEvent('AI_GENERATION_STARTED', 'replies', {
        provider: providerId,
        type: 'replies',
        targetCount: targets.length,
      });

      try {
        const provider = await this.getProvider(providerId);
        const apiKey = await this.getUserApiKey(providerId);

        // Generate replies in parallel with rate limiting
        const replies = await Promise.all(
          targets.map(async (target, index) => {
            // Simple rate limiting: stagger requests
            if (index > 0) {
              await new Promise((resolve) => setTimeout(resolve, 200 * index));
            }

            // Custom prompt for natural, curiosity-generating replies
            const replyPrompt = `You're replying to a tweet on X/Twitter. Your goal is to add value AND subtly create curiosity.

ORIGINAL TWEET by @${target.author || 'user'}:
"${target.text}"

YOUR CONTEXT (don't mention directly):
- You use a tool that helps with: ${taskContext.project.description}
- You understand these struggles: ${taskContext.project.painPoints}

STRATEGY - CREATE CURIOSITY:
The goal is to make readers think "wait, what tool/method is this person using?" 
Share your RESULTS or EXPERIENCE in a way that makes people curious to ask you.
NEVER mention the product name. NEVER say "I use a tool that..." 

REPLY RULES:
1. Share a genuine insight or personal experience related to the topic
2. Hint at a method/system that helped you - but DON'T name it
3. Be specific with results when possible ("cut my revenge trades by 80%")
4. Sound like a regular trader sharing what worked for them
5. Keep it SHORT - 1-2 sentences. Natural, conversational.
6. NO emojis or max 1. More looks fake/spammy.
7. End in a way that invites curiosity or follow-up

EXAMPLES THAT CREATE CURIOSITY:
- "Same struggle here until I started tracking my entry times. Patterns became obvious after a few weeks."
- "The waiting game is real. I finally started logging when I take trades vs when I should - eye-opening data."
- "This. Took me 6 months of journaling to realize my best setups are always between 9:50-10:10."

BAD EXAMPLES (don't do this):
- "Try TradeRonin!" (naming product = spam)
- "I use an AI tool that..." (too obvious)
- "Great post! 🔥📈" (no value, just noise)
- "Have you tried journaling with [product]?" (direct pitch)

Return ONLY your reply text. No quotes, no labels, just the reply.`;

            const replyContext: ContentTaskContext = {
              ...taskContext,
              workflowName: `Reply to ${target.author || 'user'}`,
              workflowDescription: replyPrompt,
              customPrompt: replyPrompt,
            };

            const draft = await provider.generateContent(replyContext, apiKey);
            return {
              targetId: target.id,
              reply: draft.content,
              url: (target as any).url, // Pass through URL for extension
              author: target.author
            };
          })
        );

        const duration = Date.now() - startTime;

        // Log AI decision for audit
        await logAIDecision(
          {
            organizationId: this.organizationId,
            userId: this.userId,
            requestId: this.context.requestId,
          },
          providerId,
          'generateReplies',
          { targetCount: targets.length },
          { replyCount: replies.length },
          duration
        );

        await this.emitEvent('AI_GENERATION_COMPLETED', 'replies', {
          provider: providerId,
          type: 'replies',
          replyCount: replies.length,
          duration,
        });

        return replies;
      } catch (error: any) {
        const duration = Date.now() - startTime;

        await this.emitEvent('AI_GENERATION_FAILED', 'replies', {
          provider: providerId,
          type: 'replies',
          error: error.message,
          duration,
        });

        throw new AIProviderError(
          providerId,
          error.message || 'Failed to generate replies',
          { duration, targetCount: targets.length }
        );
      }
    });
  }


  /**
   * Filter and rank targets based on relevance
   */
  async filterTargets(
    taskContext: ContentTaskContext,
    items: Array<{ text: string; author?: string; url?: string }>,
    providerId: AIProviderID = 'gemini'
  ): Promise<Array<{ text: string; author?: string; reason?: string }>> {
    return this.execute('filterTargets', async () => {
      const startTime = Date.now();

      // If less than 3 items, just return them all
      if (items.length <= 3) {
        return items;
      }

      await this.emitEvent('AI_GENERATION_STARTED', 'filtering', {
        provider: providerId,
        type: 'filtering',
        itemCount: items.length,
      });

      try {
        console.log('[FilterTargets] Getting provider:', providerId);
        const provider = await this.getProvider(providerId);
        console.log('[FilterTargets] Got provider, getting API key...');
        const apiKey = await this.getUserApiKey(providerId);
        console.log('[FilterTargets] Got API key, length:', apiKey?.length || 0);

        // We reuse generateContent but with a specific prompt
        const filterPrompt = `
You are an EXTREMELY strict content curator for "${taskContext.project.name}".

PROJECT INFO:
- Name: ${taskContext.project.name}
- Description: ${taskContext.project.description}
- Target Audience: ${taskContext.project.audience}
- Pain Points We Solve: ${taskContext.project.painPoints}

YOUR TASK: Select ONLY posts that are DIRECTLY RELEVANT to our product/service.

STRICT RULES:
1. A post is relevant ONLY IF it discusses topics related to: ${taskContext.project.description}
2. IMMEDIATELY REJECT any post about: weather, sports, politics, travel, food, memes, or generic life updates.
3. IMMEDIATELY REJECT any off-topic engagement bait (high likes ≠ relevant).
4. The author must be talking about something our product can help with.

EXAMPLES of RELEVANT for a "Trading Journal App":
- "I keep making the same mistakes in my trades"
- "Need to track my trading performance better"
- "Looking for ways to improve my trading discipline"

EXAMPLES of IRRELEVANT (REJECT THESE):
- "Weather update: it escalated fast" (weather, irrelevant)
- "The streets of X university" (travel/lifestyle, irrelevant)
- "Best 4 hours learning to build" (generic, no connection to our app)

Analyze these posts:
${JSON.stringify(items.slice(0, 20), null, 2)}

Return ONLY a valid JSON array (max 5 items). If fewer than 5 are relevant, return fewer.
Format: [{ "text": "...", "author": "...", "reason": "Why this is relevant to ${taskContext.project.name}" }]
If NO posts are relevant, return an empty array: []
`;

        console.log('[FilterTargets] Calling AI with prompt length:', filterPrompt.length);
        const response = await provider.generateContent({
          ...taskContext,
          customPrompt: filterPrompt
        }, apiKey);
        console.log('[FilterTargets] AI response received, content length:', response?.content?.length || 0);

        // Attempt to parse the JSON response
        let selectedItems = [];
        try {
          // Robust JSON extraction: Find the first '[' and last ']'
          const jsonString = response.content;
          const startIndex = jsonString.indexOf('[');
          const endIndex = jsonString.lastIndexOf(']');

          if (startIndex !== -1 && endIndex !== -1) {
            const cleanJson = jsonString.substring(startIndex, endIndex + 1);
            selectedItems = JSON.parse(cleanJson);
          } else {
            throw new Error("No JSON array found in response");
          }
        } catch (e) {
          console.error("Failed to parse filter JSON. Raw response:", response.content);
          console.warn("Falling back to top 5 due to parse error", e);

          // Fallback but mark them as potentially unfiltered
          selectedItems = items.slice(0, 5).map(item => ({
            ...item,
            reason: "⚠️ Fallback: AI filtering failed, showing raw top result."
          }));
        }

        const duration = Date.now() - startTime;

        await logAIDecision(
          {
            organizationId: this.organizationId,
            userId: this.userId,
            requestId: this.context.requestId,
          },
          providerId,
          'filterTargets',
          { originalCount: items.length },
          { selectedCount: selectedItems.length },
          duration
        );

        return selectedItems;

      } catch (error: any) {
        throw new AIProviderError(
          providerId,
          error.message || 'Failed to filter targets',
          { duration: Date.now() - startTime }
        );
      }
    });
  }
}
