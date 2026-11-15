/**
 * Schema Conversion Utilities
 *
 * The platform stores a service's .apsorc as it is, so push and pull send the
 * file whole. apsorcToServiceSchema only feeds the entity, field and
 * relationship counts that validate, deploy and the MCP server print.
 */

import * as crypto from "crypto";
import { Entity } from "../types/entity";
import { RelationshipMap } from "../types/relationship";
import {
  ServiceSchema,
  SchemaEntity,
  SchemaField,
  SchemaRelationship,
} from "../api/types";

/**
 * Parsed .apsorc data shape (subset of ParsedApsorc from apsorc-parser.ts)
 */
export interface ParsedApsorcInput {
  rootFolder: string;
  apiType: string;
  entities: Entity[];
  relationshipMap: RelationshipMap;
}

/**
 * Map from ApsorcRelationship type format to SchemaRelationship type format
 */
function apsorcTypeToPlatformType(
  type: string
): SchemaRelationship["type"] {
  const map: Record<string, SchemaRelationship["type"]> = {
    OneToOne: "one-to-one",
    OneToMany: "one-to-many",
    ManyToOne: "many-to-one",
    ManyToMany: "many-to-many",
  };
  return map[type] || "many-to-one";
}

/**
 * Convert parsed .apsorc data to platform ServiceSchema format.
 *
 * The local .apsorc stores relationships as a flat RelationshipMap keyed by entity name.
 * The platform ServiceSchema stores relationships embedded per-entity.
 */
export function apsorcToServiceSchema(
  parsed: ParsedApsorcInput
): Omit<ServiceSchema, "id" | "serviceId" | "version" | "createdAt" | "updatedAt"> {
  const entities: SchemaEntity[] = parsed.entities.map((entity) => {
    // Convert fields
    const fields: SchemaField[] = (entity.fields || []).map((field) => ({
      name: field.name,
      type: field.type,
      nullable: field.nullable,
      unique: field.unique,
      default: field.default ?? undefined,
      primaryKey: field.primary,
      index: field.index,
    }));

    // Get relationships for this entity from the map
    const entityRelationships = parsed.relationshipMap[entity.name] || [];
    const relationships: SchemaRelationship[] = entityRelationships.map((rel) => ({
      name: rel.name,
      type: apsorcTypeToPlatformType(rel.type),
      target: rel.name,
      inverseSide: rel.referenceName || undefined,
      cascade: rel.cascadeDelete,
      nullable: rel.nullable,
    }));

    const schemaEntity: SchemaEntity = {
      name: entity.name,
      fields,
      relationships: relationships.length > 0 ? relationships : undefined,
      scopeBy: entity.scopeBy
        ? Array.isArray(entity.scopeBy)
          ? entity.scopeBy
          : [entity.scopeBy]
        : undefined,
    };

    return schemaEntity;
  });

  return { entities };
}

/**
 * Recursively sort all object keys for deterministic serialization.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Compute a SHA-256 hash of a schema for sync tracking.
 * Uses deterministic JSON serialization (recursively sorted keys).
 */
export function computeSchemaHash(schema: unknown): string {
  const serialized = JSON.stringify(sortKeys(schema));
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

type Apsorc = { entities?: { name: string }[] } & Record<string, unknown>;

/**
 * What pushing `local` would change on the platform's `remote` .apsorc:
 * entities by name, plus one line when anything outside `entities`
 * (relationships, auth, language and so on) differs.
 */
export function diffApsorc(
  remote: Apsorc | null,
  local: Apsorc
): { hasChanges: boolean; added: string[]; removed: string[]; modified: string[] } {
  const hashes = (rc: Apsorc | null) =>
    new Map((rc?.entities ?? []).map((e) => [e.name, computeSchemaHash(e)]));
  const settings = (rc: Apsorc | null) =>
    computeSchemaHash({ ...rc, entities: undefined });
  const before = hashes(remote);
  const after = hashes(local);

  const added = [...after.keys()].filter((name) => !before.has(name));
  const removed = [...before.keys()].filter((name) => !after.has(name));
  const modified = [...after.keys()].filter(
    (name) => before.has(name) && before.get(name) !== after.get(name)
  );
  if (settings(remote) !== settings(local)) {
    modified.push("relationships and settings");
  }

  return {
    hasChanges: added.length + removed.length + modified.length > 0,
    added,
    removed,
    modified,
  };
}
