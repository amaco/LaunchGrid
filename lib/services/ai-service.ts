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
  aiStrictness?: 'low' | 'medium' | 'high';
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

    let finalContent = rawContent.content;
    let finalTitle = rawContent.title;
    let finalHashtags = rawContent.hashtags;
    let finalImagePrompt = rawContent.suggestedImagePrompt;

    // Check if content is actually a JSON block (common with some models)
    if (finalContent && (finalContent.trim().startsWith('```json') || finalContent.trim().startsWith('{'))) {
      try {
        const jsonString = finalContent.substring(
          finalContent.indexOf('{'),
          finalContent.lastIndexOf('}') + 1
        );
        const parsed = JSON.parse(jsonString);

        // If parsed object has content/title fields, use them
        if (parsed.content || parsed.title) {
          finalContent = parsed.content || finalContent;
          finalTitle = parsed.title || finalTitle;
          finalHashtags = parsed.hashtags || finalHashtags;
          finalImagePrompt = parsed.suggestedImagePrompt || finalImagePrompt;
        }
      } catch (e) {
        // Failed to parse, use raw content but strip markdown if possible
        if (finalContent.trim().startsWith('```json')) {
          finalContent = finalContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        }
      }
    }

    return {
      title: finalTitle,
      content: finalContent,
      hashtags: finalHashtags,
      suggestedImagePrompt: finalImagePrompt,
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

            // Custom prompt for natural, high-context engagement
            const calibration = taskContext.config?.replyCalibration || 'subtle_hint';

            let styleInstruction = "";
            let goalInstruction = "";

            if (calibration === 'pure_engagement') {
              goalInstruction = "GOAL: Engage deeply/intelligently with the tweet. Do NOT mention your own project/product. Just be a helpful/insightful peer.";
              styleInstruction = "- STRICTLY FORBIDDEN: Mentioning your own product, app, or solution.\n- FOCUS: Adding value, validation, or a unique perspective.\n- TONE: Casual, supportive, expert.";
            } else if (calibration === 'subtle_hint') {
              goalInstruction = "GOAL: Engage deeply, then SUBTLY bridge to your worldview/philosophy.";
              styleInstruction = "- STRATEGY: 80% validation/insight about THEIR post, 20% bridging to a lesson learned that aligns with your product's philosophy.\n- TONE: Helpful peer sharing a finding.";
            } else if (calibration === 'direct_push') {
              goalInstruction = "GOAL: Validate their problem, then PITCH your solution as the fix.";
              styleInstruction = "- STRATEGY: Short validation, then immediately pivot to how your approach/tool solves this.\n- TONE: Confident, simplified, call-to-action.";
            }

            const replyPrompt = `You are an experienced colleague/peer in this niche. You are reacting to a post on X (Twitter).
            
${goalInstruction}

ORIGINAL TWEET by @${target.author || 'user'}:
"${target.text}"

YOUR BACKGROUND / WORLDVIEW:
- You believe in: ${taskContext.project.description}
- You validate problems like: ${taskContext.project.painPoints}

INSTRUCTIONS:
1. READ closely. Reference a specific keyword or concept from the tweet (e.g., if they mention "Tuesday", mention "Tuesday" or time-of-week).
2. VALIDATE their experience. Don't just say "I agree". Add a nuance.
3. ${calibration === 'pure_engagement' ? "Add a unique insight or validation." : "SUBTLY bridge to your worldview."}
4. ${styleInstruction}
5. NO robotic phrases like "I understand your sentiment" or "It is crucial to...". Speak like a person on Twitter.
6. Length: 1-2 conversational sentences. Lowercase beginning is okay if it fits the vibe.
7. MAX LENGTH: STRICTLY under 280 characters. Ideally under 200.

BAD EXAMPLES (Too robotic/salesy):
- "I totally agree! I used to struggle until I found a secret method."
- "Great post! Consistency is key."

GOOD EXAMPLES (Human, Specific):
- "The midday chop is brutal. I mostly stopped trading past 11am unless my setup is perfect, saved me so much headache."
- "Man, that level hold was clean. Usually I get stopped out there if I'm not watching the volume delta."
- "Actual data tracking is the only thing that fixed this for me. Feelings lie, the spreadsheet doesn't."

GENERATE REPLY:`;


            const replyContext: ContentTaskContext = {
              ...taskContext,
              workflowName: `Reply to ${target.author || 'user'}`,
              workflowDescription: replyPrompt,
              customPrompt: replyPrompt,
            };

            const draft = await provider.generateContent(replyContext, apiKey);
            return {
              targetId: target.id,
              reply: draft.content.length > 280 ? draft.content.substring(0, 277) + '...' : draft.content,
              url: (target as any).url, // Pass through URL for extension
              author: target.author,
              original_text: (target as any).text // Pass original text for context
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
   * Generate hooks for content
   */
  async generateHooks(
    taskContext: ContentTaskContext,
    providerId: AIProviderID = 'gemini'
  ): Promise<Array<{ text: string; selected: boolean }>> {
    return this.execute('generateHooks', async () => {
      const startTime = Date.now();

      await this.emitEvent('AI_GENERATION_STARTED', 'hooks', {
        provider: providerId,
        type: 'hooks',
      });

      try {
        const provider = await this.getProvider(providerId);
        const apiKey = await this.getUserApiKey(providerId);

        const prompt = `
You are a viral social media expert.
PROJECT: ${taskContext.project.name}
TOPIC: ${taskContext.project.description}
AUDIENCE: ${taskContext.project.audience}
PAIN POINTS: ${taskContext.project.painPoints}

TASK: Generate 5 curiosity-inducing, "scroll-stopping" hooks about the PROJECT TOPIC above.
CONTEXT/ANGLE: ${taskContext.workflowDescription || taskContext.pillarName}

REQUIREMENTS:
1. 1st person or direct address ("I", "You").
2. Short, punchy, under 280 chars.
3. Establish authority or empathy immediately.
4. NO hashtags, NO emojis, just the text.

FORMAT: Return ONLY a JSON array of strings.
Example: ["Stop doing X.", "I analyzed 1000 datasets...", "The biggest lie in marketing is..."]
`;

        const response = await provider.generateContent({
          ...taskContext,
          customPrompt: prompt
        }, apiKey);

        let rawHooks: string[] = [];
        try {
          const jsonString = response.content.substring(
            response.content.indexOf('['),
            response.content.lastIndexOf(']') + 1
          );
          rawHooks = JSON.parse(jsonString);
        } catch (e) {
          // Fallback: split by newlines if JSON fails
          rawHooks = response.content.split('\n').filter(line => line.length > 10).slice(0, 5);
        }

        // Convert to objects, 1st one selected by default
        const hooks = rawHooks.map((text, idx) => ({
          text,
          selected: idx === 0
        }));

        const duration = Date.now() - startTime;

        await logAIDecision(
          {
            organizationId: this.organizationId,
            userId: this.userId,
            requestId: this.context.requestId,
          },
          providerId,
          'generateHooks',
          { project: taskContext.project.name },
          { hookCount: hooks.length },
          duration
        );

        await this.emitEvent('AI_GENERATION_COMPLETED', 'hooks', {
          provider: providerId,
          type: 'hooks',
          count: hooks.length,
          duration,
        });

        return hooks;

      } catch (error: any) {
        throw new AIProviderError(
          providerId,
          error.message || 'Failed to generate hooks',
          { duration: Date.now() - startTime }
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
        // Determine strictness prompt
        const strictness = taskContext.aiStrictness || 'medium';
        let strictnessInstructions = '';

        if (strictness === 'high') {
          strictnessInstructions = `
STRICTNESS LEVEL: HIGH(EXTREMELY STRICT)
1. Select ONLY posts that are DIRECTLY related to the project.
2. If there is ANY doubt, REJECT the post.
3. Zero tolerance for spam, engagement bait, or tangentially related content.
4. Better to return NOTHING than a low - quality match.
          `;
        } else if (strictness === 'low') {
          strictnessInstructions = `
STRICTNESS LEVEL: LOW(PERMISSIVE)
            1. Be open - minded.If a post is even remotely relevant, or the author is a potential lead, SELECT IT.
2. Look for opportunities to pivot the conversation.
3. Spam / Scams are still rejected, but "lifestyle" posts from target audience are OK.
4. Prioritize finding at least 3 - 5 candidates.
          `;
        } else {
          // Medium (Default)
          strictnessInstructions = `
STRICTNESS LEVEL: MEDIUM(BALANCED)
            1. Prioritize strong matches, but include borderline ones if they look promising.
2. Avoid totally unrelated topics(weather, politics).
3. Quality over quantity, but try to find at least a few good matches.
          `;
        }

        const filterPrompt = `
You are a smart content curator for "${taskContext.project.name}".

PROJECT INFO:
              - Name: ${taskContext.project.name}
            - Description: ${taskContext.project.description}
            - Target Audience: ${taskContext.project.audience}
            - Pain Points We Solve: ${taskContext.project.painPoints}

YOUR TASK: Select the posts that are MOST RELEVANT to our product / service.

              ${strictnessInstructions}

EXAMPLES of RELEVANT for a "Trading Journal App":
              - "I keep making the same mistakes in my trades"
                - "Need to track my trading performance better"
                - "Looking for ways to improve my trading discipline"

EXAMPLES of IRRELEVANT(REJECT THESE):
            - "Weather update: it escalated fast"(weather, irrelevant)
              - "The streets of X university"(travel / lifestyle, irrelevant)
              - "Best 4 hours learning to build"(generic, no connection to our app)

Analyze these posts:
${JSON.stringify(items.slice(0, 20), null, 2)}

Return ONLY a valid JSON array(max 5 items).
              Format: [{ "id": "...", "reason": "Why this is relevant to ${taskContext.project.name}" }]
If NO posts are relevant, return an empty array: []
              `;

        console.log('[FilterTargets] Calling AI with prompt length:', filterPrompt.length);
        const response = await provider.generateContent({
          ...taskContext,
          customPrompt: filterPrompt
        }, apiKey);
        console.log('[FilterTargets] AI response received, content length:', response?.content?.length || 0);

        // Attempt to parse the JSON response
        let selectedItems: Array<any> = [];
        try {
          // Robust JSON extraction: Find the first '[' and last ']'
          const jsonString = response.content;
          const startIndex = jsonString.indexOf('[');
          const endIndex = jsonString.lastIndexOf(']');

          if (startIndex !== -1 && endIndex !== -1) {
            const cleanJson = jsonString.substring(startIndex, endIndex + 1);
            const parsedItems = JSON.parse(cleanJson);

            // Map back to original items to preserve URL/ID/Metadata
            selectedItems = parsedItems.map((selected: any) => {
              // Find original item by ID (robust string comparison)
              const original = items.find(i => String((i as any).id) === String(selected.id));
              if (!original) {
                console.warn('[FilterTargets] AI selected generic/invalid ID:', selected.id);
                return null;
              }
              return {
                ...original,
                reason: selected.reason
              };
            }).filter((item: any) => item !== null);

          } else {
            throw new Error("No JSON array found in response");
          }

          // If AI was too strict and returned nothing, fallback to top 3
          // This prevents "empty step" UI issues while preserving flow
          if (selectedItems.length === 0 && items.length > 0) {
            console.warn('[FilterTargets] AI returned 0 items. Falling back to top 3.');
            selectedItems = items.slice(0, 3).map(item => ({
              ...item,
              reason: "⚠️ Low relevance (Auto-selected as fallback)"
            }));
          }

        } catch (e) {
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
