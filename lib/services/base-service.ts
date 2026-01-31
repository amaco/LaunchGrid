/**
 * LaunchGrid Base Service
 * 
 * Base class for all services following the constitution:
 * - Strict service ownership
 * - Tenant isolation everywhere
 * - Events emitted for all important actions
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { eventBus, createEvent } from '../events/event-bus';
import { auditLogger } from '../events/audit-logger';
import type { TenantContext, EventType, AggregateType } from '../core/types';
import { TenantAccessError, AuthenticationError, NotFoundError } from '../core/errors';

export interface ServiceContext {
  supabase: SupabaseClient;
  tenant: TenantContext;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

export abstract class BaseService {
  protected context: ServiceContext;
  protected abstract serviceName: string;
  protected abstract aggregateType: AggregateType;

  constructor(context: ServiceContext) {
    this.context = context;
    this.validateTenantContext();
  }

  /**
   * Validate tenant context exists
   */
  /**
   * Validate tenant context exists
   */
  protected validateTenantContext(): void {
    if (!this.context.tenant) {
      throw new AuthenticationError('Tenant context required');
    }
    if (!this.context.tenant.organizationId) {
      throw new TenantAccessError('Organization ID required');
    }
    if (!this.context.tenant.userId) {
      throw new AuthenticationError('User ID required');
    }
  }

  /**
   * Verify project access (ensure project belongs to tenant)
   */
  protected async verifyProjectAccess(projectId: string): Promise<void> {
    // Service Account Bypass: The extension worker runs as a system user
    // It is authorized to access any project it was given a job for (jobs are created by owners).
    if (this.userId === 'extension-service-account' || this.organizationId === 'system') {
      return;
    }

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

  /**
   * Get the Supabase client with tenant isolation
   */
  protected get db(): SupabaseClient {
    return this.context.supabase;
  }

  /**
   * Get tenant context
   */
  protected get tenant(): TenantContext {
    return this.context.tenant;
  }

  /**
   * Get organization ID for queries
   */
  protected get organizationId(): string {
    return this.context.tenant.organizationId;
  }

  /**
   * Get user ID for queries
   */
  protected get userId(): string {
    return this.context.tenant.userId;
  }

  /**
   * Emit a domain event
   */
  protected async emitEvent<T>(
    type: EventType,
    aggregateId: string,
    payload: T
  ): Promise<void> {
    const event = createEvent(
      type,
      aggregateId,
      this.aggregateType,
      payload,
      {
        organizationId: this.organizationId,
        userId: this.userId,
        correlationId: this.context.requestId,
        source: 'api',
        userAgent: this.context.userAgent,
        ipAddress: this.context.ipAddress,
      }
    );
    await eventBus.emit(event);
  }

  /**
   * Log an audit entry
   */
  protected async audit(
    action: string,
    resourceId: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await auditLogger.log(
      {
        organizationId: this.organizationId,
        userId: this.userId,
        requestId: this.context.requestId,
        ipAddress: this.context.ipAddress,
        userAgent: this.context.userAgent,
      },
      {
        action: `${this.serviceName}:${action}`,
        resourceType: this.aggregateType,
        resourceId,
        metadata: details,
      }
    );
  }

  /**
   * Log data changes for audit
   */
  protected async auditChange(
    action: string,
    resourceId: string,
    changes: Record<string, { old: unknown; new: unknown }>
  ): Promise<void> {
    await auditLogger.log(
      {
        organizationId: this.organizationId,
        userId: this.userId,
        requestId: this.context.requestId,
        ipAddress: this.context.ipAddress,
        userAgent: this.context.userAgent,
      },
      {
        action: `${this.serviceName}:${action}`,
        resourceType: this.aggregateType,
        resourceId,
        changes,
      }
    );
  }

  /**
   * Execute with error handling and logging
   */
  protected async execute<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      // Log successful operation
      console.log(`[${this.serviceName}] ${operation} completed in ${duration}ms`);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Log failed operation
      console.error(`[${this.serviceName}] ${operation} failed after ${duration}ms:`, error);

      throw error;
    }
  }
}

/**
 * Create service context from request
 */
export function createServiceContext(
  supabase: SupabaseClient,
  user: { id: string },
  organizationId: string,
  options?: {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    role?: TenantContext['role'];
  }
): ServiceContext {
  return {
    supabase,
    tenant: {
      organizationId,
      userId: user.id,
      role: options?.role || 'member',
    },
    requestId: options?.requestId || nanoid(),
    ipAddress: options?.ipAddress,
    userAgent: options?.userAgent,
  };
}
