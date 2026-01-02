import { LocalApsorcSchema, ConversionResult, ValidationError } from "./types";
import { Entity } from "../types/entity";
import { ApsorcRelationship } from "../types/relationship";

/**
 * Converts local .apsorc schema to platform ServiceSchema format
 */
export class LocalToPlatformConverter {
  /**
   * Convert local .apsorc schema to platform format
   */
  convert(localSchema: LocalApsorcSchema): ConversionResult<any> {
    try {
      // Validate the local schema first
      const validation = this.validateLocalSchema(localSchema);
      if (!validation.success) {
        return validation;
      }

      // Convert to platform format
      const platformSchema = this.convertToPlatformFormat(localSchema);

      return {
        success: true,
        data: platformSchema,
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
   * Validate local .apsorc schema structure
   */
  private validateLocalSchema(
    schema: LocalApsorcSchema
  ): ConversionResult<LocalApsorcSchema> {
    // Validate version
    if (!schema.version) {
      return {
        success: false,
        error: {
          message: "Schema is missing 'version' field",
        },
      };
    }

    if (schema.version !== 2 && schema.version !== 1) {
      return {
        success: false,
        error: {
          message: `Unsupported schema version: ${schema.version}. Only versions 1 and 2 are supported.`,
        },
      };
    }

    // Validate rootFolder
    if (!schema.rootFolder || typeof schema.rootFolder !== "string") {
      return {
        success: false,
        error: {
          message: "Schema must have a valid 'rootFolder' field (string)",
        },
      };
    }

    // Validate apiType
    if (!schema.apiType || typeof schema.apiType !== "string") {
      return {
        success: false,
        error: {
          message: "Schema must have a valid 'apiType' field (string)",
        },
      };
    }

    // Validate entities
    if (!Array.isArray(schema.entities)) {
      return {
        success: false,
        error: {
          message: "Schema must have an 'entities' array",
        },
      };
    }

    if (schema.entities.length === 0) {
      return {
        success: false,
        error: {
          message: "Schema must have at least one entity",
        },
      };
    }

    // Validate each entity
    const entityNames = new Set<string>();
    for (let i = 0; i < schema.entities.length; i++) {
      const entity = schema.entities[i];
      const entityError = this.validateEntity(entity, i);
      if (entityError) {
        return {
          success: false,
          error: entityError,
        };
      }

      // Check for duplicate entity names
      if (entityNames.has(entity.name)) {
        return {
          success: false,
          error: {
            message: `Duplicate entity name: "${entity.name}"`,
            entity: entity.name,
          },
        };
      }
      entityNames.add(entity.name);
    }

    // Validate relationships (only for V2)
    if (schema.version === 2) {
      if (!Array.isArray(schema.relationships)) {
        return {
          success: false,
          error: {
            message: "Version 2 schema must have a 'relationships' array",
          },
        };
      }

      for (const rel of schema.relationships) {
        const relError = this.validateRelationship(rel, entityNames);
        if (relError) {
          return {
            success: false,
            error: relError,
          };
        }
      }
    }

    return { success: true, data: schema };
  }

  /**
   * Validate a single entity
   */
  private validateEntity(
    entity: Entity,
    index: number
  ): ValidationError | null {
    // Validate entity name
    if (!entity.name || typeof entity.name !== "string") {
      return {
        message: `Entity at index ${index} must have a valid 'name' field (string)`,
        entity: entity.name || `[index ${index}]`,
      };
    }

    // Validate entity name format (basic identifier check)
    if (!/^[A-Za-z]\w*$/.test(entity.name)) {
      return {
        message: `Entity name "${entity.name}" is invalid. Must start with a letter and contain only letters, numbers, and underscores.`,
        entity: entity.name,
      };
    }

    // Validate fields if present
    if (entity.fields) {
      if (!Array.isArray(entity.fields)) {
        return {
          message: `Entity "${entity.name}" has invalid 'fields' field. Must be an array.`,
          entity: entity.name,
        };
      }

      const fieldNames = new Set<string>();
      for (let i = 0; i < entity.fields.length; i++) {
        const field = entity.fields[i];
        const fieldError = this.validateField(field, entity.name, i);
        if (fieldError) {
          return fieldError;
        }

        // Check for duplicate field names
        if (fieldNames.has(field.name)) {
          return {
            message: `Entity "${entity.name}" has duplicate field name: "${field.name}"`,
            entity: entity.name,
            field: field.name,
          };
        }
        fieldNames.add(field.name);
      }
    }

    return null;
  }

  /**
   * Validate a single field
   */
  private validateField(
    field: any,
    entityName: string,
    index: number
  ): ValidationError | null {
    // Validate field name
    if (!field.name || typeof field.name !== "string") {
      return {
        message: `Entity "${entityName}" has field at index ${index} without a valid 'name' field (string)`,
        entity: entityName,
        field: field.name || `[index ${index}]`,
      };
    }

    // Validate field name format
    if (!/^[a-z][\d_a-z]*$/.test(field.name)) {
      return {
        message: `Entity "${entityName}" has invalid field name "${field.name}". Must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.`,
        entity: entityName,
        field: field.name,
      };
    }

    // Validate field type
    if (!field.type || typeof field.type !== "string") {
      return {
        message: `Entity "${entityName}" field "${field.name}" is missing a valid 'type' field (string)`,
        entity: entityName,
        field: field.name,
      };
    }

    // Validate field type is known
    const validTypes = [
      "text",
      "boolean",
      "array",
      "enum",
      "integer",
      "float",
      "decimal",
      "numeric",
      "date",
      "timestamp",
      "json",
      "json-plain",
      "varchar",
      "money",
      "bigint",
    ];
    if (!validTypes.includes(field.type)) {
      return {
        message: `Entity "${entityName}" field "${field.name}" has invalid type "${field.type}". Valid types are: ${validTypes.join(", ")}`,
        entity: entityName,
        field: field.name,
      };
    }

    // Validate enum values if type is enum
    if (field.type === "enum" && (!Array.isArray(field.values) || field.values.length === 0)) {
        return {
          message: `Entity "${entityName}" field "${field.name}" is of type "enum" but is missing a 'values' array with at least one value`,
          entity: entityName,
          field: field.name,
        };
      }

    return null;
  }

  /**
   * Validate a single relationship
   */
  private validateRelationship(
    rel: ApsorcRelationship,
    entityNames: Set<string>
  ): ValidationError | null {
    // Validate from entity
    if (!rel.from || typeof rel.from !== "string") {
      return {
        message: "Relationship is missing a valid 'from' field (string)",
        relationship: `${rel.from} -> ${rel.to}`,
      };
    }

    if (!entityNames.has(rel.from)) {
      return {
        message: `Relationship references unknown entity "${rel.from}" in 'from' field`,
        relationship: `${rel.from} -> ${rel.to}`,
        entity: rel.from,
      };
    }

    // Validate to entity
    if (!rel.to || typeof rel.to !== "string") {
      return {
        message: "Relationship is missing a valid 'to' field (string)",
        relationship: `${rel.from} -> ${rel.to}`,
      };
    }

    if (!entityNames.has(rel.to)) {
      return {
        message: `Relationship references unknown entity "${rel.to}" in 'to' field`,
        relationship: `${rel.from} -> ${rel.to}`,
        entity: rel.to,
      };
    }

    // Validate relationship type
    if (!rel.type || typeof rel.type !== "string") {
      return {
        message: `Relationship from "${rel.from}" to "${rel.to}" is missing a valid 'type' field (string)`,
        relationship: `${rel.from} -> ${rel.to}`,
      };
    }

    const validTypes = ["OneToMany", "ManyToOne", "ManyToMany", "OneToOne"];
    if (!validTypes.includes(rel.type)) {
      return {
        message: `Relationship from "${rel.from}" to "${rel.to}" has invalid type "${rel.type}". Valid types are: ${validTypes.join(", ")}`,
        relationship: `${rel.from} -> ${rel.to}`,
      };
    }

    return null;
  }

  /**
   * Convert validated local schema to platform format
   */
  private convertToPlatformFormat(localSchema: LocalApsorcSchema): any {
    // The platform format is essentially the same as .apsorc format
    // We just need to ensure it's properly structured
    return {
      version: localSchema.version,
      rootFolder: localSchema.rootFolder,
      apiType: localSchema.apiType,
      entities: localSchema.entities,
      relationships: localSchema.relationships || [],
      auth: localSchema.auth,
    };
  }
}

