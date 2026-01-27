/**
 * LaunchGrid Workflow Service
 * 
 * Owns: Workflows, Steps, Workflow State
 * Following the constitution:
 * - Workflows are declarative, not hardcoded
 * - Config-driven (JSON/state machine)
 * - Independent from AI and integrations
 */

import { BaseService, ServiceContext } from './base-service';
import { validateInput, createWorkflowSchema, updateWorkflowSchema, createStepSchema, reorderStepsSchema } from '../core/validation';
import { NotFoundError, DatabaseError, WorkflowError, BusinessRuleError } from '../core/errors';
import type { Workflow, Step, WorkflowConfig, StepType, AggregateType } from '../core/types';

// ==========================================
// WORKFLOW STATE MACHINE
// ==========================================

export type WorkflowState = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface WorkflowTransition {
  from: WorkflowState[];
  to: WorkflowState;
  action: string;
}

const WORKFLOW_TRANSITIONS: WorkflowTransition[] = [
  { from: ['idle', 'paused'], to: 'running', action: 'start' },
  { from: ['running'], to: 'paused', action: 'pause' },
  { from: ['running'], to: 'completed', action: 'complete' },
  { from: ['running'], to: 'failed', action: 'fail' },
  { from: ['paused', 'failed'], to: 'idle', action: 'reset' },
];

// ==========================================
// STEP EXECUTION ORDER
// ==========================================

export interface ExecutableStep {
  step: Step;
  canExecute: boolean;
  blockedBy: string[];
  completedDependencies: string[];
}

// ==========================================
// WORKFLOW SERVICE
// ==========================================

export class WorkflowService extends BaseService {
  protected serviceName = 'WorkflowService';
  protected aggregateType: AggregateType = 'workflow';

  constructor(context: ServiceContext) {
    super(context);
  }

  /**
   * Create a new workflow
   */
  async create(input: {
    projectId: string;
    pillarId: string;
    name: string;
    description?: string;
    phase?: string;
    config?: Partial<WorkflowConfig>;
  }): Promise<Workflow> {
    return this.execute('create', async () => {
      const validated = validateInput(createWorkflowSchema, input);

      // Verify project access
      await this.verifyProjectAccess(validated.projectId);

      // Create workflow
      const { data, error } = await this.db
        .from('workflows')
        .insert({
          project_id: validated.projectId,
          pillar_id: validated.pillarId,
          name: validated.name,
          description: validated.description || '',
          phase: validated.phase || 'launch',
          status: 'draft',
          config: validated.config || this.getDefaultConfig(),
        })
        .select()
        .single();

      if (error) {
        throw new DatabaseError(`Failed to create workflow: ${error.message}`, 'INSERT');
      }

      await this.emitEvent('WORKFLOW_CREATED', data.id, {
        projectId: validated.projectId,
        name: validated.name,
      });

      await this.audit('create', data.id, { name: validated.name });

      return this.mapToWorkflow(data);
    });
  }

  /**
   * Get workflow by ID with steps
   */
  async getById(workflowId: string): Promise<Workflow & { steps: Step[] }> {
    return this.execute('getById', async () => {
      const { data, error } = await this.db
        .from('workflows')
        .select(`
          *,
          steps(*)
        `)
        .eq('id', workflowId)
        .single();

      if (error || !data) {
        throw new NotFoundError('Workflow', workflowId);
      }

      // Verify access via project
      await this.verifyProjectAccess(data.project_id);

      return {
        ...this.mapToWorkflow(data),
        steps: (data.steps || [])
          .map((s: any) => this.mapToStep(s))
          .sort((a: Step, b: Step) => a.position - b.position),
      };
    });
  }

  /**
   * List workflows for a project
   */
  async listByProject(projectId: string): Promise<Workflow[]> {
    return this.execute('listByProject', async () => {
      await this.verifyProjectAccess(projectId);

      const { data, error } = await this.db
        .from('workflows')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (error) {
        throw new DatabaseError(`Failed to list workflows: ${error.message}`, 'SELECT');
      }

      return (data || []).map(this.mapToWorkflow);
    });
  }

  /**
   * Update a workflow
   */
  async update(workflowId: string, input: {
    name?: string;
    description?: string;
    phase?: string;
    status?: string;
    config?: Partial<WorkflowConfig>;
  }): Promise<Workflow> {
    return this.execute('update', async () => {
      const validated = validateInput(updateWorkflowSchema, input);
      const existing = await this.getById(workflowId);

      const updateData: Record<string, unknown> = {};
      if (validated.name) updateData.name = validated.name;
      if (validated.description !== undefined) updateData.description = validated.description;
      if (validated.phase) updateData.phase = validated.phase;
      if (validated.status) {
        this.validateStatusTransition(existing.status, validated.status);
        updateData.status = validated.status;
      }
      if (validated.config) {
        updateData.config = { ...existing.config, ...validated.config };
      }

      const { data, error } = await this.db
        .from('workflows')
        .update(updateData)
        .eq('id', workflowId)
        .select()
        .single();

      if (error) {
        throw new DatabaseError(`Failed to update workflow: ${error.message}`, 'UPDATE');
      }

      await this.audit('update', workflowId, { changes: Object.keys(updateData) });

      return this.mapToWorkflow(data);
    });
  }

  /**
   * Delete a workflow
   */
  async delete(workflowId: string): Promise<void> {
    return this.execute('delete', async () => {
      const workflow = await this.getById(workflowId);

      const { error } = await this.db
        .from('workflows')
        .delete()
        .eq('id', workflowId);

      if (error) {
        throw new DatabaseError(`Failed to delete workflow: ${error.message}`, 'DELETE');
      }

      await this.audit('delete', workflowId);
    });
  }

  // ==========================================
  // STEP MANAGEMENT
  // ==========================================

  /**
   * Add a step to a workflow
   */
  async addStep(input: {
    workflowId: string;
    type: StepType;
    config?: Record<string, unknown>;
    dependencyIds?: string[];
    position: number;
  }): Promise<Step> {
    return this.execute('addStep', async () => {
      const validated = validateInput(createStepSchema, input);
      
      // Verify workflow access
      await this.getById(validated.workflowId);

      const { data, error } = await this.db
        .from('steps')
        .insert({
          workflow_id: validated.workflowId,
          type: validated.type,
          config: validated.config || {},
          dependency_ids: validated.dependencyIds || [],
          position: validated.position,
        })
        .select()
        .single();

      if (error) {
        throw new DatabaseError(`Failed to add step: ${error.message}`, 'INSERT');
      }

      await this.emitEvent('STEP_CREATED', data.id, {
        workflowId: validated.workflowId,
        type: validated.type,
        position: validated.position,
      });

      return this.mapToStep(data);
    });
  }

  /**
   * Remove a step from a workflow
   */
  async removeStep(stepId: string): Promise<void> {
    return this.execute('removeStep', async () => {
      // Get step to verify access
      const { data: step, error: stepError } = await this.db
        .from('steps')
        .select('*, workflow:workflows(*)')
        .eq('id', stepId)
        .single();

      if (stepError || !step) {
        throw new NotFoundError('Step', stepId);
      }

      await this.verifyProjectAccess(step.workflow.project_id);

      const { error } = await this.db
        .from('steps')
        .delete()
        .eq('id', stepId);

      if (error) {
        throw new DatabaseError(`Failed to delete step: ${error.message}`, 'DELETE');
      }

      await this.audit('removeStep', stepId, { workflowId: step.workflow_id });
    });
  }

  /**
   * Reorder steps in a workflow
   */
  async reorderSteps(
    workflowId: string,
    steps: Array<{ id: string; position: number }>
  ): Promise<void> {
    return this.execute('reorderSteps', async () => {
      const validated = validateInput(reorderStepsSchema, steps);
      
      // Verify workflow access
      await this.getById(workflowId);

      // Update positions in a transaction-like manner
      for (const step of validated) {
        const { error } = await this.db
          .from('steps')
          .update({ position: step.position })
          .eq('id', step.id);

        if (error) {
          throw new DatabaseError(`Failed to reorder step: ${error.message}`, 'UPDATE');
        }
      }

      await this.audit('reorderSteps', workflowId, { stepCount: steps.length });
    });
  }

  // ==========================================
  // WORKFLOW EXECUTION LOGIC
  // ==========================================

  /**
   * Get the next executable step in a workflow
   */
  async getNextExecutableStep(workflowId: string): Promise<ExecutableStep | null> {
    return this.execute('getNextExecutableStep', async () => {
      const workflow = await this.getById(workflowId);

      // Get all tasks for this workflow's steps
      const stepIds = workflow.steps.map((s) => s.id);
      const { data: tasks } = await this.db
        .from('tasks')
        .select('*')
        .in('step_id', stepIds);

      const taskMap = new Map((tasks || []).map((t: any) => [t.step_id, t]));

      // Find the first step that can be executed
      for (const step of workflow.steps) {
        const task = taskMap.get(step.id);
        const isCompleted = task?.status === 'completed' || task?.status === 'review_needed';

        if (!isCompleted) {
          // Check dependencies
          const blockedBy: string[] = [];
          const completedDeps: string[] = [];

          for (const depId of step.dependencyIds) {
            const depTask = taskMap.get(depId);
            if (!depTask || (depTask.status !== 'completed' && depTask.status !== 'review_needed')) {
              blockedBy.push(depId);
            } else {
              completedDeps.push(depId);
            }
          }

          return {
            step,
            canExecute: blockedBy.length === 0,
            blockedBy,
            completedDependencies: completedDeps,
          };
        }
      }

      return null; // All steps completed
    });
  }

  /**
   * Get workflow execution state
   */
  async getExecutionState(workflowId: string): Promise<{
    workflow: Workflow;
    steps: Array<Step & { task?: any; status: string }>;
    progress: number;
    nextStep: ExecutableStep | null;
  }> {
    return this.execute('getExecutionState', async () => {
      const workflow = await this.getById(workflowId);
      const stepIds = workflow.steps.map((s) => s.id);

      const { data: tasks } = await this.db
        .from('tasks')
        .select('*')
        .in('step_id', stepIds);

      const taskMap = new Map((tasks || []).map((t: any) => [t.step_id, t]));

      const stepsWithStatus = workflow.steps.map((step) => {
        const task = taskMap.get(step.id);
        return {
          ...step,
          task,
          status: task?.status || 'pending',
        };
      });

      const completedCount = stepsWithStatus.filter(
        (s) => s.status === 'completed' || s.status === 'review_needed'
      ).length;

      const progress = workflow.steps.length > 0
        ? Math.round((completedCount / workflow.steps.length) * 100)
        : 0;

      const nextStep = await this.getNextExecutableStep(workflowId);

      return {
        workflow,
        steps: stepsWithStatus,
        progress,
        nextStep,
      };
    });
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private getDefaultConfig(): WorkflowConfig {
    return {
      requiresApproval: true,
      maxRetries: 3,
      timeout: 30000,
    };
  }

  private validateStatusTransition(from: string, to: string): void {
    const currentState = from as WorkflowState;
    const newState = to as WorkflowState;

    const validTransition = WORKFLOW_TRANSITIONS.find(
      (t) => t.from.includes(currentState) && t.to === newState
    );

    if (!validTransition) {
      throw new WorkflowError(
        `Invalid status transition from ${from} to ${to}`,
        'unknown',
        { from, to }
      );
    }
  }

  private async verifyProjectAccess(projectId: string): Promise<void> {
    const { data, error } = await this.db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', this.userId)
      .single();

    if (error || !data) {
      throw new NotFoundError('Project', projectId);
    }
  }

  private mapToWorkflow(row: any): Workflow {
    return {
      id: row.id,
      projectId: row.project_id,
      pillarId: row.pillar_id,
      name: row.name,
      description: row.description || '',
      phase: row.phase || 'launch',
      status: row.status || 'draft',
      config: row.config || this.getDefaultConfig(),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at || row.created_at),
    };
  }

  private mapToStep(row: any): Step {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      type: row.type,
      config: row.config || {},
      dependencyIds: row.dependency_ids || [],
      position: row.position,
      createdAt: new Date(row.created_at),
    };
  }
}
