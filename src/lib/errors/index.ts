/**
 * Standardized error codes for CLI operations
 */
export enum ErrorCode {
  // Authentication errors (1xx)
  AUTH_REQUIRED = "AUTH_REQUIRED",
  AUTH_EXPIRED = "AUTH_EXPIRED",
  AUTH_INVALID = "AUTH_INVALID",

  // Project linking errors (2xx)
  NOT_LINKED = "NOT_LINKED",
  LINK_INVALID = "LINK_INVALID",
  LINK_MISMATCH = "LINK_MISMATCH",

  // Schema errors (3xx)
  SCHEMA_NOT_FOUND = "SCHEMA_NOT_FOUND",
  SCHEMA_INVALID = "SCHEMA_INVALID",
  SCHEMA_CONVERSION_FAILED = "SCHEMA_CONVERSION_FAILED",
  SCHEMA_CONFLICT = "SCHEMA_CONFLICT",

  // Network errors (4xx)
  NETWORK_OFFLINE = "NETWORK_OFFLINE",
  NETWORK_TIMEOUT = "NETWORK_TIMEOUT",
  API_ERROR = "API_ERROR",
  API_UNAUTHORIZED = "API_UNAUTHORIZED",
  API_NOT_FOUND = "API_NOT_FOUND",

  // Git errors (5xx)
  GIT_NOT_INITIALIZED = "GIT_NOT_INITIALIZED",
  GIT_UNCOMMITTED_CHANGES = "GIT_UNCOMMITTED_CHANGES",
  GIT_PULL_FAILED = "GIT_PULL_FAILED",
  GIT_STASH_FAILED = "GIT_STASH_FAILED",

  // Queue errors (6xx)
  QUEUE_FULL = "QUEUE_FULL",
  QUEUE_OPERATION_FAILED = "QUEUE_OPERATION_FAILED",

  // Validation errors (7xx)
  VALIDATION_FAILED = "VALIDATION_FAILED",
  INVALID_INPUT = "INVALID_INPUT",

  // System errors (8xx)
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * Error categories for grouping related errors
 */
export enum ErrorCategory {
  AUTHENTICATION = "Authentication",
  PROJECT_LINKING = "Project Linking",
  SCHEMA = "Schema",
  NETWORK = "Network",
  GIT = "Git",
  QUEUE = "Queue",
  VALIDATION = "Validation",
  SYSTEM = "System",
}

/**
 * Map error codes to categories
 */
const ERROR_CODE_TO_CATEGORY: Record<ErrorCode, ErrorCategory> = {
  [ErrorCode.AUTH_REQUIRED]: ErrorCategory.AUTHENTICATION,
  [ErrorCode.AUTH_EXPIRED]: ErrorCategory.AUTHENTICATION,
  [ErrorCode.AUTH_INVALID]: ErrorCategory.AUTHENTICATION,
  [ErrorCode.NOT_LINKED]: ErrorCategory.PROJECT_LINKING,
  [ErrorCode.LINK_INVALID]: ErrorCategory.PROJECT_LINKING,
  [ErrorCode.LINK_MISMATCH]: ErrorCategory.PROJECT_LINKING,
  [ErrorCode.SCHEMA_NOT_FOUND]: ErrorCategory.SCHEMA,
  [ErrorCode.SCHEMA_INVALID]: ErrorCategory.SCHEMA,
  [ErrorCode.SCHEMA_CONVERSION_FAILED]: ErrorCategory.SCHEMA,
  [ErrorCode.SCHEMA_CONFLICT]: ErrorCategory.SCHEMA,
  [ErrorCode.NETWORK_OFFLINE]: ErrorCategory.NETWORK,
  [ErrorCode.NETWORK_TIMEOUT]: ErrorCategory.NETWORK,
  [ErrorCode.API_ERROR]: ErrorCategory.NETWORK,
  [ErrorCode.API_UNAUTHORIZED]: ErrorCategory.NETWORK,
  [ErrorCode.API_NOT_FOUND]: ErrorCategory.NETWORK,
  [ErrorCode.GIT_NOT_INITIALIZED]: ErrorCategory.GIT,
  [ErrorCode.GIT_UNCOMMITTED_CHANGES]: ErrorCategory.GIT,
  [ErrorCode.GIT_PULL_FAILED]: ErrorCategory.GIT,
  [ErrorCode.GIT_STASH_FAILED]: ErrorCategory.GIT,
  [ErrorCode.QUEUE_FULL]: ErrorCategory.QUEUE,
  [ErrorCode.QUEUE_OPERATION_FAILED]: ErrorCategory.QUEUE,
  [ErrorCode.VALIDATION_FAILED]: ErrorCategory.VALIDATION,
  [ErrorCode.INVALID_INPUT]: ErrorCategory.VALIDATION,
  [ErrorCode.FILE_NOT_FOUND]: ErrorCategory.SYSTEM,
  [ErrorCode.PERMISSION_DENIED]: ErrorCategory.SYSTEM,
  [ErrorCode.UNKNOWN_ERROR]: ErrorCategory.SYSTEM,
};

/**
 * Suggested fixes for common error codes
 */
const ERROR_SUGGESTIONS: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.AUTH_REQUIRED]: "Run 'apso login' to authenticate",
  [ErrorCode.AUTH_EXPIRED]: "Run 'apso login' to refresh your authentication",
  [ErrorCode.NOT_LINKED]:
    "Run 'apso link' to link this project to a workspace and service",
  [ErrorCode.SCHEMA_NOT_FOUND]:
    "Run 'apso pull' to fetch the schema from the platform",
  [ErrorCode.SCHEMA_INVALID]:
    "Fix the .apsorc file or run 'apso pull' to fetch a fresh schema",
  [ErrorCode.SCHEMA_CONFLICT]:
    "Run 'apso diff' to see differences, then 'apso sync' to resolve",
  [ErrorCode.NETWORK_OFFLINE]:
    "Check your internet connection. Use 'apso queue flush' when online to process queued operations",
  [ErrorCode.API_UNAUTHORIZED]:
    "Run 'apso login' to refresh your authentication",
  [ErrorCode.API_NOT_FOUND]:
    "Verify the service ID is correct and you have access to it",
  [ErrorCode.GIT_UNCOMMITTED_CHANGES]:
    "Commit or stash your changes before running this command",
  [ErrorCode.QUEUE_FULL]:
    "Run 'apso queue flush' to process queued operations, or 'apso queue clear' to clear the queue",
};

/**
 * Standardized CLI error class
 */
export class CliError extends Error {
  public readonly code: ErrorCode;
  public readonly category: ErrorCategory;
  public readonly suggestion?: string;

  constructor(code: ErrorCode, message: string, suggestion?: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.category = ERROR_CODE_TO_CATEGORY[code];
    this.suggestion = suggestion || ERROR_SUGGESTIONS[code];
  }

  /**
   * Format error for display
   */
  format(): string {
    let output = `${this.category} Error (${this.code}): ${this.message}`;
    if (this.suggestion) {
      output += `\n\nSuggestion: ${this.suggestion}`;
    }
    return output;
  }

  /**
   * Convert to JSON for machine-readable output
   */
  toJSON(): {
    code: string;
    category: string;
    message: string;
    suggestion?: string;
  } {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      suggestion: this.suggestion,
    };
  }
}

/**
 * Helper function to create standardized errors
 */
export function createError(
  code: ErrorCode,
  message: string,
  suggestion?: string
): CliError {
  return new CliError(code, message, suggestion);
}

/**
 * Helper function to extract error code from an error
 */
export function getErrorCode(error: unknown): ErrorCode {
  if (error instanceof CliError) {
    return error.code;
  }

  const errorMessage = (error as Error)?.message || String(error);

  // Try to infer error code from message
  if (
    errorMessage.includes("not authenticated") ||
    errorMessage.includes("not logged in")
  ) {
    return ErrorCode.AUTH_REQUIRED;
  }
  if (errorMessage.includes("not linked")) {
    return ErrorCode.NOT_LINKED;
  }
  if (errorMessage.includes("offline") || errorMessage.includes("Network")) {
    return ErrorCode.NETWORK_OFFLINE;
  }
  if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
    return ErrorCode.API_UNAUTHORIZED;
  }
  if (errorMessage.includes("404") || errorMessage.includes("Not Found")) {
    return ErrorCode.API_NOT_FOUND;
  }
  if (errorMessage.includes("conflict")) {
    return ErrorCode.SCHEMA_CONFLICT;
  }

  return ErrorCode.UNKNOWN_ERROR;
}
