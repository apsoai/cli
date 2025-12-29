import { createHash } from "crypto";
import { LocalApsorcSchema } from "../schema-converter/types";

/**
 * Calculate a deterministic hash for a schema
 * @param schema The schema to hash
 * @returns A short hash identifier (e.g., "sha256:abc123...")
 */
export function calculateSchemaHash(schema: LocalApsorcSchema): string {
  const normalized = normalizeSchemaForHashing(schema);
  const content = JSON.stringify(normalized);
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash.slice(0, 16)}`;
}

/**
 * Normalize schema for hashing by sorting all arrays deterministically
 * This ensures the same schema always produces the same hash regardless of order
 */
export function normalizeSchemaForHashing(schema: LocalApsorcSchema): any {
  // Sort entities alphabetically by name
  const sortedEntities = [...(schema.entities || [])].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Sort fields within each entity
  const entitiesWithSortedFields = sortedEntities.map((entity) => {
    const normalizedEntity: any = {
      name: entity.name,
      // eslint-disable-next-line camelcase
      created_at: entity.created_at ?? false,
      // eslint-disable-next-line camelcase
      updated_at: entity.updated_at ?? false,
    };

    // Add optional fields only if they exist
    if (entity.primaryKeyType) {
      normalizedEntity.primaryKeyType = entity.primaryKeyType;
    }

    // Sort fields alphabetically
    if (entity.fields && Array.isArray(entity.fields)) {
      normalizedEntity.fields = [...entity.fields].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    }

    // Sort indexes
    if (entity.indexes && Array.isArray(entity.indexes)) {
      normalizedEntity.indexes = [...entity.indexes].sort((a, b) => {
        const aFields = (a.fields || []).join(",");
        const bFields = (b.fields || []).join(",");
        const fieldCompare = aFields.localeCompare(bFields);
        if (fieldCompare !== 0) return fieldCompare;
        return (a.unique ? 1 : 0) - (b.unique ? 1 : 0);
      });
    }

    // Sort uniques
    if (entity.uniques && Array.isArray(entity.uniques)) {
      normalizedEntity.uniques = [...entity.uniques].sort((a, b) => {
        const aFields = (a.fields || []).join(",");
        const bFields = (b.fields || []).join(",");
        return aFields.localeCompare(bFields);
      });
    }

    // Preserve scopeBy and scopeOptions if present
    if (entity.scopeBy !== undefined) {
      normalizedEntity.scopeBy = entity.scopeBy;
    }
    if (entity.scopeOptions !== undefined) {
      normalizedEntity.scopeOptions = entity.scopeOptions;
    }

    return normalizedEntity;
  });

  // Sort relationships deterministically
  const sortedRelationships = [...(schema.relationships || [])].sort((a, b) => {
    const fromCompare = a.from.localeCompare(b.from);
    if (fromCompare !== 0) return fromCompare;
    const toCompare = a.to.localeCompare(b.to);
    if (toCompare !== 0) return toCompare;
    return a.type.localeCompare(b.type);
  });

  // Build normalized schema (only include fields that affect schema semantics)
  const normalized: any = {
    version: schema.version,
    rootFolder: schema.rootFolder,
    apiType: schema.apiType,
    entities: entitiesWithSortedFields,
    relationships: sortedRelationships,
  };

  // Include auth if present (it affects schema semantics)
  if (schema.auth !== undefined) {
    normalized.auth = schema.auth;
  }

  return normalized;
}

/**
 * Check if two hashes match
 */
export function hashesMatch(
  hash1: string | null,
  hash2: string | null
): boolean {
  if (!hash1 || !hash2) {
    return false;
  }
  return hash1 === hash2;
}

/**
 * Check if schemas have diverged (hashes don't match)
 */
export function isHashDiverged(
  localHash: string | null,
  remoteHash: string | null
): boolean {
  if (!localHash || !remoteHash) {
    return true; // Consider diverged if either hash is missing
  }
  return localHash !== remoteHash;
}
