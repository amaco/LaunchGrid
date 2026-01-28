/**
 * LaunchGrid Task Service
 * 
 * Owns: Task lifecycle, execution state
 * Following the constitution:
 * - Task Orchestrator Service manages task lifecycle
 * - Human-in-the-loop for social posting
 */

import { BaseService, ServiceContext } from './base-service';
import { validateInput, updateTaskSchema } from '../core/validation';
import { NotFoundError, DatabaseError, BusinessRuleError } from '../core/errors';
import type { Task, TaskStatus, AggregateType } from '../core/types';

// ==========================================
// TASK STATE MACHINE
// ==========================================

export interface TaskTransition {
  from: TaskStatus[];
  to: TaskStatus;
  action: string;
}

const TASK_TRANSITIONS: TaskTransition[] = [
  { from: ['pending', 'failed', 'review_needed', 'awaiting_approval', 'extension_queued', 'cancelled'], to: 'in_progress', action: 'start' },
  { from: ['pending', 'in_progress', 'review_needed'], to: 'extension_queued', action: 'queueForExtension' },
  { from: ['in_progress', 'extension_queued'], to: 'awaiting_approval', action: 'requestApproval' },
  { from: ['in_progress', 'extension_queued', 'failed', 'cancelled'], to: 'review_needed', action: 'markForReview' },
  { from: ['in_progress', 'awaiting_approval', 'review_needed'], to: 'completed', action: 'complete' },
  { from: ['in_progress', 'extension_queued', 'awaiting_approval', 'pending'], to: 'failed', action: 'fail' },
  { from: ['failed', 'cancelled'], to: 'pending', action: 'retry' },
  { from: ['pending', 'in_progress', 'awaiting_approval', 'review_needed', 'extension_queued', 'failed', 'completed'], to: 'cancelled', action: 'cancel' },
  { from: ['completed', 'failed', 'review_needed', 'awaiting_approval', 'cancelled', 'in_progress', 'extension_queued', 'pending'], to: 'pending', action: 'reset' },
];

// ==========================================
// TASK SERVICE
// ==========================================

export class TaskService extends BaseService {
  protected serviceName = 'TaskService';
  protected aggregateType: AggregateType = 'task';

  constructor(context: ServiceContext) {
    super(context);
  }

  /**
   * Create a new task
   */
  async create(input: {
    stepId: string;
    projectId: string;
    scheduledFor?: Date;
  }): Promise<Task> {
    return this.execute('create', async () => {
      // Verify project access
      await this.verifyProjectAccess(input.projectId);

      const { data, error } = await this.db
        .from('tasks')
        .insert({
          step_id: input.stepId,
          project_id: input.projectId,
          status: 'pending',
          output_data: {},
          scheduled_for: input.scheduledFor?.toISOString(),
          retry_count: 0,
        })
        .select()
        .single();

      if (error) {
        throw new DatabaseError(`Failed to create task: ${error.message}`, 'INSERT');
      }

      await this.emitEvent('TASK_CREATED', data.id, {
        stepId: input.stepId,
        projectId: input.projectId,
      });

      return this.mapToTask(data);
    });
  }

  /**
   * Get a task by ID
   */
  async getById(taskId: string): Promise<Task> {
    return this.execute('getById', async () => {
      const { data, error } = await this.db
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();

      if (error || !data) {
        throw new NotFoundError('Task', taskId);
      }

      // Verify access via project
      await this.verifyProjectAccess(data.project_id);

      return this.mapToTask(data);
    });
  }

  /**
   * Get task by step ID
   */
  async getByStepId(stepId: string): Promise<Task | null> {
    return this.execute('getByStepId', async () => {
      const { data, error } = await this.db
        .from('tasks')
        .select('*')
        .eq('step_id', stepId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // Not "no rows found"
        throw new DatabaseError(`Failed to get task: ${error.message}`, 'SELECT');
      }

      if (!data) return null;

      return this.mapToTask(data);
    });
  }

  /**
   * List tasks for a project
   */
  async listByProject(projectId: string, options?: {
    status?: TaskStatus;
    limit?: number;
  }): Promise<Task[]> {
    return this.execute('listByProject', async () => {
      await this.verifyProjectAccess(projectId);

      let query = this.db
        .from('tasks')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (options?.status) {
        query = query.eq('status', options.status);
      }
      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) {
        throw new DatabaseError(`Failed to list tasks: ${error.message}`, 'SELECT');
      }

      return (data || []).map(this.mapToTask);
    });
  }

  /**
   * Update task status
   */
  async updateStatus(
    taskId: string,
    status: TaskStatus,
    outputData?: Record<string, unknown>,
    errorMessage?: string
  ): Promise<Task> {
    return this.execute('updateStatus', async () => {
      const existing = await this.getById(taskId);

      // Validate transition
      this.validateStatusTransition(existing.status, status);

      const updateData: Record<string, unknown> = {
        status,
      };

      if (outputData) {
        updateData.output_data = outputData;
      }

      if (errorMessage) {
        updateData.error_message = errorMessage;
      }

      // Set timestamps based on status
      if (status === 'in_progress' && !existing.startedAt) {
        updateData.started_at = new Date().toISOString();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString();
      }

      if (status === 'failed') {
        updateData.retry_count = (existing.retryCount || 0) + 1;
      }

      const { data, error } = await this.db
        .from('tasks')
        .update(updateData)
        .eq('id', taskId)
        .select()
        .single();

      if (error) {
        throw new DatabaseError(`Failed to update task: ${error.message}`, 'UPDATE');
      }

      // Emit appropriate event
      const eventType = status === 'completed' ? 'TASK_COMPLETED' :
        status === 'failed' ? 'TASK_FAILED' :
          status === 'in_progress' ? 'TASK_STARTED' :
            status === 'extension_queued' ? 'EXTENSION_TASK_QUEUED' :
              'TASK_QUEUED';

      await this.emitEvent(eventType, taskId, {
        previousStatus: existing.status,
        newStatus: status,
        stepId: existing.stepId,
      });

      await this.auditChange('updateStatus', taskId, {
        status: { old: existing.status, new: status },
      });

      return this.mapToTask(data);
    });
  }

  /**
   * Start task execution
   */
  async start(taskId: string): Promise<Task> {
    return this.updateStatus(taskId, 'in_progress');
  }

  /**
   * Complete task with output
   */
  async complete(taskId: string, outputData: Record<string, unknown>): Promise<Task> {
    return this.updateStatus(taskId, 'completed', outputData);
  }

  /**
   * Fail task with error
   */
  async fail(taskId: string, errorMessage: string): Promise<Task> {
    return this.updateStatus(taskId, 'failed', undefined, errorMessage);
  }

  /**
   * Mark task for review (human-in-the-loop)
   */
  async markForReview(taskId: string, outputData: Record<string, unknown>): Promise<Task> {
    return this.updateStatus(taskId, 'review_needed', outputData);
  }

  /**
   * Queue task for browser extension
   */
  async queueForExtension(taskId: string, outputData?: Record<string, unknown>): Promise<Task> {
    return this.updateStatus(taskId, 'extension_queued', {
      info: 'Waiting for Browser Extension...',
      ...outputData
    });
  }

  /**
   * Approve task content (human-in-the-loop)
   */
  async approve(taskId: string): Promise<Task> {
    const task = await this.getById(taskId);

    if (task.status !== 'review_needed' && task.status !== 'awaiting_approval') {
      throw new BusinessRuleError(
        'Task is not awaiting approval',
        'INVALID_APPROVAL_STATE'
      );
    }

    return this.updateStatus(taskId, 'completed', task.outputData);
  }

  /**
   * Reject task content (human-in-the-loop)
   */
  async reject(taskId: string, reason: string): Promise<Task> {
    const task = await this.getById(taskId);

    if (task.status !== 'review_needed' && task.status !== 'awaiting_approval') {
      throw new BusinessRuleError(
        'Task is not awaiting approval',
        'INVALID_REJECTION_STATE'
      );
    }

    return this.updateStatus(taskId, 'cancelled', undefined, reason);
  }

  /**
   * Cancel task
   */
  async cancelTask(taskId: string, reason: string = 'User cancelled'): Promise<Task> {
    const task = await this.getById(taskId);
    return this.updateStatus(taskId, 'cancelled', undefined, reason);
  }

  /**
   * Reset a task to pending so it can be rerun
   */
  async reset(taskId: string): Promise<Task> {
    return this.updateStatus(taskId, 'pending', {});
  }

  /**
   * Get extension-queued tasks (for extension API)
   */
  async getExtensionQueuedTasks(): Promise<Task[]> {
    return this.execute('getExtensionQueuedTasks', async () => {
      const { data, error } = await this.db
        .from('tasks')
        .select('*, step:steps(*)')
        .eq('status', 'extension_queued')
        .order('created_at', { ascending: true });

      if (error) {
        throw new DatabaseError(`Failed to get extension tasks: ${error.message}`, 'SELECT');
      }

      return (data || []).map(this.mapToTask);
    });
  }

  /**
   * Complete task from extension result
   */
  async completeFromExtension(
    taskId: string,
    result: Record<string, unknown>
  ): Promise<Task> {
    const task = await this.getById(taskId);

    if (task.status !== 'extension_queued') {
      throw new BusinessRuleError(
        'Task is not queued for extension',
        'INVALID_EXTENSION_STATE'
      );
    }

    // Mark for review (human-in-the-loop principle)
    return this.markForReview(taskId, result);
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private validateStatusTransition(from: TaskStatus, to: TaskStatus): void {
    const validTransition = TASK_TRANSITIONS.find(
      (t) => t.from.includes(from) && t.to === to
    );

    if (!validTransition) {
      throw new BusinessRuleError(
        `Invalid task status transition from ${from} to ${to}`,
        'INVALID_STATUS_TRANSITION'
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

  private mapToTask(row: any): Task {
    return {
      id: row.id,
      stepId: row.step_id,
      projectId: row.project_id,
      status: row.status,
      outputData: row.output_data || {},
      errorMessage: row.error_message,
      scheduledFor: row.scheduled_for ? new Date(row.scheduled_for) : undefined,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      createdAt: new Date(row.created_at),
      retryCount: row.retry_count || 0,
    };
  }
}
