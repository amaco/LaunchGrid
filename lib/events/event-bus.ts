/**
 * LaunchGrid Event Bus
 * 
 * Event-driven architecture implementation following the constitution:
 * - Every important action emits an event
 * - Other services react to events
 * - Events are the system truth
 */

import { nanoid } from 'nanoid';
import type { DomainEvent, EventType, AggregateType, EventMetadata } from '../core/types';

// ==========================================
// EVENT HANDLER TYPES
// ==========================================

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void>;

export interface EventSubscription {
  id: string;
  eventType: EventType | '*';
  handler: EventHandler;
  priority: number;
}

// ==========================================
// EVENT BUS IMPLEMENTATION
// ==========================================

class EventBusImpl {
  private subscriptions: Map<string, EventSubscription[]> = new Map();
  private eventStore: DomainEvent[] = [];
  private isProcessing: boolean = false;
  private eventQueue: DomainEvent[] = [];

  /**
   * Subscribe to an event type
   */
  subscribe(eventType: EventType | '*', handler: EventHandler, priority: number = 0): string {
    const subscriptionId = nanoid();
    const subscription: EventSubscription = {
      id: subscriptionId,
      eventType,
      handler,
      priority,
    };

    const key = eventType === '*' ? '*' : eventType;
    const existing = this.subscriptions.get(key) || [];
    existing.push(subscription);
    // Sort by priority (higher first)
    existing.sort((a, b) => b.priority - a.priority);
    this.subscriptions.set(key, existing);

    return subscriptionId;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): void {
    for (const [key, subs] of this.subscriptions.entries()) {
      const filtered = subs.filter((s) => s.id !== subscriptionId);
      if (filtered.length !== subs.length) {
        this.subscriptions.set(key, filtered);
        break;
      }
    }
  }

  /**
   * Emit an event
   */
  async emit<T>(event: DomainEvent<T>): Promise<void> {
    // Store event first (event sourcing)
    this.eventStore.push(event as DomainEvent);
    
    // Add to queue for processing
    this.eventQueue.push(event as DomainEvent);
    
    // Process queue if not already processing
    if (!this.isProcessing) {
      await this.processQueue();
    }
  }

  /**
   * Process the event queue
   */
  private async processQueue(): Promise<void> {
    this.isProcessing = true;

    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift();
      if (!event) continue;

      try {
        // Get handlers for this specific event type
        const typeHandlers = this.subscriptions.get(event.type) || [];
        // Get wildcard handlers
        const wildcardHandlers = this.subscriptions.get('*') || [];
        
        // Combine and sort by priority
        const allHandlers = [...typeHandlers, ...wildcardHandlers]
          .sort((a, b) => b.priority - a.priority);

        // Execute handlers
        for (const subscription of allHandlers) {
          try {
            await subscription.handler(event);
          } catch (error) {
            console.error(`Event handler error for ${event.type}:`, error);
            // Don't throw - continue processing other handlers
          }
        }
      } catch (error) {
        console.error(`Event processing error for ${event.type}:`, error);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Get events from the store (for replay/debugging)
   */
  getEvents(filter?: {
    aggregateId?: string;
    aggregateType?: AggregateType;
    eventType?: EventType;
    since?: Date;
    limit?: number;
  }): DomainEvent[] {
    let events = [...this.eventStore];

    if (filter?.aggregateId) {
      events = events.filter((e) => e.aggregateId === filter.aggregateId);
    }
    if (filter?.aggregateType) {
      events = events.filter((e) => e.aggregateType === filter.aggregateType);
    }
    if (filter?.eventType) {
      events = events.filter((e) => e.type === filter.eventType);
    }
    if (filter?.since) {
      const since = filter.since;
      events = events.filter((e) => e.occurredAt >= since);
    }
    if (filter?.limit) {
      const limit = filter.limit;
      events = events.slice(-limit);
    }

    return events;
  }

  /**
   * Clear event store (for testing)
   */
  clearEvents(): void {
    this.eventStore = [];
  }

  /**
   * Get subscription count (for monitoring)
   */
  getSubscriptionCount(): number {
    let count = 0;
    for (const subs of this.subscriptions.values()) {
      count += subs.length;
    }
    return count;
  }
}

// ==========================================
// SINGLETON INSTANCE
// ==========================================

export const eventBus = new EventBusImpl();

// ==========================================
// EVENT FACTORY
// ==========================================

let eventVersion = 0;

export function createEvent<T>(
  type: EventType,
  aggregateId: string,
  aggregateType: AggregateType,
  payload: T,
  context: {
    organizationId: string;
    userId: string;
    correlationId?: string;
    causationId?: string;
    source?: EventMetadata['source'];
    userAgent?: string;
    ipAddress?: string;
  }
): DomainEvent<T> {
  eventVersion++;
  
  return {
    id: nanoid(),
    type,
    aggregateId,
    aggregateType,
    organizationId: context.organizationId,
    userId: context.userId,
    payload,
    metadata: {
      correlationId: context.correlationId || nanoid(),
      causationId: context.causationId,
      source: context.source || 'api',
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    },
    occurredAt: new Date(),
    version: eventVersion,
  };
}

// ==========================================
// EVENT HELPERS
// ==========================================

export async function emitProjectEvent(
  type: Extract<EventType, 'PROJECT_CREATED' | 'PROJECT_UPDATED' | 'PROJECT_DELETED' | 'BLUEPRINT_GENERATED' | 'BLUEPRINT_REGENERATED'>,
  projectId: string,
  payload: Record<string, unknown>,
  context: Parameters<typeof createEvent>[4]
): Promise<void> {
  const event = createEvent(type, projectId, 'project', payload, context);
  await eventBus.emit(event);
}

export async function emitWorkflowEvent(
  type: Extract<EventType, 'WORKFLOW_CREATED' | 'WORKFLOW_STARTED' | 'WORKFLOW_COMPLETED' | 'WORKFLOW_FAILED' | 'WORKFLOW_PAUSED'>,
  workflowId: string,
  payload: Record<string, unknown>,
  context: Parameters<typeof createEvent>[4]
): Promise<void> {
  const event = createEvent(type, workflowId, 'workflow', payload, context);
  await eventBus.emit(event);
}

export async function emitTaskEvent(
  type: Extract<EventType, 'TASK_CREATED' | 'TASK_QUEUED' | 'TASK_STARTED' | 'TASK_COMPLETED' | 'TASK_FAILED' | 'TASK_RETRIED' | 'EXTENSION_TASK_QUEUED' | 'EXTENSION_TASK_COMPLETED'>,
  taskId: string,
  payload: Record<string, unknown>,
  context: Parameters<typeof createEvent>[4]
): Promise<void> {
  const event = createEvent(type, taskId, 'task', payload, context);
  await eventBus.emit(event);
}

export async function emitContentEvent(
  type: Extract<EventType, 'CONTENT_DRAFTED' | 'CONTENT_APPROVED' | 'CONTENT_REJECTED' | 'CONTENT_PUBLISHED'>,
  contentId: string,
  payload: Record<string, unknown>,
  context: Parameters<typeof createEvent>[4]
): Promise<void> {
  const event = createEvent(type, contentId, 'task', payload, context);
  await eventBus.emit(event);
}

export async function emitAIEvent(
  type: Extract<EventType, 'AI_GENERATION_STARTED' | 'AI_GENERATION_COMPLETED' | 'AI_GENERATION_FAILED'>,
  aggregateId: string,
  payload: Record<string, unknown>,
  context: Parameters<typeof createEvent>[4]
): Promise<void> {
  const event = createEvent(type, aggregateId, 'task', payload, context);
  await eventBus.emit(event);
}

export async function emitSecurityEvent(
  action: string,
  userId: string,
  payload: Record<string, unknown>,
  context: Omit<Parameters<typeof createEvent>[4], 'userId'>
): Promise<void> {
  const event = createEvent(
    'SECURITY_EVENT',
    userId,
    'user',
    { action, ...payload },
    { ...context, userId }
  );
  await eventBus.emit(event);
}
