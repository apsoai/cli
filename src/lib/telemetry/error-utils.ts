/**
 * Error extraction and redaction utilities for telemetry.
 *
 * Extracts useful error properties (class, normalized message, code, entity,
 * field) while redacting sensitive data: file contents, secrets, tokens, env
 * values, and absolute paths. Home-directory paths are redacted.
 */

import os from "os";
import { ApsorcNamingError } from "../apsorc-parser";

/**
 * Sensitive patterns to redact from error messages and properties.
 */
const SENSITIVE_PATTERNS = [
  // API keys, tokens, secrets (common patterns)
  /\b[\w-]{20,}\b/g, // Long alphanumeric strings (potential tokens)
  /api[_-]?key[\s:=]+\S+/gi,
  /token[\s:=]+\S+/gi,
  /secret[\s:=]+\S+/gi,
  /password[\s:=]+\S+/gi,
  /bearer\s+\S+/gi,
  // Environment variable values
  /\b[A-Z_]+=\S+/g,
  // JWT tokens
  /(?:eyJ[\w-]+\.){2}[\w-]+/g,
];

/**
 * Maximum length for error messages in telemetry (truncate longer messages).
 */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Maximum number of error messages to include in an array.
 */
export const MAX_ERROR_MESSAGES = 10;

/**
 * Redact home directory paths from a string, replacing them with ~.
 * Handles both Unix (/) and Windows (\) path separators.
 */
function redactHomePath(str: string): string {
  const homeDir = os.homedir();
  if (!homeDir) return str;

  // Use split/join for safe replacement (no regex)
  let redacted = str.split(homeDir).join("~");

  // Also handle Windows paths with forward slashes (normalized paths)
  if (os.platform() === "win32" && homeDir.includes("\\")) {
    const homeDirForward = homeDir.replace(/\\/g, "/");
    redacted = redacted.split(homeDirForward).join("~");
  }

  return redacted;
}

/**
 * Redact sensitive information from a string.
 */
export function redactSensitiveData(str: string): string {
  if (!str) return str;

  let redacted = str;

  // Redact home directory paths
  redacted = redactHomePath(redacted);

  // Redact sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }

  return redacted;
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 */
export function truncate(str: string, maxLength: number = MAX_MESSAGE_LENGTH): string {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Normalize an error message by redacting sensitive data and truncating.
 */
export function normalizeErrorMessage(message: string): string {
  return truncate(redactSensitiveData(message));
}

/**
 * Extract the error class name from an error object.
 */
export function getErrorClass(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const constructor = (err as { constructor?: { name?: string } }).constructor;
  return constructor?.name;
}

/**
 * Extract the error code from an error object (if present).
 */
export function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Extract entity name from an error object (for schema/config errors).
 */
export function getErrorEntity(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const entity = (err as { entity?: unknown }).entity;
  return typeof entity === "string" ? entity : undefined;
}

/**
 * Extract field name from an error object (for schema/config errors).
 */
export function getErrorField(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const field = (err as { field?: unknown }).field;
  return typeof field === "string" ? field : undefined;
}

/**
 * Extract error messages array from a validation error.
 * Used for errors that carry multiple individual messages (e.g. ValidationError).
 */
export function getErrorMessages(err: unknown): string[] | undefined {
  if (!err || typeof err !== "object") return undefined;
  const messages = (err as { errorMessages?: unknown }).errorMessages;
  if (!Array.isArray(messages)) return undefined;
  return extractErrorMessages(messages);
}

/**
 * Extract structured error properties for telemetry.
 *
 * @param err - The error object
 * @returns Object with error properties suitable for telemetry
 */
export function extractErrorProperties(err: unknown): {
  // eslint-disable-next-line camelcase
  error_class?: string;
  // eslint-disable-next-line camelcase
  error_message?: string;
  // eslint-disable-next-line camelcase
  error_code?: string;
  entity?: string;
  field?: string;
  // eslint-disable-next-line camelcase
  error_messages?: string[];
} {
  const errorClass = getErrorClass(err);
  const message = err instanceof Error ? err.message : String(err);
  const errorCode = getErrorCode(err);
  const entity = getErrorEntity(err);
  const field = getErrorField(err);
  const errorMessages = getErrorMessages(err);

  const result: ReturnType<typeof extractErrorProperties> = {};

  // eslint-disable-next-line camelcase
  if (errorClass) result.error_class = errorClass;
  // eslint-disable-next-line camelcase
  if (message) result.error_message = normalizeErrorMessage(message);
  // eslint-disable-next-line camelcase
  if (errorCode) result.error_code = errorCode;
  if (entity) result.entity = entity;
  if (field) result.field = field;
  // eslint-disable-next-line camelcase
  if (errorMessages && errorMessages.length > 0) result.error_messages = errorMessages;

  return result;
}

/**
 * Extract an array of error messages from multiple errors, redacted and truncated.
 *
 * Used for validation errors where multiple issues may be present.
 *
 * @param errors - Array of errors (strings or Error objects)
 * @param maxCount - Maximum number of error messages to include
 * @returns Array of redacted, truncated error messages
 */
export function extractErrorMessages(
  errors: Array<string | Error>,
  maxCount: number = MAX_ERROR_MESSAGES
): string[] {
  return errors
    .slice(0, maxCount)
    .map((err) => {
      const message = err instanceof Error ? err.message : String(err);
      return normalizeErrorMessage(message);
    });
}

/**
 * Check if an error is a config or validation error (a user error).
 *
 * Config and validation errors should be marked as user errors, not CLI bugs.
 */
export function isConfigOrValidationError(err: unknown): boolean {
  if (!err) return false;

  // ApsorcNamingError and anything with userError=true
  if (err instanceof ApsorcNamingError) return true;
  if (typeof err === "object" && (err as { userError?: unknown }).userError === true) {
    return true;
  }

  // Check error message patterns
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    // Common validation/config error patterns
    if (
      message.includes("validation failed") ||
      message.includes("lint error") ||
      message.includes("configuration validation failed") ||
      message.includes("invalid") ||
      message.includes("does not reference an existing entity") ||
      message.includes("entity found with empty name") ||
      message.includes("failed to read or parse .apsorc")
    ) {
      return true;
    }
  }

  return false;
}
