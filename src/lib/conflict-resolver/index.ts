import { ux } from "@oclif/core";
import { LocalApsorcSchema } from "../schema-converter/types";
import { Entity } from "../types/entity";
import { Field } from "../types/field";

/**
 * Conflict resolution choice for an entity or field
 */
export type ResolutionChoice = "local" | "remote" | "merge" | "skip";

/**
 * Conflict information for a single entity
 */
export interface EntityConflict {
  entityName: string;
  type: "added" | "removed" | "changed";
  localEntity?: Entity;
  remoteEntity?: Entity;
  fieldConflicts?: FieldConflict[];
}

/**
 * Conflict information for a single field
 */
export interface FieldConflict {
  fieldName: string;
  type: "added" | "removed" | "changed";
  localField?: Field;
  remoteField?: Field;
  changes?: string[]; // Description of what changed
}

/**
 * Resolution result for an entity
 */
export interface EntityResolution {
  entityName: string;
  choice: ResolutionChoice;
  resolvedEntity?: Entity;
}

/**
 * Resolution result for a field
 */
export interface FieldResolution {
  fieldName: string;
  choice: ResolutionChoice;
  resolvedField?: Field;
}

/**
 * Complete resolution result
 */
export interface ResolutionResult {
  resolvedSchema: LocalApsorcSchema;
  entityResolutions: EntityResolution[];
  fieldResolutions: Map<string, FieldResolution[]>; // Map of entity name to field resolutions
}

/**
 * Detect all conflicts between local and remote schemas
 */
export function detectAllConflicts(
  localSchema: LocalApsorcSchema,
  remoteSchema: LocalApsorcSchema
): EntityConflict[] {
  const conflicts: EntityConflict[] = [];
  const localEntities = new Map(localSchema.entities.map((e) => [e.name, e]));
  const remoteEntities = new Map(remoteSchema.entities.map((e) => [e.name, e]));

  // Find entities only in local
  for (const [entityName, entity] of localEntities) {
    if (!remoteEntities.has(entityName)) {
      conflicts.push({
        entityName,
        type: "added",
        localEntity: entity,
        remoteEntity: undefined,
      });
    }
  }

  // Find entities only in remote
  for (const [entityName, entity] of remoteEntities) {
    if (!localEntities.has(entityName)) {
      conflicts.push({
        entityName,
        type: "removed",
        localEntity: undefined,
        remoteEntity: entity,
      });
    }
  }

  // Find entities that exist in both but have differences
  for (const [entityName, localEntity] of localEntities) {
    const remoteEntity = remoteEntities.get(entityName);
    if (remoteEntity) {
      const fieldConflicts = detectFieldConflicts(localEntity, remoteEntity);
      if (fieldConflicts.length > 0 || hasEntityLevelDifferences(localEntity, remoteEntity)) {
        conflicts.push({
          entityName,
          type: "changed",
          localEntity,
          remoteEntity,
          fieldConflicts,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Detect field-level conflicts within an entity
 */
function detectFieldConflicts(
  localEntity: Entity,
  remoteEntity: Entity
): FieldConflict[] {
  const conflicts: FieldConflict[] = [];
  const localFields = new Map((localEntity.fields || []).map((f) => [f.name, f]));
  const remoteFields = new Map((remoteEntity.fields || []).map((f) => [f.name, f]));

  // Find fields only in local
  for (const [fieldName, field] of localFields) {
    if (!remoteFields.has(fieldName)) {
      conflicts.push({
        fieldName,
        type: "added",
        localField: field,
        remoteField: undefined,
      });
    }
  }

  // Find fields only in remote
  for (const [fieldName, field] of remoteFields) {
    if (!localFields.has(fieldName)) {
      conflicts.push({
        fieldName,
        type: "removed",
        localField: undefined,
        remoteField: field,
      });
    }
  }

  // Find fields that exist in both but have differences
  for (const [fieldName, localField] of localFields) {
    const remoteField = remoteFields.get(fieldName);
    if (remoteField) {
      const changes = detectFieldChanges(localField, remoteField);
      if (changes.length > 0) {
        conflicts.push({
          fieldName,
          type: "changed",
          localField,
          remoteField,
          changes,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Detect what changed between two fields
 */
function detectFieldChanges(localField: Field, remoteField: Field): string[] {
  const changes: string[] = [];

  if (localField.type !== remoteField.type) {
    changes.push(`type: ${remoteField.type} -> ${localField.type}`);
  }
  if (localField.nullable !== remoteField.nullable) {
    changes.push(`nullable: ${remoteField.nullable} -> ${localField.nullable}`);
  }
  if (localField.default !== remoteField.default) {
    changes.push(`default: ${remoteField.default} -> ${localField.default}`);
  }
  if (localField.primary !== remoteField.primary) {
    changes.push(`primary: ${remoteField.primary} -> ${localField.primary}`);
  }
  if (localField.unique !== remoteField.unique) {
    changes.push(`unique: ${remoteField.unique} -> ${localField.unique}`);
  }
  if (localField.index !== remoteField.index) {
    changes.push(`index: ${remoteField.index} -> ${localField.index}`);
  }
  if (localField.length !== remoteField.length) {
    changes.push(`length: ${remoteField.length} -> ${localField.length}`);
  }

  return changes;
}

/**
 * Check if entities have differences beyond fields (e.g., indexes, uniques, etc.)
 */
function hasEntityLevelDifferences(localEntity: Entity, remoteEntity: Entity): boolean {
  // Compare indexes
  const localIndexes = JSON.stringify(localEntity.indexes || []);
  const remoteIndexes = JSON.stringify(remoteEntity.indexes || []);
  if (localIndexes !== remoteIndexes) return true;

  // Compare uniques
  const localUniques = JSON.stringify(localEntity.uniques || []);
  const remoteUniques = JSON.stringify(remoteEntity.uniques || []);
  if (localUniques !== remoteUniques) return true;

  // Compare other entity-level properties
  if (localEntity.primaryKeyType !== remoteEntity.primaryKeyType) return true;
  if (localEntity.created_at !== remoteEntity.created_at) return true;
  if (localEntity.updated_at !== remoteEntity.updated_at) return true;
  if (JSON.stringify(localEntity.scopeBy) !== JSON.stringify(remoteEntity.scopeBy)) return true;

  return false;
}

/**
 * Format entity for display
 */
function formatEntity(entity: Entity): string {
  const parts: string[] = [];
  parts.push(`  Name: ${entity.name}`);
  if (entity.primaryKeyType) {
    parts.push(`  Primary Key Type: ${entity.primaryKeyType}`);
  }
  if (entity.fields && entity.fields.length > 0) {
    parts.push(`  Fields:`);
    for (const field of entity.fields) {
      const nullable = field.nullable ? "?" : "";
      const primary = field.primary ? " [PRIMARY]" : "";
      const unique = field.unique ? " [UNIQUE]" : "";
      parts.push(`    - ${field.name}: ${field.type}${nullable}${primary}${unique}`);
    }
  }
  if (entity.indexes && entity.indexes.length > 0) {
    parts.push(`  Indexes: ${entity.indexes.length}`);
  }
  if (entity.uniques && entity.uniques.length > 0) {
    parts.push(`  Unique Constraints: ${entity.uniques.length}`);
  }
  return parts.join("\n");
}

/**
 * Format field for display
 */
function formatField(field: Field): string {
  const parts: string[] = [];
  parts.push(`    Name: ${field.name}`);
  parts.push(`    Type: ${field.type}`);
  if (field.nullable !== undefined) {
    parts.push(`    Nullable: ${field.nullable}`);
  }
  if (field.primary) {
    parts.push(`    Primary: true`);
  }
  if (field.unique) {
    parts.push(`    Unique: true`);
  }
  if (field.default !== undefined) {
    parts.push(`    Default: ${field.default}`);
  }
  if (field.length !== undefined) {
    parts.push(`    Length: ${field.length}`);
  }
  return parts.join("\n");
}

/**
 * Resolve conflicts interactively
 */
export async function resolveConflictsInteractively(
  localSchema: LocalApsorcSchema,
  remoteSchema: LocalApsorcSchema,
  log: (message: string) => void
): Promise<ResolutionResult> {
  const conflicts = detectAllConflicts(localSchema, remoteSchema);
  const entityResolutions: EntityResolution[] = [];
  const fieldResolutions = new Map<string, FieldResolution[]>();

  if (conflicts.length === 0) {
    // No conflicts, return local schema as-is
    return {
      resolvedSchema: localSchema,
      entityResolutions: [],
      fieldResolutions: new Map(),
    };
  }

  log("");
  log(`Found ${conflicts.length} conflict(s) to resolve:`);
  log("");

  // Resolve each conflict
  for (let i = 0; i < conflicts.length; i++) {
    const conflict = conflicts[i];
    log("\n=== Conflict " + (i + 1) + "/" + conflicts.length + ": Entity \"" + conflict.entityName + "\" ===");
    log("");

    if (conflict.type === "added") {
      // Entity only in local
      log("This entity exists only in LOCAL:");
      log(formatEntity(conflict.localEntity!));
      log("");
      // eslint-disable-next-line no-await-in-loop
      const choice = await ux.prompt(
        "How would you like to resolve this?\n" +
          "  [l]ocal - Keep the local entity\n" +
          "  [r]emote - Remove it (use remote, which doesn't have it)\n" +
          "  [s]kip - Skip this entity (exclude from merged schema)\n",
        { default: "l" }
      );

      const choiceChar = choice.toLowerCase().trim()[0];
      let resolutionChoice: ResolutionChoice;
      if (choiceChar === "l") {
        resolutionChoice = "local";
      } else if (choiceChar === "r") {
        resolutionChoice = "remote";
      } else {
        resolutionChoice = "skip";
      }

      entityResolutions.push({
        entityName: conflict.entityName,
        choice: resolutionChoice,
        resolvedEntity: resolutionChoice === "local" ? conflict.localEntity : undefined,
      });
    } else if (conflict.type === "removed") {
      // Entity only in remote
      log("This entity exists only in REMOTE:");
      log(formatEntity(conflict.remoteEntity!));
      log("");
      // eslint-disable-next-line no-await-in-loop
      const choice = await ux.prompt(
        "How would you like to resolve this?\n" +
          "  [l]ocal - Remove it (use local, which doesn't have it)\n" +
          "  [r]emote - Keep the remote entity\n" +
          "  [s]kip - Skip this entity (exclude from merged schema)\n",
        { default: "r" }
      );

      const choiceChar = choice.toLowerCase().trim()[0];
      let resolutionChoice: ResolutionChoice;
      if (choiceChar === "l") {
        resolutionChoice = "local";
      } else if (choiceChar === "r") {
        resolutionChoice = "remote";
      } else {
        resolutionChoice = "skip";
      }

      entityResolutions.push({
        entityName: conflict.entityName,
        choice: resolutionChoice,
        resolvedEntity: resolutionChoice === "remote" ? conflict.remoteEntity : undefined,
      });
    } else {
      // Entity exists in both but has differences
      log("LOCAL version:");
      log(formatEntity(conflict.localEntity!));
      log("");
      log("REMOTE version:");
      log(formatEntity(conflict.remoteEntity!));
      log("");

      // Show field conflicts if any
      if (conflict.fieldConflicts && conflict.fieldConflicts.length > 0) {
        log("This entity has " + conflict.fieldConflicts.length + " field conflict(s).");
        log("");

        const fieldResolutionsForEntity: FieldResolution[] = [];

        for (const fieldConflict of conflict.fieldConflicts) {
          log("--- Field: " + fieldConflict.fieldName + " ---");
          if (fieldConflict.type === "added") {
            log("This field exists only in LOCAL:");
            log(formatField(fieldConflict.localField!));
            log("");
            // eslint-disable-next-line no-await-in-loop
            const choice = await ux.prompt(
              "How would you like to resolve this field?\n" +
                "  [l]ocal - Keep the local field\n" +
                "  [r]emote - Remove it (use remote, which doesn't have it)\n" +
                "  [s]kip - Skip this field\n",
              { default: "l" }
            );

            const choiceChar = choice.toLowerCase().trim()[0];
            const resolutionChoice: ResolutionChoice = choiceChar === "l" ? "local" : choiceChar === "r" ? "remote" : "skip";
            fieldResolutionsForEntity.push({
              fieldName: fieldConflict.fieldName,
              choice: resolutionChoice,
              resolvedField: resolutionChoice === "local" ? fieldConflict.localField : undefined,
            });
          } else if (fieldConflict.type === "removed") {
            log("This field exists only in REMOTE:");
            log(formatField(fieldConflict.remoteField!));
            log("");
            // eslint-disable-next-line no-await-in-loop
            const choice = await ux.prompt(
              "How would you like to resolve this field?\n" +
                "  [l]ocal - Remove it (use local, which doesn't have it)\n" +
                "  [r]emote - Keep the remote field\n" +
                "  [s]kip - Skip this field\n",
              { default: "r" }
            );

            const choiceChar = choice.toLowerCase().trim()[0];
            const resolutionChoice: ResolutionChoice = choiceChar === "l" ? "local" : choiceChar === "r" ? "remote" : "skip";
            fieldResolutionsForEntity.push({
              fieldName: fieldConflict.fieldName,
              choice: resolutionChoice,
              resolvedField: resolutionChoice === "remote" ? fieldConflict.remoteField : undefined,
            });
          } else {
            // Field changed
            log("LOCAL version:");
            log(formatField(fieldConflict.localField!));
            log("");
            log("REMOTE version:");
            log(formatField(fieldConflict.remoteField!));
            if (fieldConflict.changes && fieldConflict.changes.length > 0) {
              log("");
              log("Changes: " + fieldConflict.changes.join(", "));
            }
            log("");
            // eslint-disable-next-line no-await-in-loop
            const choice = await ux.prompt(
              "How would you like to resolve this field?\n" +
                "  [l]ocal - Use local version\n" +
                "  [r]emote - Use remote version\n" +
                "  [s]kip - Skip this field\n",
              { default: "l" }
            );

            const choiceChar = choice.toLowerCase().trim()[0];
            const resolutionChoice: ResolutionChoice = choiceChar === "l" ? "local" : choiceChar === "r" ? "remote" : "skip";
            fieldResolutionsForEntity.push({
              fieldName: fieldConflict.fieldName,
              choice: resolutionChoice,
              resolvedField: resolutionChoice === "local" ? fieldConflict.localField : resolutionChoice === "remote" ? fieldConflict.remoteField : undefined,
            });
          }
        }

        fieldResolutions.set(conflict.entityName, fieldResolutionsForEntity);
      }

      // Ask about entity-level resolution
      log("For the entity itself:");
      // eslint-disable-next-line no-await-in-loop
      const choice = await ux.prompt(
        "How would you like to resolve this entity?\n" +
          "  [l]ocal - Use local version (with field resolutions above)\n" +
          "  [r]emote - Use remote version (with field resolutions above)\n" +
          "  [m]erge - Merge both versions (combine fields from both)\n" +
          "  [s]kip - Skip this entity\n",
        { default: "m" }
      );

      const choiceChar = choice.toLowerCase().trim()[0];
      let resolutionChoice: ResolutionChoice;
      let resolvedEntity: Entity | undefined;

      switch (choiceChar) {
      case "l": {
        resolutionChoice = "local";
        resolvedEntity = applyFieldResolutions(conflict.localEntity!, fieldResolutions.get(conflict.entityName) || []);
      
      break;
      }
      case "r": {
        resolutionChoice = "remote";
        resolvedEntity = applyFieldResolutions(conflict.remoteEntity!, fieldResolutions.get(conflict.entityName) || []);
      
      break;
      }
      case "m": {
        resolutionChoice = "merge";
        resolvedEntity = mergeEntities(conflict.localEntity!, conflict.remoteEntity!, fieldResolutions.get(conflict.entityName) || []);
      
      break;
      }
      default: {
        resolutionChoice = "skip";
      }
      }

      entityResolutions.push({
        entityName: conflict.entityName,
        choice: resolutionChoice,
        resolvedEntity,
      });
    }
  }

  // Build resolved schema
  const resolvedSchema = buildResolvedSchema(localSchema, remoteSchema, entityResolutions, fieldResolutions);

  return {
    resolvedSchema,
    entityResolutions,
    fieldResolutions,
  };
}

/**
 * Apply field resolutions to an entity
 */
function applyFieldResolutions(entity: Entity, fieldResolutions: FieldResolution[]): Entity {
  const resolvedFields: Field[] = [];
  const fieldResolutionsMap = new Map(fieldResolutions.map((r) => [r.fieldName, r]));

  // Process existing fields
  for (const field of entity.fields || []) {
    const resolution = fieldResolutionsMap.get(field.name);
    if (!resolution) {
      // No conflict for this field, keep it
      resolvedFields.push(field);
    } else if (resolution.choice === "local") {
      resolvedFields.push(resolution.resolvedField || field);
    } else if (resolution.choice === "skip") {
      // Skip this field
      continue;
    }
  }

  // Add fields from remote that were chosen
  for (const resolution of fieldResolutions) {
    if (resolution.choice === "remote" && resolution.resolvedField && // Check if we already have this field
      !resolvedFields.some((f) => f.name === resolution.fieldName)) {
        resolvedFields.push(resolution.resolvedField);
      }
  }

  return {
    ...entity,
    fields: resolvedFields,
  };
}

/**
 * Merge two entities
 */
function mergeEntities(
  localEntity: Entity,
  remoteEntity: Entity,
  fieldResolutions: FieldResolution[]
): Entity {
  const mergedFields: Field[] = [];
  const fieldResolutionsMap = new Map(fieldResolutions.map((r) => [r.fieldName, r]));
  const processedFields = new Set<string>();

  // Start with local fields
  for (const field of localEntity.fields || []) {
    const resolution = fieldResolutionsMap.get(field.name);
    if (resolution) {
      if (resolution.choice === "local" && resolution.resolvedField) {
        mergedFields.push(resolution.resolvedField);
        processedFields.add(field.name);
      } else if (resolution.choice === "skip") {
        // Skip this field
        processedFields.add(field.name);
      }
    } else {
      // No conflict, keep local field
      mergedFields.push(field);
      processedFields.add(field.name);
    }
  }

  // Add remote fields that don't conflict or were chosen
  for (const field of remoteEntity.fields || []) {
    if (processedFields.has(field.name)) {
      continue;
    }

    const resolution = fieldResolutionsMap.get(field.name);
    if (resolution) {
      if (resolution.choice === "remote" && resolution.resolvedField) {
        mergedFields.push(resolution.resolvedField);
      }
    } else {
      // No conflict, add remote field
      mergedFields.push(field);
    }
  }

  // Merge entity-level properties (prefer local for non-field properties)
  return {
    ...localEntity,
    ...remoteEntity,
    name: localEntity.name, // Entity name should match
    fields: mergedFields,
    // For indexes and uniques, prefer local but could be enhanced to merge
    indexes: localEntity.indexes || remoteEntity.indexes,
    uniques: localEntity.uniques || remoteEntity.uniques,
  };
}

/**
 * Build the final resolved schema from resolutions
 */
function buildResolvedSchema(
  localSchema: LocalApsorcSchema,
  remoteSchema: LocalApsorcSchema,
  entityResolutions: EntityResolution[],
  _fieldResolutions: Map<string, FieldResolution[]>
): LocalApsorcSchema {
  const resolvedEntities: Entity[] = [];
  const resolvedEntityNames = new Set<string>();

  // Process entity resolutions
  for (const resolution of entityResolutions) {
    if (resolution.choice === "skip") {
      continue;
    }

    if (resolution.resolvedEntity) {
      resolvedEntities.push(resolution.resolvedEntity);
      resolvedEntityNames.add(resolution.entityName);
    }
  }

  // Add entities that don't have conflicts (from local)
  for (const entity of localSchema.entities) {
    if (!resolvedEntityNames.has(entity.name)) {
      resolvedEntities.push(entity);
      resolvedEntityNames.add(entity.name);
    }
  }

  // Add entities that don't have conflicts (from remote)
  for (const entity of remoteSchema.entities) {
    if (!resolvedEntityNames.has(entity.name)) {
      resolvedEntities.push(entity);
      resolvedEntityNames.add(entity.name);
    }
  }

  // Merge relationships (prefer local, add missing from remote)
  const localRelSet = new Set(
    (localSchema.relationships || []).map((r) => r.from + "->" + r.to + ":" + r.type)
  );
  const resolvedRelationships = [...(localSchema.relationships || [])];
  for (const rel of remoteSchema.relationships || []) {
    const key = rel.from + "->" + rel.to + ":" + rel.type;
    if (!localRelSet.has(key)) {
      resolvedRelationships.push(rel);
    }
  }

  // Ensure required fields are present (use local first, fallback to remote, then defaults)
  const resolvedSchema: LocalApsorcSchema = {
    version: localSchema.version || remoteSchema.version || 2,
    rootFolder: localSchema.rootFolder || remoteSchema.rootFolder || "src",
    apiType: localSchema.apiType || remoteSchema.apiType || "Rest",
    entities: resolvedEntities,
    relationships: resolvedRelationships,
  };

  // Preserve optional fields from local schema if they exist
  if (localSchema.auth) {
    resolvedSchema.auth = localSchema.auth;
  }

  return resolvedSchema;
}

