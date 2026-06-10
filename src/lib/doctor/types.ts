import { Entity } from "../types/entity";
import { RelationshipMap } from "../types/relationship";
import { TargetLanguage } from "../types/generator";

/**
 * A single finding from a diagnostic check.
 */
export interface DiagnosticFinding {
  /** Check identifier (e.g. "pk-strategy") */
  check: string;
  /** Severity level */
  severity: "error" | "warning" | "info";
  /** Human-readable description */
  message: string;
  /** Affected entity name */
  entity?: string;
  /** Affected file path (relative to project root) */
  file?: string;
  /** Suggested fix */
  suggestion?: string;
}

/**
 * Context passed to each diagnostic check function.
 */
export interface DiagnosticContext {
  /** Parsed entities from .apsorc */
  entities: Entity[];
  /** Relationship map from .apsorc */
  relationshipMap: RelationshipMap;
  /** Root folder from .apsorc (e.g. "src") */
  rootFolder: string;
  /** Target language */
  language: TargetLanguage;
  /** Absolute path to the project root (where .apsorc lives) */
  projectRoot: string;
}
