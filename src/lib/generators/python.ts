import * as path from "path";
import * as Eta from "eta";
import { BaseGenerator } from "./base";
import {
  TargetLanguage,
  GeneratedFile,
  ValidationResult,
  GeneratorConfig,
  EntityGenerationOptions,
  ControllerGenerationOptions,
  ServiceGenerationOptions,
  DtoGenerationOptions,
  MigrationGenerationOptions,
  Entity,
  AuthConfig,
  Field,
} from "../types";
import { getFieldForTemplate, typeExistsInEntity, fieldToEnumType } from "../utils/field";
import {
  getRelationshipForTemplate,
  getRelationshipsForImport,
} from "../utils/relationships";
import { snakeCase, camelCase } from "../utils/casing";
import pluralize from "pluralize";

/**
 * Python/FastAPI generator that produces SQLAlchemy models, Pydantic schemas,
 * and FastAPI routers.
 */
export class PythonGenerator extends BaseGenerator {
  constructor(config: GeneratorConfig) {
    super(config);
    this.templateBasePath = path.join(__dirname, "../templates/python");
    Eta.configure({
      views: this.templateBasePath,
      cache: false,
      autoTrim: false,
    });
  }

  getLanguage(): TargetLanguage {
    return "python";
  }

  getFileExtension(): string {
    return ".py";
  }

  validateConfig(config: GeneratorConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate that entities are provided
    if (!config.entities || config.entities.length === 0) {
      errors.push("No entities defined in configuration");
    }

    // Validate each entity
    for (const entity of config.entities) {
      if (!entity.name) {
        errors.push("Entity missing required 'name' property");
      }

      // Validate field types
      for (const field of entity.fields ?? []) {
        if (!field.name) {
          errors.push(`Entity '${entity.name}' has a field without a name`);
        }
        if (!field.type) {
          errors.push(
            `Entity '${entity.name}' field '${field.name}' missing type`
          );
        }

        // Check for unsupported types
        const supportedTypes = [
          "text",
          "varchar",
          "string",
          "integer",
          "boolean",
          "float",
          "decimal",
          "numeric",
          "date",
          "datetime",
          "timestamp",
          "timestamptz",
          "json",
          "jsonb",
          "uuid",
          "enum",
          "array",
        ];
        if (field.type && !supportedTypes.includes(field.type)) {
          warnings.push(
            `Entity '${entity.name}' field '${field.name}' has type '${field.type}' which may not be fully supported`
          );
        }
      }
    }

    // Python-specific validation
    if (config.apiType === "graphql") {
      warnings.push(
        "GraphQL support for Python is limited. REST API is recommended."
      );
    }

    return this.createValidationResult(errors, warnings);
  }

  async generateEntity(
    options: EntityGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, relationships, allEntities, apiType } = options;
    const { name, fields = [], indexes, uniques } = entity;

    const columns = getFieldForTemplate(fields, name);
    const createPrimaryKey =
      columns.filter((column: Field) => column.primary === true).length === 0;

    const createdAt = entity.created_at;
    const updatedAt = entity.updated_at;
    const primaryKeyType = entity.primaryKeyType || "serial";

    const relationshipsForTemplate = getRelationshipForTemplate(
      name,
      relationships,
      allEntities
    );
    const entitiesToImport = getRelationshipsForImport(
      name,
      relationshipsForTemplate
    );

    const data = {
      name,
      indexes: indexes || [],
      uniques: uniques || [],
      createPrimaryKey,
      primaryKeyType,
      snakeCasedName: snakeCase(name),
      createdAt,
      updatedAt,
      pluralizedName: camelCase(pluralize(name)),
      columns,
      associations: [...new Set(relationshipsForTemplate)],
      entitiesToImport,
      importEnums: typeExistsInEntity(entity, "enum") !== -1,
      apiType,
    };

    const content = await this.renderTemplate("./models/model", data);

    return [
      {
        path: `models/${name.toLowerCase()}.py`,
        content,
      },
    ];
  }

  async generateController(
    options: ControllerGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, relationships } = options;
    const { name: entityName } = entity;

    const relationshipsForTemplate = getRelationshipForTemplate(
      entityName,
      relationships
    );

    const pluralEntityName = pluralize(entityName);
    const primaryKeyType = entity.primaryKeyType || "serial";

    const data = {
      entityName,
      pluralEntityName,
      primaryKeyType,
      associations: [...new Set(relationshipsForTemplate)],
    };

    const content = await this.renderTemplate("./routers/router", data);

    return [
      {
        path: `routers/${entityName.toLowerCase()}.py`,
        content,
      },
    ];
  }

  async generateService(
    options: ServiceGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, relationships } = options;
    const { name: entityName } = entity;

    const relationshipsForTemplate = getRelationshipForTemplate(
      entityName,
      relationships
    );

    const pluralEntityName = pluralize(entityName);
    const primaryKeyType = entity.primaryKeyType || "serial";

    const data = {
      entityName,
      pluralEntityName,
      primaryKeyType,
      associations: [...new Set(relationshipsForTemplate)],
    };

    const content = await this.renderTemplate("./services/service", data);

    return [
      {
        path: `services/${entityName.toLowerCase()}.py`,
        content,
      },
    ];
  }

  async generateDto(options: DtoGenerationOptions): Promise<GeneratedFile[]> {
    const { entity, relationships, allEntities, apiType } = options;
    const { name: entityName, fields = [] } = entity;

    const columns = getFieldForTemplate(fields, entityName);
    const relationshipsTemplate = getRelationshipForTemplate(
      entityName,
      relationships
    );

    // Add foreign key columns for ManyToOne relationships
    relationshipsTemplate.forEach((rel) => {
      if (rel.type === "ManyToOne") {
        const fkName = camelCase(rel.referenceName || rel.name) + "Id";
        const referencedEntity = allEntities?.find((e) => e.name === rel.name);
        const referencedPrimaryKeyType =
          referencedEntity?.primaryKeyType || "serial";
        const fkDataType =
          referencedPrimaryKeyType === "uuid" ? "string" : "number";
        const fkType = referencedPrimaryKeyType === "uuid" ? "text" : "integer";

        if (!columns.some((col) => col.name === fkName)) {
          columns.push({
            name: fkName,
            dataType: fkDataType,
            type: fkType,
          });
        }
      }
    });

    const primaryKeyColumns = columns.filter(
      (column: any) => column.primary === true
    );
    const addDefaultPKProperty = primaryKeyColumns.length === 0;

    const createdAt = entity.created_at;
    const updatedAt = entity.updated_at;
    const primaryKeyType = entity.primaryKeyType || "serial";

    const data = {
      entityName,
      addDefaultPKProperty,
      primaryKeyType,
      createdAt,
      updatedAt,
      columns,
      associations: relationshipsTemplate,
      apiType: apiType ?? "rest",
      importEnums: typeExistsInEntity(entity, "enum") !== -1,
    };

    const content = await this.renderTemplate("./schemas/schema", data);

    return [
      {
        path: `schemas/${entityName.toLowerCase()}.py`,
        content,
      },
    ];
  }

  async generateModule(
    _options: EntityGenerationOptions
  ): Promise<GeneratedFile[]> {
    // Python doesn't have a module concept like NestJS
    // The router registration is handled in the index module
    return [];
  }

  async generateMigration(
    _options: MigrationGenerationOptions
  ): Promise<GeneratedFile[]> {
    // Alembic handles migrations differently
    // This is a placeholder for future migration template generation
    return [];
  }

  async generateEnums(
    entities: Entity[],
    _apiType: string
  ): Promise<GeneratedFile[]> {
    if (entities.length === 0) {
      return [];
    }

    const allEnumsFields = entities
      .flatMap((entity) =>
        (entity.fields || []).map((field: Field) => {
          if (field.type === "enum") {
            return { ...field, name: fieldToEnumType(field.name, entity.name) };
          }
          return null;
        })
      )
      .filter(Boolean);

    if (allEnumsFields.length === 0) {
      return [];
    }

    const content = await this.renderTemplate("./enums", {
      allEnumsFields,
    });

    return [
      {
        path: "models/enums.py",
        content,
      },
    ];
  }

  async generateIndexModule(
    entities: Entity[],
    _apiType: string
  ): Promise<GeneratedFile[]> {
    const content = await this.renderTemplate("./index-module", { entities });

    return [
      {
        path: "__init__.py",
        content,
      },
    ];
  }

  async generateGuards(
    _entities: Entity[],
    _auth?: AuthConfig
  ): Promise<GeneratedFile[]> {
    // Python auth/guards would be implemented differently (e.g., FastAPI dependencies)
    // This is a placeholder for future implementation
    return [];
  }
}
