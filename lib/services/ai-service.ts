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
}

// ==========================================
// PROVIDER ADAPTER
// ==========================================

/**
 * Adapter to convert raw AI provider to our AIProvider interface
 */
class AIProviderAdapter implements AIProvider {
  constructor(private rawProvider: AIStrategyProvider) {}

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

        const content = await provider.generateContent(taskContext, apiKey);

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

            const replyContext: ContentTaskContext = {
              ...taskContext,
              workflowName: `Reply to ${target.author || 'user'}`,
              workflowDescription: `Write a helpful, subtle reply to this tweet: "${target.text}"`,
            };

            const draft = await provider.generateContent(replyContext, apiKey);
            return { targetId: target.id, reply: draft.content };
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
}
