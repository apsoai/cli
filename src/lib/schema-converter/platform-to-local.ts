import { LocalApsorcSchema, ConversionResult, ConversionOptions } from "./types";
import { Entity } from "../types/entity";
import { ApsorcRelationship } from "../types/relationship";

/**
 * Converts a platform ServiceSchema to local .apsorc format
 */
export class PlatformToLocalConverter {
  private options: ConversionOptions;

  constructor(options: ConversionOptions = {}) {
    this.options = {
      preserveUnsupported: true,
      warnUnsupported: true,
      ...options,
    };
  }

  /**
   * Convert platform schema to local .apsorc format
   */
  convert(platformSchema: any): ConversionResult<LocalApsorcSchema> {
    try {
      // Extract apsorc from platform schema if it's wrapped
      let apsorcData = platformSchema;
      if (platformSchema.apsorc) {
        apsorcData = platformSchema.apsorc;
      }

      // Handle string JSON
      if (typeof apsorcData === "string") {
        try {
          apsorcData = JSON.parse(apsorcData);
        } catch (error) {
          return {
            success: false,
            error: {
              message: `Invalid JSON in platform schema: ${(error as Error).message}`,
            },
          };
        }
      }

      // Normalize to V2 format
      const normalized = this.normalizeToV2(apsorcData);

      // Validate structure
      const validation = this.validateStructure(normalized);
      if (!validation.success) {
        return validation;
      }

      // Sort for deterministic output
      const sorted = this.sortForDeterminism(normalized);

      return {
        success: true,
        data: sorted,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: `Conversion failed: ${(error as Error).message}`,
        },
      };
    }
  }

  /**
   * Normalize platform schema to .apsorc V2 format
   */
  private normalizeToV2(data: any): LocalApsorcSchema {
    // Ensure version 2
    const version = data.version || 2;
    if (version !== 2 && version !== 1 && this.options.warnUnsupported) {
        console.warn(
          `Warning: Platform schema version ${version} is not fully supported. Converting to V2 format.`
        );
      }

    // Normalize entities
    const entities = this.normalizeEntities(data.entities || []);

    // Normalize relationships
    const relationships = this.normalizeRelationships(
      data.relationships || [],
      entities
    );

    return {
      version: 2,
      rootFolder: data.rootFolder || "src",
      apiType: data.apiType || "Rest",
      entities,
      relationships,
      auth: data.auth,
    };
  }

  /**
   * Normalize entities array
   */
  private normalizeEntities(entities: any[]): Entity[] {
    return entities.map((entity) => {
      const normalized: Entity = {
        name: entity.name,
        created_at: entity.created_at ?? false,
        updated_at: entity.updated_at ?? false,
      };

      // Add primaryKeyType if present
      if (entity.primaryKeyType) {
        normalized.primaryKeyType = entity.primaryKeyType;
      }

      // Normalize fields
      if (Array.isArray(entity.fields)) {
        normalized.fields = entity.fields.map((field: any) => ({
          name: field.name,
          type: field.type,
          nullable: field.nullable ?? false,
          ...(field.values && { values: field.values }),
          ...(field.default !== undefined && { default: field.default }),
          ...(field.length !== undefined && { length: field.length }),
          ...(field.precision !== undefined && { precision: field.precision }),
          ...(field.scale !== undefined && { scale: field.scale }),
          ...(field.is_email !== undefined && { is_email: field.is_email }),
          ...(field.primary !== undefined && { primary: field.primary }),
          ...(field.unique !== undefined && { unique: field.unique }),
          ...(field.index !== undefined && { index: field.index }),
        }));
      }

      // Normalize indexes
      if (Array.isArray(entity.indexes)) {
        normalized.indexes = entity.indexes.map((idx: any) => ({
          fields: idx.fields || [],
          unique: idx.unique ?? false,
          ...(idx.name && { name: idx.name }),
        }));
      }

      // Normalize uniques
      if (Array.isArray(entity.uniques)) {
        normalized.uniques = entity.uniques.map((uniq: any) => ({
          fields: uniq.fields || [],
          ...(uniq.name && { name: uniq.name }),
        }));
      }

      // Preserve scopeBy if present
      if (entity.scopeBy !== undefined) {
        normalized.scopeBy = entity.scopeBy;
      }

      // Preserve scopeOptions if present
      if (entity.scopeOptions !== undefined) {
        normalized.scopeOptions = entity.scopeOptions;
      }

      return normalized;
    });
  }

  /**
   * Normalize relationships array
   */
  private normalizeRelationships(
    relationships: any[],
    entities: Entity[]
  ): ApsorcRelationship[] {
    const entityNames = new Set(entities.map((e) => e.name));

    return relationships.map((rel) => {
      // Validate entity references
      if (!entityNames.has(rel.from) && this.options.warnUnsupported) {
          console.warn(
            `Warning: Relationship references unknown entity "${rel.from}"`
          );
        }
      if (!entityNames.has(rel.to) && this.options.warnUnsupported) {
          console.warn(
            `Warning: Relationship references unknown entity "${rel.to}"`
          );
        }

      const normalized: ApsorcRelationship = {
        from: rel.from,
        to: rel.to,
        type: rel.type,
      };

      // Add optional fields
      if (rel.to_name !== undefined) {
        normalized.to_name = rel.to_name;
      }
      if (rel.nullable !== undefined) {
        normalized.nullable = rel.nullable;
      }
      if (rel.bi_directional !== undefined) {
        normalized.bi_directional = rel.bi_directional;
      }
      if (rel.cascadeDelete !== undefined) {
        normalized.cascadeDelete = rel.cascadeDelete;
      }
      if (rel.index !== undefined) {
        normalized.index = rel.index;
      }
      if (rel.joinTableName !== undefined) {
        normalized.joinTableName = rel.joinTableName;
      }
      if (rel.joinColumnName !== undefined) {
        normalized.joinColumnName = rel.joinColumnName;
      }
      if (rel.inverseJoinColumnName !== undefined) {
        normalized.inverseJoinColumnName = rel.inverseJoinColumnName;
      }

      return normalized;
    });
  }

  /**
   * Validate the normalized schema structure
   */
  private validateStructure(
    schema: LocalApsorcSchema
  ): ConversionResult<LocalApsorcSchema> {
    if (!schema.version || schema.version !== 2) {
      return {
        success: false,
        error: {
          message: "Schema must be version 2",
        },
      };
    }

    if (!schema.rootFolder || typeof schema.rootFolder !== "string") {
      return {
        success: false,
        error: {
          message: "Schema must have a valid rootFolder",
        },
      };
    }

    if (!Array.isArray(schema.entities)) {
      return {
        success: false,
        error: {
          message: "Schema must have an entities array",
        },
      };
    }

    // Validate entities
    for (const entity of schema.entities) {
      if (!entity.name || typeof entity.name !== "string") {
        return {
          success: false,
          error: {
            message: "Entity must have a valid name",
            entity: entity.name,
          },
        };
      }
    }

    // Validate relationships
    if (!Array.isArray(schema.relationships)) {
      return {
        success: false,
        error: {
          message: "Schema must have a relationships array",
        },
      };
    }

    const entityNames = new Set(schema.entities.map((e) => e.name));
    for (const rel of schema.relationships) {
      if (!entityNames.has(rel.from)) {
        return {
          success: false,
          error: {
            message: `Relationship references unknown entity "${rel.from}"`,
            relationship: `${rel.from} -> ${rel.to}`,
          },
        };
      }
      if (!entityNames.has(rel.to)) {
        return {
          success: false,
          error: {
            message: `Relationship references unknown entity "${rel.to}"`,
            relationship: `${rel.from} -> ${rel.to}`,
          },
        };
      }
    }

    return { success: true, data: schema };
  }

  /**
   * Sort schema components for deterministic output
   */
  private sortForDeterminism(
    schema: LocalApsorcSchema
  ): LocalApsorcSchema {
    // Sort entities by name
    const sortedEntities = [...schema.entities].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Sort fields within each entity
    const entitiesWithSortedFields = sortedEntities.map((entity) => ({
      ...entity,
      fields: entity.fields
        ? [...entity.fields].sort((a, b) => a.name.localeCompare(b.name))
        : undefined,
      indexes: entity.indexes
        ? [...entity.indexes].sort((a, b) => {
            const aFields = (a.fields || []).join(",");
            const bFields = (b.fields || []).join(",");
            return aFields.localeCompare(bFields);
          })
        : undefined,
      uniques: entity.uniques
        ? [...entity.uniques].sort((a, b) => {
            const aFields = (a.fields || []).join(",");
            const bFields = (b.fields || []).join(",");
            return aFields.localeCompare(bFields);
          })
        : undefined,
    }));

    // Sort relationships deterministically
    const sortedRelationships = [...schema.relationships].sort((a, b) => {
      const fromCompare = a.from.localeCompare(b.from);
      if (fromCompare !== 0) return fromCompare;
      const toCompare = a.to.localeCompare(b.to);
      if (toCompare !== 0) return toCompare;
      return a.type.localeCompare(b.type);
    });

    return {
      ...schema,
      entities: entitiesWithSortedFields,
      relationships: sortedRelationships,
    };
  }
}

