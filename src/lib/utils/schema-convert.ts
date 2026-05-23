/**
 * Schema Conversion Utilities
 *
 * Converts between local .apsorc format and platform ServiceSchema format.
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
 * Shape returned by serviceSchemaToApsorc for writing back to .apsorc
 */
export interface ApsorcOutput {
  version: number;
  rootFolder: string;
  apiType: string;
  entities: ApsorcEntityOutput[];
  relationships: ApsorcRelationshipOutput[];
}

export interface ApsorcEntityOutput {
  name: string;
  primaryKeyType?: "serial" | "uuid";
  created_at?: boolean;
  updated_at?: boolean;
  fields?: ApsorcFieldOutput[];
  scopeBy?: string | string[];
}

export interface ApsorcFieldOutput {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  default?: unknown;
  index?: boolean;
}

export interface ApsorcRelationshipOutput {
  from: string;
  to: string;
  type: "OneToMany" | "ManyToOne" | "ManyToMany" | "OneToOne";
  to_name?: string;
  nullable?: boolean;
  bi_directional?: boolean;
  cascadeDelete?: boolean;
}

/**
 * Map from SchemaRelationship type format to ApsorcRelationship type format
 */
function platformTypeToApsorcType(
  type: SchemaRelationship["type"]
): ApsorcRelationshipOutput["type"] {
  const map: Record<SchemaRelationship["type"], ApsorcRelationshipOutput["type"]> = {
    "one-to-one": "OneToOne",
    "one-to-many": "OneToMany",
    "many-to-one": "ManyToOne",
    "many-to-many": "ManyToMany",
  };
  return map[type];
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
 * Convert platform ServiceSchema to .apsorc format for writing to disk.
 *
 * Reverses the conversion: flattens per-entity relationships back into a
 * top-level relationships array in v2 format.
 */
export function serviceSchemaToApsorc(schema: ServiceSchema): ApsorcOutput {
  const entities: ApsorcEntityOutput[] = [];
  const relationships: ApsorcRelationshipOutput[] = [];

  for (const schemaEntity of schema.entities) {
    // Convert fields back to .apsorc format
    const fields: ApsorcFieldOutput[] = (schemaEntity.fields || [])
      .filter((f) => !f.primaryKey) // Primary keys are implicit in .apsorc
      .map((field) => {
        const out: ApsorcFieldOutput = {
          name: field.name,
          type: field.type,
        };
        if (field.nullable) out.nullable = true;
        if (field.unique) out.unique = true;
        if (field.default !== undefined) out.default = field.default;
        if (field.index) out.index = true;
        return out;
      });

    const entityOut: ApsorcEntityOutput = {
      name: schemaEntity.name,
    };

    if (fields.length > 0) {
      entityOut.fields = fields;
    }

    if (schemaEntity.scopeBy && schemaEntity.scopeBy.length > 0) {
      entityOut.scopeBy =
        schemaEntity.scopeBy.length === 1
          ? schemaEntity.scopeBy[0]
          : schemaEntity.scopeBy;
    }

    entities.push(entityOut);

    // Convert per-entity relationships to flat array
    if (schemaEntity.relationships) {
      for (const rel of schemaEntity.relationships) {
        relationships.push({
          from: schemaEntity.name,
          to: rel.target,
          type: platformTypeToApsorcType(rel.type),
          to_name: rel.inverseSide || undefined,
          nullable: rel.nullable,
          cascadeDelete: rel.cascade,
        });
      }
    }
  }

  return {
    version: 2,
    rootFolder: "src",
    apiType: "rest",
    entities,
    relationships,
  };
}

/**
 * Recursively sort all object keys for deterministic serialization.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
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
