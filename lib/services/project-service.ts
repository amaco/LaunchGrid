/**
 * LaunchGrid Project Service
 * 
 * Owns: Projects, Blueprints
 * Following the constitution: strict service ownership, events emitted for all actions
 */

import { BaseService, ServiceContext } from './base-service';
import { validateInput, createProjectSchema, updateProjectSchema } from '../core/validation';
import { NotFoundError, DatabaseError, BusinessRuleError } from '../core/errors';
import type { Project, ProjectContext, Blueprint, AggregateType } from '../core/types';

export interface CreateProjectDTO {
  name: string;
  description: string;
  audience: string;
  painPoints: string;
  budget: number;
  aiProvider?: 'gemini' | 'openai' | 'anthropic';
}

export interface UpdateProjectDTO {
  name?: string;
  description?: string;
  audience?: string;
  painPoints?: string;
  budget?: number;
  aiProvider?: 'gemini' | 'openai' | 'anthropic';
}

export class ProjectService extends BaseService {
  protected serviceName = 'ProjectService';
  protected aggregateType: AggregateType = 'project';

  constructor(context: ServiceContext) {
    super(context);
  }

  /**
   * Create a new project
   */
  async create(input: CreateProjectDTO): Promise<Project> {
    return this.execute('create', async () => {
      // Validate input
      const validated = validateInput(createProjectSchema, input);

      // Check project limits for organization
      await this.checkProjectLimits();

      // Create project in database
      const { data, error } = await this.db
        .from('projects')
        .insert({
          user_id: this.userId,
          organization_id: this.organizationId,
          name: validated.name,
          context: validated,
          status: 'draft',
        })
        .select()
        .single();

      if (error) {
        throw new DatabaseError(`Failed to create project: ${error.message}`, 'INSERT');
      }

      // Emit event
      await this.emitEvent('PROJECT_CREATED', data.id, {
        name: validated.name,
        context: validated,
      });

      // Audit
      await this.audit('create', data.id, { name: validated.name });

      return this.mapToProject(data);
    });
  }

  /**
   * Get a project by ID
   */
  async getById(projectId: string): Promise<Project> {
    return this.execute('getById', async () => {
      const { data, error } = await this.db
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .eq('user_id', this.userId)
        .single();

      if (error || !data) {
        throw new NotFoundError('Project', projectId);
      }

      return this.mapToProject(data);
    });
  }

  /**
   * List projects for the current user
   */
  async list(options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ projects: Project[]; total: number }> {
    return this.execute('list', async () => {
      let query = this.db
        .from('projects')
        .select('*', { count: 'exact' })
        .eq('user_id', this.userId)
        .order('created_at', { ascending: false });

      if (options?.status) {
        query = query.eq('status', options.status);
      }
      if (options?.limit) {
        query = query.limit(options.limit);
      }
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
      }

      const { data, error, count } = await query;

      if (error) {
        throw new DatabaseError(`Failed to list projects: ${error.message}`, 'SELECT');
      }

      return {
        projects: (data || []).map(this.mapToProject),
        total: count || 0,
      };
    });
  }

  /**
   * Update a project
   */
  async update(projectId: string, input: UpdateProjectDTO): Promise<Project> {
    return this.execute('update', async () => {
      // Validate input
      const validated = validateInput(updateProjectSchema, input);

      // Get existing project
      const existing = await this.getById(projectId);

      // Build update object
      const updateData: Record<string, unknown> = {};
      const changes: Record<string, { old: unknown; new: unknown }> = {};

      if (validated.name && validated.name !== existing.name) {
        updateData.name = validated.name;
        changes.name = { old: existing.name, new: validated.name };
      }

      // Update context fields
      const newContext = { ...existing.context, ...validated };
      updateData.context = newContext;

      if (Object.keys(updateData).length === 0) {
        return existing; // No changes
      }

      // Update in database
      const { data, error } = await this.db
        .from('projects')
        .update(updateData)
        .eq('id', projectId)
        .eq('user_id', this.userId)
        .select()
        .single();

      if (error) {
        throw new DatabaseError(`Failed to update project: ${error.message}`, 'UPDATE');
      }

      // Emit event
      await this.emitEvent('PROJECT_UPDATED', projectId, {
        changes: Object.keys(changes),
      });

      // Audit changes
      if (Object.keys(changes).length > 0) {
        await this.auditChange('update', projectId, changes);
      }

      return this.mapToProject(data);
    });
  }

  /**
   * Delete a project
   */
  async delete(projectId: string): Promise<void> {
    return this.execute('delete', async () => {
      // Verify ownership first
      await this.getById(projectId);

      // Delete (cascades to related entities)
      const { error } = await this.db
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('user_id', this.userId);

      if (error) {
        throw new DatabaseError(`Failed to delete project: ${error.message}`, 'DELETE');
      }

      // Emit event
      await this.emitEvent('PROJECT_DELETED', projectId, {});

      // Audit
      await this.audit('delete', projectId);
    });
  }

  /**
   * Save generated blueprint to project
   */
  async saveBlueprint(projectId: string, blueprint: Blueprint): Promise<void> {
    return this.execute('saveBlueprint', async () => {
      // Verify ownership and get current context
      const existing = await this.getById(projectId);
      
      // Merge blueprint into existing context
      const updatedContext = {
        ...existing.context,
        blueprint,
      };

      // Store blueprint in context
      const { error } = await this.db
        .from('projects')
        .update({
          context: updatedContext,
        })
        .eq('id', projectId)
        .eq('user_id', this.userId);

      if (error) {
        throw new DatabaseError(`Failed to save blueprint: ${error.message}`, 'UPDATE');
      }

      // Emit event
      await this.emitEvent('BLUEPRINT_GENERATED', projectId, {
        pillarCount: blueprint.activePillars.length,
        workflowCount: blueprint.workflows.length,
      });

      // Audit
      await this.audit('saveBlueprint', projectId, {
        pillarCount: blueprint.activePillars.length,
        workflowCount: blueprint.workflows.length,
      });
    });
  }

  /**
   * Check project limits for organization
   */
  private async checkProjectLimits(): Promise<void> {
    // TODO: Implement actual limit checking based on organization plan
    const { count, error } = await this.db
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', this.userId);

    if (error) {
      throw new DatabaseError(`Failed to check project limits: ${error.message}`, 'SELECT');
    }

    const MAX_PROJECTS = 50; // Should come from organization settings
    if ((count || 0) >= MAX_PROJECTS) {
      throw new BusinessRuleError(
        `Project limit reached (${MAX_PROJECTS})`,
        'PROJECT_LIMIT_EXCEEDED'
      );
    }
  }

  /**
   * Map database row to Project type
   */
  private mapToProject(row: any): Project {
    return {
      id: row.id,
      organizationId: row.organization_id || row.user_id, // Fallback for migration
      userId: row.user_id,
      name: row.name,
      context: row.context || {},
      status: row.status || 'draft',
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at || row.created_at),
    };
  }
}
