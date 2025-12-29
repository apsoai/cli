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
import { snakeCase, camelCase, pascalCase, kebabCase } from "../utils/casing";
import pluralize from "pluralize";

/**
 * Go/Gin generator that produces GORM models, DTOs, Gin handlers,
 * and service layer code.
 */
export class GoGenerator extends BaseGenerator {
  constructor(config: GeneratorConfig) {
    super(config);
    this.templateBasePath = path.join(__dirname, "../templates/go");
    Eta.configure({
      views: this.templateBasePath,
      cache: false,
    });
  }

  getLanguage(): TargetLanguage {
    return "go";
  }

  getFileExtension(): string {
    return ".go";
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

    // Go-specific validation
    if (config.apiType === "graphql") {
      warnings.push(
        "GraphQL support for Go is limited. REST API with Swagger is recommended."
      );
    }

    return this.createValidationResult(errors, warnings);
  }

  /**
   * Maps .apsorc field types to Go types
   */
  private mapFieldToGoType(field: Field): string {
    const typeMap: Record<string, string> = {
      text: "string",
      varchar: "string",
      string: "string",
      integer: "int",
      boolean: "bool",
      float: "float64",
      decimal: "float64",
      numeric: "float64",
      date: "time.Time",
      timestamp: "time.Time",
      timestamptz: "time.Time",
      json: "map[string]interface{}",
      jsonb: "map[string]interface{}",
      uuid: "string",
      enum: "string",
      array: "[]string",
    };

    return typeMap[field.type || "string"] || "string";
  }

  /**
   * Gets the Go type for primary keys
   */
  private getPrimaryKeyGoType(primaryKeyType: string): string {
    return primaryKeyType === "uuid" ? "string" : "uint";
  }

  /**
   * Gets the Swagger type for primary keys
   */
  private getPrimaryKeySwaggerType(primaryKeyType: string): string {
    return primaryKeyType === "uuid" ? "string" : "integer";
  }

  /**
   * Transforms fields for Go templates with additional Go-specific properties
   */
  private getGoFieldsForTemplate(fields: Field[], entityName: string): any[] {
    const baseFields = getFieldForTemplate(fields, entityName);
    return baseFields.map((field: any) => ({
      ...field,
      goType: this.mapFieldToGoType(field),
      pascalName: pascalCase(field.name),
      snakeName: snakeCase(field.name),
    }));
  }

  async generateEntity(
    options: EntityGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, relationships, allEntities, apiType } = options;
    const { name, fields = [], indexes, uniques } = entity;

    const columns = this.getGoFieldsForTemplate(fields, name);
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

    // Add Go-specific properties to relationships
    const goRelationships = relationshipsForTemplate.map((rel) => ({
      ...rel,
      primaryKeyGoType: this.getPrimaryKeyGoType(primaryKeyType),
      camelReferenceName: camelCase(rel.referenceName || rel.name),
      snakeReferenceName: snakeCase(rel.referenceName || rel.name),
    }));

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
      pluralName: pascalCase(pluralize(name)),
      columns,
      associations: [...new Set(goRelationships)],
      entitiesToImport,
      importEnums: typeExistsInEntity(entity, "enum") !== -1,
      apiType,
    };

    const content = await this.renderTemplate("./models/model", data);

    return [
      {
        path: `models/${snakeCase(name)}.go`,
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
      pluralName: pascalCase(pluralEntityName),
      kebabPluralName: kebabCase(pluralEntityName),
      primaryKeyType,
      primaryKeyGoType: this.getPrimaryKeyGoType(primaryKeyType),
      primaryKeySwaggerType: this.getPrimaryKeySwaggerType(primaryKeyType),
      associations: [...new Set(relationshipsForTemplate)],
    };

    const content = await this.renderTemplate("./handlers/handler", data);

    return [
      {
        path: `handlers/${snakeCase(entityName)}.go`,
        content,
      },
    ];
  }

  async generateService(
    options: ServiceGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, relationships, allEntities } = options;
    const { name: entityName, fields = [] } = entity;

    const columns = this.getGoFieldsForTemplate(fields, entityName);
    const relationshipsForTemplate = getRelationshipForTemplate(
      entityName,
      relationships,
      allEntities
    );

    // Add Go-specific properties to relationships
    const goRelationships = relationshipsForTemplate.map((rel) => {
      const referencedEntity = allEntities?.find((e) => e.name === rel.name);
      const referencedPrimaryKeyType = referencedEntity?.primaryKeyType || "serial";
      return {
        ...rel,
        primaryKeyGoType: this.getPrimaryKeyGoType(referencedPrimaryKeyType),
        snakeReferenceName: snakeCase(rel.referenceName || rel.name),
      };
    });

    const pluralEntityName = pluralize(entityName);
    const primaryKeyType = entity.primaryKeyType || "serial";
    const createdAt = entity.created_at;
    const updatedAt = entity.updated_at;

    const data = {
      entityName,
      pluralName: pascalCase(pluralEntityName),
      primaryKeyType,
      createdAt,
      updatedAt,
      columns,
      associations: [...new Set(goRelationships)],
    };

    const content = await this.renderTemplate("./services/service", data);

    return [
      {
        path: `services/${snakeCase(entityName)}.go`,
        content,
      },
    ];
  }

  async generateDto(options: DtoGenerationOptions): Promise<GeneratedFile[]> {
    const { entity, relationships, allEntities, apiType } = options;
    const { name: entityName, fields = [] } = entity;

    const columns = this.getGoFieldsForTemplate(fields, entityName);
    const relationshipsTemplate = getRelationshipForTemplate(
      entityName,
      relationships,
      allEntities
    );

    // Add Go-specific properties to relationships
    const goRelationships = relationshipsTemplate.map((rel) => {
      const referencedEntity = allEntities?.find((e) => e.name === rel.name);
      const referencedPrimaryKeyType = referencedEntity?.primaryKeyType || "serial";
      return {
        ...rel,
        primaryKeyGoType: this.getPrimaryKeyGoType(referencedPrimaryKeyType),
        camelReferenceName: camelCase(rel.referenceName || rel.name),
      };
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
      associations: goRelationships,
      apiType: apiType ?? "rest",
      importEnums: typeExistsInEntity(entity, "enum") !== -1,
    };

    const content = await this.renderTemplate("./dto/dto", data);

    return [
      {
        path: `dto/${snakeCase(entityName)}.go`,
        content,
      },
    ];
  }

  async generateModule(
    _options: EntityGenerationOptions
  ): Promise<GeneratedFile[]> {
    // Go doesn't have a module concept like NestJS
    // Route registration is handled in the index module
    return [];
  }

  async generateMigration(
    _options: MigrationGenerationOptions
  ): Promise<GeneratedFile[]> {
    // Goose handles migrations differently
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
            return {
              ...field,
              name: fieldToEnumType(field.name, entity.name),
              values: (field.values || []).map((value: string) => ({
                value,
                pascalCase: pascalCase(value),
              })),
            };
          }
          return null;
        })
      )
      .filter(Boolean);

    if (allEnumsFields.length === 0) {
      return [];
    }

    const content = await this.renderTemplate("./enums", {
      enums: allEnumsFields,
    });

    return [
      {
        path: "models/enums/enums.go",
        content,
      },
    ];
  }

  async generateIndexModule(
    entities: Entity[],
    _apiType: string
  ): Promise<GeneratedFile[]> {
    const entitiesData = entities.map((entity) => ({
      name: entity.name,
      camelName: camelCase(entity.name),
      kebabName: kebabCase(entity.name),
    }));

    const content = await this.renderTemplate("./index-module", {
      entities: entitiesData,
    });

    return [
      {
        path: "routes/routes.go",
        content,
      },
    ];
  }

  async generateGuards(
    _entities: Entity[],
    auth?: AuthConfig
  ): Promise<GeneratedFile[]> {
    const content = await this.renderTemplate("./middleware/auth", {
      auth,
    });

    return [
      {
        path: "middleware/auth.go",
        content,
      },
    ];
  }
}
