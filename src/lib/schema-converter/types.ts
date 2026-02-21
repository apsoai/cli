import { ApsorcType } from "../apsorc-parser";

/**
 * Platform ServiceSchema structure as returned from the API.
 * The `apsorc` field contains the schema in JSON format.
 */
export interface PlatformServiceSchema {
  id?: number;
  apsorc: any; // JSON - typically matches LocalApsorcSchema structure
  status?: string;
  active?: boolean;
  version?: string;
  workspaceServiceId?: number;
  // eslint-disable-next-line camelcase
  created_at?: Date | string;
  // eslint-disable-next-line camelcase
  updated_at?: Date | string;
}

/**
 * Local .apsorc schema structure (V2 format)
 * Extends ApsorcType which already defines all required properties
 */
export type LocalApsorcSchema = ApsorcType;

/**
 * Result of a schema conversion operation
 */
export type ConversionResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError };

/**
 * Validation error with location information
 */
export interface ValidationError {
  message: string;
  entity?: string;
  field?: string;
  relationship?: string;
  path?: string; // JSON path for nested errors
}

/**
 * Options for schema conversion
 */
export interface ConversionOptions {
  /**
   * If true, preserve unsupported features as comments/metadata
   */
  preserveUnsupported?: boolean;
  /**
   * If true, log warnings for unsupported features
   */
  warnUnsupported?: boolean;
}
