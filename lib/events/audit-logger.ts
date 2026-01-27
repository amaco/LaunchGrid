/**
 * LaunchGrid Audit Logger
 * 
 * Comprehensive audit logging following the constitution:
 * - Observability and audit trail are first-class
 * - Full audit of AI and user decisions
 */

import { nanoid } from 'nanoid';
import { eventBus, createEvent } from './event-bus';
import type { AuditLog, AuditMetadata, DomainEvent } from '../core/types';

// ==========================================
// AUDIT STORE (In-memory for now, should be DB)
// ==========================================

const auditStore: AuditLog[] = [];

// ==========================================
// AUDIT LOGGER
// ==========================================

export interface AuditContext {
  organizationId: string;
  userId: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  metadata?: Record<string, unknown>;
}

class AuditLoggerImpl {
  private pendingLogs: AuditLog[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Subscribe to all events for automatic audit logging
    eventBus.subscribe('*', this.handleEvent.bind(this), -100); // Low priority
  }

  /**
   * Log an audit entry
   */
  async log(context: AuditContext, entry: AuditEntry): Promise<void> {
    const auditLog: AuditLog = {
      id: nanoid(),
      organizationId: context.organizationId,
      userId: context.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      changes: entry.changes,
      metadata: {
        requestId: context.requestId || nanoid(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        ...entry.metadata,
      },
      createdAt: new Date(),
    };

    // Add to pending logs
    this.pendingLogs.push(auditLog);
    
    // Also add to in-memory store immediately
    auditStore.push(auditLog);

    // Schedule flush if not already scheduled
    this.scheduleFlush();
  }

  /**
   * Handle domain events for automatic audit logging
   */
  private async handleEvent(event: DomainEvent): Promise<void> {
    // Skip security events (they're already audit logs)
    if (event.type === 'SECURITY_EVENT' || event.type === 'USER_ACTION') {
      return;
    }

    const auditLog: AuditLog = {
      id: nanoid(),
      organizationId: event.organizationId,
      userId: event.userId,
      action: event.type,
      resourceType: event.aggregateType,
      resourceId: event.aggregateId,
      metadata: {
        requestId: event.metadata.correlationId,
        eventId: event.id,
        eventVersion: event.version,
        source: event.metadata.source,
      },
      createdAt: event.occurredAt,
    };

    auditStore.push(auditLog);
  }

  /**
   * Schedule a flush of pending logs to database
   */
  private scheduleFlush(): void {
    if (this.flushInterval) return;

    this.flushInterval = setTimeout(async () => {
      await this.flush();
      this.flushInterval = null;
    }, 1000); // Flush every second
  }

  /**
   * Flush pending logs to database
   */
  async flush(): Promise<void> {
    if (this.pendingLogs.length === 0) return;

    const logsToFlush = [...this.pendingLogs];
    this.pendingLogs = [];

    try {
      // TODO: Implement actual database persistence
      // For now, logs are in the in-memory auditStore
      console.log(`[Audit] Flushed ${logsToFlush.length} audit logs`);
    } catch (error) {
      console.error('[Audit] Failed to flush logs:', error);
      // Re-add failed logs to pending
      this.pendingLogs.unshift(...logsToFlush);
    }
  }

  /**
   * Query audit logs
   */
  async query(filter: {
    organizationId?: string;
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    action?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    let logs = [...auditStore];

    if (filter.organizationId) {
      logs = logs.filter((l) => l.organizationId === filter.organizationId);
    }
    if (filter.userId) {
      logs = logs.filter((l) => l.userId === filter.userId);
    }
    if (filter.resourceType) {
      logs = logs.filter((l) => l.resourceType === filter.resourceType);
    }
    if (filter.resourceId) {
      logs = logs.filter((l) => l.resourceId === filter.resourceId);
    }
    if (filter.action) {
      logs = logs.filter((l) => l.action === filter.action);
    }
    if (filter.since) {
      logs = logs.filter((l) => l.createdAt >= filter.since!);
    }
    if (filter.until) {
      logs = logs.filter((l) => l.createdAt <= filter.until!);
    }

    // Sort by newest first
    logs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = logs.length;
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;

    return {
      logs: logs.slice(offset, offset + limit),
      total,
    };
  }

  /**
   * Get audit trail for a specific resource
   */
  async getResourceAuditTrail(
    resourceType: string,
    resourceId: string
  ): Promise<AuditLog[]> {
    const result = await this.query({
      resourceType,
      resourceId,
      limit: 1000,
    });
    return result.logs;
  }

  /**
   * Get user activity
   */
  async getUserActivity(
    userId: string,
    since?: Date
  ): Promise<AuditLog[]> {
    const result = await this.query({
      userId,
      since,
      limit: 1000,
    });
    return result.logs;
  }
}

// ==========================================
// SINGLETON INSTANCE
// ==========================================

export const auditLogger = new AuditLoggerImpl();

// ==========================================
// AUDIT HELPERS
// ==========================================

export async function logUserAction(
  context: AuditContext,
  action: string,
  resourceType: string,
  resourceId: string,
  details?: Record<string, unknown>
): Promise<void> {
  await auditLogger.log(context, {
    action,
    resourceType,
    resourceId,
    metadata: details,
  });
}

export async function logDataChange(
  context: AuditContext,
  action: string,
  resourceType: string,
  resourceId: string,
  changes: Record<string, { old: unknown; new: unknown }>
): Promise<void> {
  await auditLogger.log(context, {
    action,
    resourceType,
    resourceId,
    changes,
  });
}

export async function logSecurityEvent(
  context: AuditContext,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  await auditLogger.log(context, {
    action: `SECURITY:${action}`,
    resourceType: 'security',
    resourceId: context.userId,
    metadata: {
      ...details,
      severity: details.severity || 'info',
    },
  });
}

export async function logAIDecision(
  context: AuditContext,
  provider: string,
  action: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  duration: number
): Promise<void> {
  await auditLogger.log(context, {
    action: `AI:${action}`,
    resourceType: 'ai',
    resourceId: provider,
    metadata: {
      provider,
      inputSummary: summarizeForAudit(input),
      outputSummary: summarizeForAudit(output),
      duration,
    },
  });
}

// ==========================================
// UTILITIES
// ==========================================

function summarizeForAudit(data: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.length > 200) {
      summary[key] = `${value.substring(0, 200)}... (${value.length} chars)`;
    } else if (Array.isArray(value)) {
      summary[key] = `Array(${value.length})`;
    } else if (typeof value === 'object' && value !== null) {
      summary[key] = `Object(${Object.keys(value).length} keys)`;
    } else {
      summary[key] = value;
    }
  }
  
  return summary;
}
