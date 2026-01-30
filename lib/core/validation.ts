/**
 * LaunchGrid Validation Schemas
 * 
 * All input validation using Zod for type safety and runtime validation.
 * Follows the principle: "Never trust user input"
 */

import { z } from 'zod';

// ==========================================
// COMMON VALIDATORS
// ==========================================

export const uuidSchema = z.string().uuid('Invalid UUID format');

export const slugSchema = z
  .string()
  .min(3, 'Slug must be at least 3 characters')
  .max(50, 'Slug must be at most 50 characters')
  .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens');

export const emailSchema = z.string().email('Invalid email address');

export const urlSchema = z.string().url('Invalid URL');

export const sanitizedStringSchema = z
  .string()
  .transform((val) => val.trim())
  .refine((val) => !/<script/i.test(val), 'Invalid characters detected');

// ==========================================
// ORGANIZATION SCHEMAS
// ==========================================

export const createOrganizationSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters'),
  slug: slugSchema.optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  settings: z.object({
    maxProjects: z.number().int().positive().optional(),
    maxUsersPerProject: z.number().int().positive().optional(),
    features: z.array(z.string()).optional(),
  }).optional(),
});

// ==========================================
// PROJECT SCHEMAS
// ==========================================

export const projectContextSchema = z.object({
  name: sanitizedStringSchema
    .pipe(z.string().min(2, 'Name must be at least 2 characters').max(200, 'Name must be at most 200 characters')),
  description: sanitizedStringSchema
    .pipe(z.string().min(10, 'Description must be at least 10 characters').max(2000, 'Description must be at most 2000 characters')),
  audience: sanitizedStringSchema
    .pipe(z.string().min(5, 'Audience must be at least 5 characters').max(500, 'Audience must be at most 500 characters')),
  painPoints: sanitizedStringSchema
    .pipe(z.string().min(5, 'Pain points must be at least 5 characters').max(1000, 'Pain points must be at most 1000 characters')),
  budget: z.number().int().min(0, 'Budget must be positive').max(1000000, 'Budget seems unrealistic'),
  aiProvider: z.enum(['gemini', 'openai', 'anthropic']).optional().default('gemini'),
});

export const createProjectSchema = projectContextSchema;

export const updateProjectSchema = projectContextSchema.partial();

// ==========================================
// PILLAR SCHEMAS
// ==========================================

export const pillarTypeSchema = z.enum([
  'social_organic',
  'community',
  'paid_ads',
  'email',
  'content_seo',
  'custom',
]);

export const createPillarSchema = z.object({
  projectId: uuidSchema,
  type: pillarTypeSchema,
  name: sanitizedStringSchema.pipe(z.string().min(2).max(100)),
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updatePillarSchema = z.object({
  name: sanitizedStringSchema.pipe(z.string().min(2).max(100)).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'paused', 'disabled']).optional(),
});

// ==========================================
// WORKFLOW SCHEMAS
// ==========================================

export const workflowPhaseSchema = z.enum(['foundation', 'launch', 'scale', 'optimize']);
export const workflowStatusSchema = z.enum(['draft', 'active', 'paused', 'completed']);

export const workflowConfigSchema = z.object({
  requiresApproval: z.boolean().default(true),
  maxRetries: z.number().int().min(0).max(10).default(3),
  timeout: z.number().int().min(1000).max(3600000).default(30000), // 1s to 1h
  schedule: z.string().optional(), // cron expression
  feedScanCount: z.number().int().min(5).max(100).default(20),
  autoTrackEngagement: z.boolean().default(true),
  aiStrictness: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const createWorkflowSchema = z.object({
  projectId: uuidSchema,
  pillarId: uuidSchema,
  name: sanitizedStringSchema.pipe(z.string().min(2).max(200)),
  description: sanitizedStringSchema.pipe(z.string().max(1000)).optional(),
  phase: workflowPhaseSchema.optional().default('launch'),
  config: workflowConfigSchema.optional(),
});

export const updateWorkflowSchema = z.object({
  name: sanitizedStringSchema.pipe(z.string().min(2).max(200)).optional(),
  description: sanitizedStringSchema.pipe(z.string().max(1000)).optional(),
  phase: workflowPhaseSchema.optional(),
  status: workflowStatusSchema.optional(),
  config: workflowConfigSchema.partial().optional(),
});

// ==========================================
// STEP SCHEMAS
// ==========================================

export const stepTypeSchema = z.enum([
  'GENERATE_DRAFT',
  'GENERATE_OUTLINE',
  'GENERATE_HOOKS',
  'GENERATE_IMAGE',
  'SCAN_FEED',
  'SELECT_TARGETS',
  'GENERATE_REPLIES',
  'REVIEW_CONTENT',
  'POST_API',
  'POST_REPLY',
  'POST_EXTENSION',

  'EMAIL_SEQ',
  'COMMUNITY_SYNC',
  'WAIT_APPROVAL',
  'CUSTOM',
]);

export const stepConfigSchema = z.object({
  promptTemplate: z.string().max(5000).optional(),
  platform: z.string().max(50).optional(),
  criteria: z.record(z.string(), z.unknown()).optional(),
  timeout: z.number().int().min(1000).max(300000).optional(),
  retries: z.number().int().min(0).max(5).optional(),
}).passthrough(); // Allow additional properties

export const createStepSchema = z.object({
  workflowId: uuidSchema,
  type: stepTypeSchema,
  config: stepConfigSchema.optional().default({}),
  dependencyIds: z.array(uuidSchema).optional().default([]),
  position: z.number().int().min(1).max(100),
});

export const updateStepSchema = z.object({
  type: stepTypeSchema.optional(),
  config: stepConfigSchema.optional(),
  dependencyIds: z.array(uuidSchema).optional(),
  position: z.number().int().min(1).max(100).optional(),
});

export const reorderStepsSchema = z.array(z.object({
  id: uuidSchema,
  position: z.number().int().min(1).max(100),
}));

// ==========================================
// TASK SCHEMAS
// ==========================================

export const taskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'extension_queued',
  'awaiting_approval',
  'review_needed',
  'completed',
  'failed',
  'cancelled',
]);

export const createTaskSchema = z.object({
  stepId: uuidSchema,
  projectId: uuidSchema,
  scheduledFor: z.string().datetime().optional(),
});

export const updateTaskSchema = z.object({
  status: taskStatusSchema.optional(),
  outputData: z.record(z.string(), z.unknown()).optional(),
  errorMessage: z.string().max(1000).optional(),
});

// ==========================================
// EXTENSION API SCHEMAS
// ==========================================

export const extensionResultSchema = z.object({
  taskId: uuidSchema,
  result: z.object({
    success: z.boolean(),
    data: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
    foundItems: z.array(z.object({
      id: z.string(),
      text: z.string(),
      author: z.string().optional(),
      url: z.string().optional(),
      engagement: z.number().optional(),
    })).optional(),
    found_items: z.array(z.object({
      id: z.string(),
      text: z.string(),
      author: z.string().optional(),
      url: z.string().optional(),
      engagement: z.record(z.string(), z.any()).optional(),
    })).optional(),
  }),
  metadata: z.object({
    executedAt: z.string().datetime(),
    duration: z.number().optional(),
    platform: z.string().optional(),
  }).optional(),
});

// ==========================================
// USER SECRETS SCHEMAS
// ==========================================

export const providerKeySchema = z.enum([
  'openai_key',
  'gemini_key',
  'anthropic_key',
  'twitter_token',
  'discord_token',
]);

export const saveSecretSchema = z.object({
  providerId: providerKeySchema,
  value: z.string().min(10, 'API key seems too short').max(500, 'API key too long'),
});

// ==========================================
// API REQUEST SCHEMAS
// ==========================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const sortSchema = z.object({
  field: z.string(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Import at top level to avoid require()
import { ValidationError } from './errors';

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    throw new ValidationError('Input validation failed', errors);
  }
  return result.data;
}

export function safeValidateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: Array<{ field: string; message: string }> } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return { success: false, errors };
  }
  return { success: true, data: result.data };
}

// Type exports
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type CreateStepInput = z.infer<typeof createStepSchema>;
export type UpdateStepInput = z.infer<typeof updateStepSchema>;
export type ExtensionResultInput = z.infer<typeof extensionResultSchema>;
export type SaveSecretInput = z.infer<typeof saveSecretSchema>;
