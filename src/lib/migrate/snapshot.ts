/**
 * Schema Snapshot Manager
 *
 * Manages the schema snapshot at .apso/sandbox/schema-snapshot.json.
 * The snapshot stores the .apsorc content at the time of last successful migration.
 * Comparing current .apsorc against the snapshot detects whether a migration is needed.
 */

import * as fs from "fs";
import * as path from "path";
import { getProjectConfigDir, ensureDir } from "../config/paths";

/**
 * Shape of the stored snapshot (mirrors the parsed .apsorc structure)
 */
export interface ApsorcSnapshot {
  entities: Array<{
    name: string;
    fields?: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      unique?: boolean;
      default?: unknown;
      index?: boolean;
    }>;
    primaryKeyType?: string;
    created_at?: boolean;
    updated_at?: boolean;
    scopeBy?: string | string[];
  }>;
  relationships?: Array<{
    from: string;
    to: string;
    type: string;
    to_name?: string;
    nullable?: boolean;
    bi_directional?: boolean;
    cascadeDelete?: boolean;
  }>;
  version?: number;
  rootFolder?: string;
  apiType?: string;
}

/**
 * Subset of ParsedApsorc we use for comparison.
 * Avoids importing the full ParsedApsorc type which carries runtime-only data (relationshipMap).
 */
export interface ComparableSchema {
  entities: Array<{
    name: string;
    fields?: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      unique?: boolean;
      default?: unknown;
      index?: boolean;
    }>;
    primaryKeyType?: string;
    created_at?: boolean;
    updated_at?: boolean;
    scopeBy?: string | string[];
  }>;
}

function getSandboxDir(projectDir?: string): string {
  return path.join(getProjectConfigDir(projectDir), "sandbox");
}

function getSnapshotPath(projectDir?: string): string {
  return path.join(getSandboxDir(projectDir), "schema-snapshot.json");
}

/**
 * Read the saved schema snapshot, or null if none exists.
 */
export function readSnapshot(projectDir?: string): ApsorcSnapshot | null {
  const snapshotPath = getSnapshotPath(projectDir);
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(snapshotPath, "utf8");
    return JSON.parse(content) as ApsorcSnapshot;
  } catch {
    return null;
  }
}

/**
 * Write a schema snapshot to disk.
 */
export function writeSnapshot(
  schema: ApsorcSnapshot,
  projectDir?: string
): void {
  const sandboxDir = getSandboxDir(projectDir);
  ensureDir(sandboxDir);
  const snapshotPath = getSnapshotPath(projectDir);
  fs.writeFileSync(snapshotPath, JSON.stringify(schema, null, 2), "utf-8");
}

/**
 * Delete the snapshot and sandbox directory contents (for --reset).
 */
export function resetSnapshot(projectDir?: string): void {
  const sandboxDir = getSandboxDir(projectDir);
  if (fs.existsSync(sandboxDir)) {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }
}

/**
 * Detect whether the current schema differs from the stored snapshot.
 *
 * Compares entity names, field definitions, and relationships using
 * deterministic JSON serialization. Returns true if any change is detected,
 * or if no snapshot exists (first run).
 */
export function hasChanges(
  current: ComparableSchema,
  snapshot: ApsorcSnapshot | null
): boolean {
  if (!snapshot) {
    return true;
  }

  const normalize = (obj: unknown): string => JSON.stringify(obj);

  // Compare entity count
  if (current.entities.length !== snapshot.entities.length) {
    return true;
  }

  // Build maps for comparison
  const currentMap = new Map(
    current.entities.map((e) => [e.name, e])
  );
  const snapshotMap = new Map(
    snapshot.entities.map((e) => [e.name, e])
  );

  // Check for added or removed entities
  for (const name of currentMap.keys()) {
    if (!snapshotMap.has(name)) {
      return true;
    }
  }

  for (const name of snapshotMap.keys()) {
    if (!currentMap.has(name)) {
      return true;
    }
  }

  // Deep compare each entity
  for (const [name, currentEntity] of currentMap) {
    const snapshotEntity = snapshotMap.get(name);
    if (!snapshotEntity) {
      return true;
    }

    if (normalize(currentEntity) !== normalize(snapshotEntity)) {
      return true;
    }
  }

  return false;
}
