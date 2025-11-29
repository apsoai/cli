import { Unique } from "./constraints";
import { Field } from "./field";
import { Index } from "./indices";
import { Association } from "./relationship";

/**
 * Operations that can have scope enforcement applied
 */
export type ScopeOperation = 'find' | 'get' | 'create' | 'update' | 'delete';

/**
 * Configuration options for scope enforcement behavior
 */
export interface ScopeOptions {
  /**
   * If true (default), scope fields are automatically injected from
   * the request context on create when not provided.
   */
  injectOnCreate?: boolean;

  /**
   * Which operations should enforce scope. Defaults to all operations.
   */
  enforceOn?: ScopeOperation[];

  /**
   * Roles allowed to bypass scope enforcement (e.g., 'system_admin').
   */
  bypassRoles?: string[];
}

export interface Entity {
  name: string;
  /* eslint-disable-next-line  camelcase */
  created_at?: boolean;
  /* eslint-disable-next-line  camelcase */
  updated_at?: boolean;
  primaryKeyType?: 'serial' | 'uuid';
  fields?: Field[];
  indexes?: Index[];
  uniques?: Unique[];

  /**
   * Fields or paths that define the authorization scope for this entity.
   * Can be a single field name (e.g., 'workspaceId') or an array of fields/paths
   * (e.g., ['workspaceId', 'serviceId'] or ['task.workspaceId']).
   *
   * - Direct fields: 'workspaceId' - enforces WHERE workspaceId = ctx.workspaceId
   * - Nested paths: 'task.workspaceId' - joins to related entity and enforces scope
   */
  scopeBy?: string | string[];

  /**
   * Optional configuration for how scope enforcement should behave.
   */
  scopeOptions?: ScopeOptions;

  // only used for v1
  associations?: Association[];
}
