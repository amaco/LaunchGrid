/**
 * LaunchGrid Core Types
 * 
 * These types follow the Architecture Constitution principles:
 * - Multi-tenant by design (Org → Projects → Users)
 * - Strict type safety
 * - Event-driven architecture support
 */

// ==========================================
// TENANT & AUTH TYPES
// ==========================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  settings: OrganizationSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationSettings {
  maxProjects: number;
  maxUsersPerProject: number;
  features: string[];
  billingPlan: 'free' | 'starter' | 'pro' | 'enterprise';
}

export interface User {
  id: string;
  email: string;
  organizationId: string;
  role: UserRole;
  createdAt: Date;
}

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TenantContext {
  organizationId: string;
  userId: string;
  role: UserRole;
}

// ==========================================
// PROJECT & BLUEPRINT TYPES
// ==========================================

export interface Project {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
  context: ProjectContext;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectContext {
  name: string;
  description: string;
  audience: string;
  painPoints: string;
  budget: number;
  aiProvider?: AIProviderID;
}

export type ProjectStatus = 'draft' | 'active' | 'paused' | 'archived';

// ==========================================
// PILLAR & WORKFLOW TYPES
// ==========================================

export interface Pillar {
  id: string;
  projectId: string;
  type: PillarType;
  name: string;
  config: Record<string, unknown>;
  status: 'active' | 'paused' | 'disabled';
  createdAt: Date;
}

export type PillarType =
  | 'social_organic'
  | 'community'
  | 'paid_ads'
  | 'email'
  | 'content_seo'
  | 'custom';

export interface Workflow {
  id: string;
  projectId: string;
  pillarId: string;
  name: string;
  description: string;
  phase: WorkflowPhase;
  status: WorkflowStatus;
  config: WorkflowConfig;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkflowPhase = 'foundation' | 'launch' | 'scale' | 'optimize';
export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'completed';

export interface WorkflowConfig {
  requiresApproval: boolean;
  maxRetries: number;
  timeout: number;
  schedule?: string; // cron expression
  templateId?: string; // ID of template this workflow was created from
  templateName?: string; // Name of the template for display
}

// ==========================================
// STEP TYPES (The LEGO Blocks)
// ==========================================

export interface Step {
  id: string;
  workflowId: string;
  type: StepType;
  config: StepConfig;
  dependencyIds: string[];
  position: number;
  createdAt: Date;
}

export type StepType =
  | 'GENERATE_DRAFT'
  | 'GENERATE_OUTLINE'
  | 'GENERATE_HOOKS'
  | 'GENERATE_IMAGE'
  | 'SCAN_FEED'
  | 'SELECT_TARGETS'
  | 'GENERATE_REPLIES'
  | 'REVIEW_CONTENT'
  | 'POST_API'
  | 'POST_REPLY'
  | 'POST_EXTENSION'
  | 'TRACK_ENGAGEMENT'
  | 'EMAIL_SEQ'
  | 'COMMUNITY_SYNC'
  | 'WAIT_APPROVAL'
  | 'CUSTOM';

export interface StepConfig {
  promptTemplate?: string;
  platform?: string;
  criteria?: Record<string, unknown>;
  timeout?: number;
  retries?: number;
  [key: string]: unknown;
}

// ==========================================
// TASK TYPES (Execution State)
// ==========================================

export interface Task {
  id: string;
  stepId: string;
  projectId: string;
  status: TaskStatus;
  outputData: Record<string, unknown>;
  errorMessage?: string;
  scheduledFor?: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  retryCount: number;
}

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'extension_queued'
  | 'awaiting_approval'
  | 'review_needed'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ==========================================
// AI TYPES
// ==========================================

export type AIProviderID = 'gemini' | 'openai' | 'anthropic';

export interface Blueprint {
  activePillars: Array<{
    id: string;
    type: PillarType;
    name: string;
  }>;
  workflows: Array<{
    workflowId: string;
    pillarRef: string;
    name: string;
    goal: string;
    frequency: string;
    description: string;
  }>;
}

export interface ContentDraft {
  title?: string;
  content: string;
  hashtags: string[];
  suggestedImagePrompt?: string;
  metadata?: Record<string, unknown>;
}

// ==========================================
// API TYPES
// ==========================================

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: APIError;
  meta?: APIMeta;
}

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface APIMeta {
  requestId: string;
  timestamp: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// ==========================================
// EVENT TYPES
// ==========================================

export interface DomainEvent<T = unknown> {
  id: string;
  type: EventType;
  aggregateId: string;
  aggregateType: AggregateType;
  organizationId: string;
  userId: string;
  payload: T;
  metadata: EventMetadata;
  occurredAt: Date;
  version: number;
}

export type EventType =
  // Project Events
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_DELETED'
  | 'BLUEPRINT_GENERATED'
  | 'BLUEPRINT_REGENERATED'
  // Workflow Events
  | 'WORKFLOW_CREATED'
  | 'WORKFLOW_STARTED'
  | 'WORKFLOW_COMPLETED'
  | 'WORKFLOW_FAILED'
  | 'WORKFLOW_PAUSED'
  // Step Events
  | 'STEP_CREATED'
  | 'STEP_SCHEDULED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  // Task Events
  | 'TASK_CREATED'
  | 'TASK_QUEUED'
  | 'TASK_STARTED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_RETRIED'
  // Content Events
  | 'CONTENT_DRAFTED'
  | 'CONTENT_APPROVED'
  | 'CONTENT_REJECTED'
  | 'CONTENT_PUBLISHED'
  // Integration Events
  | 'EXTENSION_TASK_QUEUED'
  | 'EXTENSION_TASK_COMPLETED'
  | 'INTEGRATION_CONNECTED'
  | 'INTEGRATION_DISCONNECTED'
  // AI Events
  | 'AI_GENERATION_STARTED'
  | 'AI_GENERATION_COMPLETED'
  | 'AI_GENERATION_FAILED'
  // Audit Events
  | 'USER_ACTION'
  | 'SECURITY_EVENT';

export type AggregateType =
  | 'organization'
  | 'project'
  | 'pillar'
  | 'workflow'
  | 'step'
  | 'task'
  | 'user';

export interface EventMetadata {
  correlationId: string;
  causationId?: string;
  userAgent?: string;
  ipAddress?: string;
  source: 'api' | 'ui' | 'worker' | 'extension' | 'system';
}

// ==========================================
// AUDIT TYPES
// ==========================================

export interface AuditLog {
  id: string;
  organizationId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  metadata: AuditMetadata;
  createdAt: Date;
}

export interface AuditMetadata {
  ipAddress?: string;
  userAgent?: string;
  requestId: string;
  duration?: number;
  eventId?: string;
  eventVersion?: number;
  source?: string;
  [key: string]: unknown;
}
