/**
 * LaunchGrid Error System
 * 
 * Consistent error handling across the application.
 * All errors are categorized and include proper context.
 */

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    this.timestamp = new Date();

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

// ==========================================
// AUTHENTICATION & AUTHORIZATION ERRORS
// ==========================================

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', details?: Record<string, unknown>) {
    super(message, 'AUTH_REQUIRED', 401, true, details);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied', details?: Record<string, unknown>) {
    super(message, 'ACCESS_DENIED', 403, true, details);
  }
}

export class TenantAccessError extends AppError {
  constructor(message: string = 'Tenant access violation', details?: Record<string, unknown>) {
    super(message, 'TENANT_ACCESS_DENIED', 403, true, details);
  }
}

export class InvalidTokenError extends AppError {
  constructor(message: string = 'Invalid or expired token', details?: Record<string, unknown>) {
    super(message, 'INVALID_TOKEN', 401, true, details);
  }
}

// ==========================================
// VALIDATION ERRORS
// ==========================================

export class ValidationError extends AppError {
  public readonly validationErrors: Array<{ field: string; message: string }>;

  constructor(
    message: string = 'Validation failed',
    validationErrors: Array<{ field: string; message: string }> = []
  ) {
    super(message, 'VALIDATION_FAILED', 400, true, { errors: validationErrors });
    this.validationErrors = validationErrors;
  }
}

export class InvalidInputError extends AppError {
  constructor(message: string, field?: string) {
    super(message, 'INVALID_INPUT', 400, true, field ? { field } : undefined);
  }
}

// ==========================================
// RESOURCE ERRORS
// ==========================================

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, true, { resource, id });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, true, details);
  }
}

export class ResourceExhaustedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RESOURCE_EXHAUSTED', 429, true, details);
  }
}

// ==========================================
// BUSINESS LOGIC ERRORS
// ==========================================

export class BusinessRuleError extends AppError {
  constructor(message: string, rule: string, details?: Record<string, unknown>) {
    super(message, 'BUSINESS_RULE_VIOLATION', 422, true, { rule, ...details });
  }
}

export class WorkflowError extends AppError {
  constructor(message: string, workflowId: string, details?: Record<string, unknown>) {
    super(message, 'WORKFLOW_ERROR', 422, true, { workflowId, ...details });
  }
}

export class StepExecutionError extends AppError {
  constructor(message: string, stepId: string, stepType: string, details?: Record<string, unknown>) {
    super(message, 'STEP_EXECUTION_ERROR', 500, true, { stepId, stepType, ...details });
  }
}

// ==========================================
// EXTERNAL SERVICE ERRORS
// ==========================================

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`${service} error: ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, true, { service, ...details });
  }
}

export class AIProviderError extends AppError {
  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super(`AI Provider (${provider}) error: ${message}`, 'AI_PROVIDER_ERROR', 502, true, { provider, ...details });
  }
}

export class IntegrationError extends AppError {
  constructor(integration: string, message: string, details?: Record<string, unknown>) {
    super(`Integration (${integration}) error: ${message}`, 'INTEGRATION_ERROR', 502, true, { integration, ...details });
  }
}

// ==========================================
// RATE LIMITING ERRORS
// ==========================================

export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter: number = 60) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, true, { retryAfter });
    this.retryAfter = retryAfter;
  }
}

// ==========================================
// DATABASE ERRORS
// ==========================================

export class DatabaseError extends AppError {
  constructor(message: string, operation: string, details?: Record<string, unknown>) {
    super(message, 'DATABASE_ERROR', 500, false, { operation, ...details });
  }
}

// ==========================================
// CONFIGURATION ERRORS
// ==========================================

export class ConfigurationError extends AppError {
  constructor(message: string, key?: string) {
    super(message, 'CONFIGURATION_ERROR', 500, false, key ? { key } : undefined);
  }
}

// ==========================================
// ERROR UTILITIES
// ==========================================

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isOperationalError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.isOperational;
  }
  return false;
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(
      error.message,
      'INTERNAL_ERROR',
      500,
      false,
      { originalError: error.name }
    );
  }

  return new AppError(
    'An unexpected error occurred',
    'UNKNOWN_ERROR',
    500,
    false
  );
}

export function formatErrorResponse(error: AppError) {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    meta: {
      timestamp: error.timestamp.toISOString(),
    },
  };
}
