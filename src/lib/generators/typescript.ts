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
// Utilities available for future use: createFile, withGeneratedMeta from "../utils/file-system"
import { getFieldForTemplate, typeExistsInEntity, fieldToEnumType } from "../utils/field";
import {
  getRelationshipForTemplate,
  getRelationshipsForImport,
} from "../utils/relationships";
import { streamNestedRelationships } from "../utils/relationships/parse";
import { snakeCase, camelCase, pascalCase } from "../utils/casing";
import pluralize from "pluralize";
import * as fs from "fs";
import * as os from "os";
import { promisify } from "util";
import {
  getScopedEntities,
  hasScopedEntities,
} from "../guards";
import {
  isDbSessionAuth,
  DB_SESSION_AUTH_DEFAULTS,
  DbSessionAuthConfig,
} from "../types/auth";

const unlinkAsync = promisify(fs.unlink);

/**
 * TypeScript/NestJS generator that wraps the existing generation functions.
 * This generator produces TypeORM entities, NestJS controllers, services, and DTOs.
 */
export class TypeScriptGenerator extends BaseGenerator {
  constructor(config: GeneratorConfig) {
    super(config);
    // Override template path for TypeScript - use root templates directory
    // since TypeScript templates are the existing ones in entities/, rest/, graphql/
    this.templateBasePath = path.join(__dirname, "../templates");
    Eta.configure({
      views: this.templateBasePath,
      cache: false,
    });
  }

  getLanguage(): TargetLanguage {
    return "typescript";
  }

  getFileExtension(): string {
    return ".ts";
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
      }
    }

    // Validate API type
    if (config.apiType && !["rest", "graphql"].includes(config.apiType)) {
      errors.push(
        `Invalid API type: '${config.apiType}'. Must be 'rest' or 'graphql'`
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

    const templatePath =
      apiType === "graphql"
        ? "./graphql/gql-entity-graphql"
        : "./entities/entity";

    const content = await this.renderTemplate(templatePath, data);

    return [
      {
        path: `${name}/${name}.entity.ts`,
        content,
      },
    ];
  }

  async generateController(
    options: ControllerGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, relationships, relationshipMap } = options;
    const { name: entityName } = entity;

    const relationshipsForTemplate = getRelationshipForTemplate(
      entityName,
      relationships
    );

    // Handle nested relationships for joins
    const tmpDir = os.tmpdir();
    const nestedJoinsFile = path.join(
      tmpDir,
      `apso-nested-joins-${entityName}-${Date.now()}.eta`
    );
    const nestedJoinsStream = fs.createWriteStream(nestedJoinsFile, {
      encoding: "utf8",
    });
    await streamNestedRelationships(
      entityName,
      relationshipMap,
      nestedJoinsStream
    );
    nestedJoinsStream.end();
    await new Promise((resolve) => {
      nestedJoinsStream.on("finish", resolve);
    });

    const svcName = `${entityName}Service`;
    const ctrlName = `${entityName}Controller`;
    const pluralEntityName = pluralize(entityName);
    const primaryKeyType = entity.primaryKeyType || "serial";

    const data = {
      svcName,
      ctrlName,
      entityName,
      pluralEntityName,
      primaryKeyType,
      associations: [...new Set(relationshipsForTemplate)],
      nestedJoinsFile,
    };

    const controllerContent = await this.renderTemplate(
      "./rest/controller-rest",
      data
    );
    const specContent = await this.renderTemplate(
      "./rest/controller-rest-spec",
      data
    );

    // Clean up temp file
    try {
      await unlinkAsync(nestedJoinsFile);
    } catch {
      // Ignore cleanup errors
    }

    return [
      {
        path: `${entityName}/${entityName}.controller.ts`,
        content: controllerContent,
      },
      {
        path: `${entityName}/${entityName}.controller.spec.ts`,
        content: specContent,
      },
    ];
  }

  async generateService(
    options: ServiceGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, relationshipMap } = options;
    const { name: entityName } = entity;

    const svcName = `${entityName}Service`;
    const repoName = `${entityName}Repository`;

    // Collect all related entities for the test file
    let allRelatedEntities: string[] = [entityName];
    if (relationshipMap && relationshipMap[entityName]) {
      const visited = new Set<string>();
      const collect = (entName: string) => {
        if (visited.has(entName)) return;
        visited.add(entName);
        allRelatedEntities.push(entName);
        const rels = relationshipMap[entName] || [];
        for (const rel of rels) {
          if (!visited.has(rel.name)) {
            collect(rel.name);
          }
        }
      };
      allRelatedEntities = [];
      collect(entityName);
      allRelatedEntities = [...new Set(allRelatedEntities)];
    }

    const data = {
      svcName,
      repoName,
      entityName,
      allRelatedEntities,
    };

    const serviceContent = await this.renderTemplate(
      "./rest/service-rest",
      data
    );
    const specContent = await this.renderTemplate(
      "./rest/service-rest-spec",
      data
    );

    return [
      {
        path: `${entityName}/${entityName}.service.ts`,
        content: serviceContent,
      },
      {
        path: `${entityName}/${entityName}.service.spec.ts`,
        content: specContent,
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

    const dtoColumns = columns.filter(
      (col: any) => !["id", "createdAt", "updatedAt"].includes(col.name)
    );

    const createDtoName = `Create${pascalCase(entityName)}Dto`;
    const updateDtoName = `Update${pascalCase(entityName)}Dto`;

    const data = {
      entityName,
      addDefaultPKProperty,
      primaryKeyType,
      createdAt,
      updatedAt,
      columns: dtoColumns,
      associations: relationshipsTemplate,
      createDtoName,
      updateDtoName,
      apiType: apiType ?? "rest",
      importEnums: typeExistsInEntity(entity, "enum") !== -1,
    };

    const dtoContent = await this.renderTemplate("./rest/dto-rest", data);

    return [
      {
        path: `${entityName}/dtos/${entityName}.dto.ts`,
        content: dtoContent,
      },
    ];
  }

  async generateModule(
    options: EntityGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, apiType } = options;
    const { name: entityName } = entity;

    const moduleName = `${entityName}Module`;
    const svcName = `${entityName}Service`;
    const ctrlName = `${entityName}Controller`;
    const resolverName = `${entityName}Resolver`;

    const data = {
      moduleName,
      svcName,
      ctrlName,
      resolverName,
      entityName,
    };

    const templatePath =
      apiType === "graphql"
        ? "./graphql/gql-module-graphql"
        : "./rest/module-rest";

    const content = await this.renderTemplate(templatePath, data);

    return [
      {
        path: `${entityName}/${entityName}.module.ts`,
        content,
      },
    ];
  }

  async generateMigration(
    _options: MigrationGenerationOptions
  ): Promise<GeneratedFile[]> {
    // TypeORM handles migrations differently - typically via CLI
    // This is a placeholder for future migration template generation
    return [];
  }

  async generateEnums(
    entities: Entity[],
    apiType: string
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

    const content = await this.renderTemplate(`./${apiType}/enums-${apiType}`, {
      allEnumsFields,
    });

    return [
      {
        path: "enums.ts",
        content,
      },
    ];
  }

  async generateIndexModule(
    entities: Entity[],
    apiType: string
  ): Promise<GeneratedFile[]> {
    const content = await this.renderTemplate(
      `./${apiType}/index-module-${apiType}`,
      { entities }
    );

    return [
      {
        path: "index.ts",
        content,
      },
    ];
  }

  async generateGuards(
    entities: Entity[],
    auth?: AuthConfig
  ): Promise<GeneratedFile[]> {
    const hasScopes = hasScopedEntities(entities);
    const normalizedAuth = this.normalizeAuthConfig(auth);

    if (!hasScopes && !normalizedAuth) {
      return [];
    }

    const scopedEntities = getScopedEntities(entities);
    const files: GeneratedFile[] = [];

    const templateData = {
      scopedEntities,
      authConfig: normalizedAuth,
      generatedAt: new Date().toISOString(),
      generatedBy: "Apso CLI",
    };

    // Generate auth.guard.ts if auth is configured
    if (normalizedAuth) {
      const authGuardContent = await this.renderTemplate(
        "./guards/auth.guard.eta",
        templateData
      );
      files.push({
        path: "guards/auth.guard.ts",
        content: authGuardContent,
      });
    }

    // Generate scope.guard.ts if there are scoped entities
    if (hasScopes) {
      const scopeGuardContent = await this.renderTemplate(
        "./guards/scope.guard.eta",
        templateData
      );
      files.push({
        path: "guards/scope.guard.ts",
        content: scopeGuardContent,
      });
    }

    // Generate guards.module.ts
    const guardsModuleContent = await this.renderTemplate(
      "./guards/guards.module.eta",
      templateData
    );
    files.push({
      path: "guards/guards.module.ts",
      content: guardsModuleContent,
    });

    // Generate index.ts
    const indexContent = await this.renderTemplate(
      "./guards/index.eta",
      templateData
    );
    files.push({
      path: "guards/index.ts",
      content: indexContent,
    });

    return files;
  }

  /**
   * Normalizes auth config by applying defaults for DB session providers
   */
  private normalizeAuthConfig(
    auth: AuthConfig | undefined
  ): DbSessionAuthConfig | undefined {
    if (!auth) return undefined;

    if (isDbSessionAuth(auth)) {
      return {
        ...DB_SESSION_AUTH_DEFAULTS,
        ...auth,
      };
    }

    return undefined;
  }
}
