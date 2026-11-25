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
  RelationshipMap,
} from "../types";
import {
  TimestampColumn,
  timestampNullableOf,
  timestampTypeOf,
} from "../types/entity";

// The options of @CreateDateColumn / @UpdateDateColumn: empty for the default
// (timestamp, NOT NULL), so entities generated before these settings are unchanged.
const timestampArgs = (entity: Entity, column: TimestampColumn): string => {
  const args = [
    ...(timestampTypeOf(entity, column) === "timestamptz"
      ? ["type: 'timestamptz'"]
      : []),
    ...(timestampNullableOf(entity, column) ? ["nullable: true"] : []),
  ];
  return args.length > 0 ? `{ ${args.join(", ")} }` : "";
};
import { onDeleteOf } from "../types/relationship";
import {
  extraForeignKeys,
  keyColumn,
  schemaModel,
  sqlIndexStatements,
} from "../ddl";
// Utilities available for future use: createFile from "../utils/file-system"
import {
  getFieldForTemplate,
  typeExistsInEntity,
  fieldToEnumType,
  isUuidGenerator,
  typeormDefault,
} from "../utils/field";
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
  authEntityNames,
  authEntityRoutes,
  getPermissionConfig,
  getScopedEntities,
  hasPermissions,
  hasScopedEntities,
  relationScopes,
  removedScopeOptionErrors,
  toRouteName,
  mcpOperations,
} from "../guards";
import { getEventEmittingEntities } from "../events";
import {
  authProviders,
  resolveJwtProviders,
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
    errors.push(...removedScopeOptionErrors(config.entities ?? []));

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

    // "foreignKeys" entries are checked by the writer `apso migrate` uses.
    if ((config.entities ?? []).some((e) => e.foreignKeys?.length))
      try {
        schemaModel({
          entities: config.entities,
          relationshipMap: config.relationshipMap ?? {},
        });
      } catch (error) {
        errors.push((error as Error).message);
      }

    // Validate API type
    if (config.apiType && !["rest", "graphql"].includes(config.apiType)) {
      errors.push(
        `Invalid API type: '${config.apiType}'. Must be 'rest' or 'graphql'`
      );
    }

    // The GraphQL templates are incomplete, and no access guard runs on
    // GraphQL resolvers, so a GraphQL service would answer without credentials.
    if (config.apiType === "graphql") {
      errors.push(
        'apiType "Graphql" cannot be generated for TypeScript: the built-in API key and sign-in checks cover REST routes only, so a GraphQL service would answer requests with no credentials. Set "apiType": "Rest" in .apsorc.'
      );
    }

    return this.createValidationResult(errors, warnings);
  }

  async generateEntity(
    options: EntityGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, relationships, allEntities, apiType } = options;
    const { name, fields = [], indexes, uniques } = entity;

    const columns = getFieldForTemplate(fields, name).map((c) =>
      c.defaultSql === undefined
        ? c
        : { ...c, defaultSql: typeormDefault(c.defaultSql) }
    );
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
    // No generated id when a field, or a foreign key, is the primary key.
    const createPrimaryKey =
      !columns.some((column: Field) => column.primary === true) &&
      !relationshipsForTemplate.some((r) => r.primary);

    // A OneToOne's FK column has no property of its own on the entity, so
    // @Index/@Unique name the relation property; TypeORM resolves it to the
    // join column (workspaceId -> workspace).
    const oneToOneColumns = new Map(
      relationshipsForTemplate
        .filter((r) => r.type === "OneToOne" && r.joinTable)
        .flatMap((r) =>
          [r.camelCasedId, r.joinColumnName]
            .filter(Boolean)
            .map((column) => [column as string, r.relationshipName])
        )
    );
    // A ManyToOne's "joinColumnName" is a database name; @Index and @Unique
    // take the property that maps to it (patient_id -> patientId).
    const joinColumns = new Map(
      relationshipsForTemplate
        .filter((r) => r.type === "ManyToOne" && r.joinColumnName)
        .map((r) => [r.joinColumnName as string, r.camelCasedId])
    );
    const fieldNames = new Set(columns.map((c: Field) => c.name));
    const toProperties = <T extends { fields: string[] }>(list: T[] = []) =>
      list.map((c) => ({
        ...c,
        fields: c.fields.map((f) =>
          fieldNames.has(f) ? f : oneToOneColumns.get(f) ?? joinColumns.get(f) ?? f
        ),
      }));

    const foreignKeys = extraForeignKeys(
      entity,
      new Map(allEntities.map((e) => [e.name, e]))
    );

    const data = {
      name,
      foreignKeys,
      indexes: toProperties(indexes),
      uniques: toProperties(uniques),
      checks: entity.checks ?? [],
      sqlIndexes: entity.sqlIndexes ?? [],
      createPrimaryKey,
      primaryKeyType,
      primaryKeyName: entity.primaryKeyName,
      primaryKeyDefault: entity.primaryKeyDefault,
      primaryKeyGenerated: isUuidGenerator(entity.primaryKeyDefault),
      snakeCasedName: snakeCase(name),
      // Honor an explicit per-entity `table` override; otherwise derive from
      // the entity name. See apsoai/cli#98.
      tableName: entity.table || snakeCase(name),
      createdAt,
      updatedAt,
      createdAtArgs: timestampArgs(entity, "created_at"),
      updatedAtArgs: timestampArgs(entity, "updated_at"),
      pluralizedName: camelCase(pluralize(name)),
      // Every column of a named primary key carries the name (TypeORM requires it).
      columns: columns.map((c: Field) =>
        c.primary && entity.primaryKeyName
          ? { ...c, primaryKeyName: entity.primaryKeyName }
          : c
      ),
      associations: [...new Set(relationshipsForTemplate)].map((r) => {
        // A foreign key column copies the type of the key it references.
        const key = keyColumn(allEntities.find((e) => e.name === r.name));
        return {
          ...r,
          onDeleteRule: onDeleteOf(r),
          fkColumnOptions: key.options,
          fkTsType: key.ts,
        };
      }),
      entitiesToImport: [
        ...new Set([...entitiesToImport, ...foreignKeys.map((k) => k.target)]),
      ].filter((other) => other !== name),
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
    const { entity, relationships, relationshipMap, auth } = options;
    const { name: entityName } = entity;

    // Auth entities are for service callers only, so no other entity's
    // controller joins onto them.
    const authEntities = new Set(authEntityNames(options.allEntities, auth));
    const joinable = (r: { name: string }) =>
      authEntities.has(entityName) || !authEntities.has(r.name);
    const relationshipsForTemplate = getRelationshipForTemplate(
      entityName,
      relationships?.filter((r) => joinable(r))
    );
    const joinMap: RelationshipMap = Object.fromEntries(
      Object.entries(relationshipMap ?? {}).map(([name, list]) => [
        name,
        list.filter((r) => joinable(r)),
      ])
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
    await streamNestedRelationships(entityName, joinMap, nestedJoinsStream);
    nestedJoinsStream.end();
    await new Promise<void>((resolve) => {
      nestedJoinsStream.on("finish", () => resolve());
    });

    const svcName = `${entityName}Service`;
    const ctrlName = `${entityName}Controller`;
    const pluralEntityName = pluralize(entityName);
    const primaryKeyType = entity.primaryKeyType || "serial";
    const scoped = auth
      ? getScopedEntities([entity], relationshipMap)[0]
      : undefined;
    const scopes = scoped?.scopes ?? [];
    // Which requests the tenant filter covers; a service caller (API key)
    // always skips it.
    const scopeOptions = scoped && {
      bypassRoles: scoped.bypassRoles,
    };

    const mcp = mcpOperations(entity);

    // The :id route parameter maps to the entity's own key: a primary field,
    // or the id property of a foreign key that is the primary key. A
    // composite key has no single field, so it keeps the default.
    const keyFields = [
      ...(entity.fields ?? []).filter((f) => f.primary).map((f) => f.name),
      ...relationshipsForTemplate
        .filter((r) => r.primary)
        .map((r) => r.camelCasedId),
    ];
    const data = {
      svcName,
      ctrlName,
      entityName,
      pluralEntityName,
      primaryKeyType,
      generatedFields: (entity.fields ?? [])
        .filter((f) => f.generated)
        .map((f) => f.name),
      keyField: keyFields.length === 1 ? keyFields[0] : "id",
      associations: [...new Set(relationshipsForTemplate)],
      nestedJoinsFile,
      // scopeBy fields @CrudAuth adds to every query once a caller is
      // authenticated. Direct fields match the caller's tenant; nested paths
      // (task.workspaceId) match the foreign key (taskId) against the parent
      // ids ScopeGuard loaded for the caller into req.apsoScope.
      crudAuth: scopes.filter((s) => s.direct),
      crudAuthNested: scopes.filter((s) => s.fkField),
      scopeOptions,
      // Every controller checks which relations a request may load.
      relationAccess: this.hasRelationAccess(options.allEntities, relationshipMap, auth),
      // Operations exposed as MCP tools, and the names the tools get.
      mcp,
      mcpName: snakeCase(entityName),
      mcpPluralName: snakeCase(pluralEntityName),
      dialects: options.query?.dialects ?? ["postgrest"],
      dialectList: (options.query?.dialects ?? ["postgrest"]).map((d) => `'${d}'`).join(", "),
      limit: options.query?.limit ?? 25,
      alwaysPaginate: options.query?.alwaysPaginate ?? false,
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
        const fkDataType = keyColumn(referencedEntity).ts;
        const fkType = fkDataType === "string" ? "text" : "integer";

        if (!columns.some((col) => col.name === fkName)) {
          columns.push({
            name: fkName,
            dataType: fkDataType,
            type: fkType,
            ...(rel.primary && { primary: true }),
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
    const { entity, apiType, includeController = true } = options;
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
      includeController,
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
    apiType: string,
    opts?: { emitEvents?: boolean; auth?: AuthConfig; guards?: boolean }
  ): Promise<GeneratedFile[]> {
    // Listing GuardsModule is what turns the global guards on; every service
    // has at least the API key check. `.apsorc` "guards": false leaves it out.
    // "sqlIndexes" are created by a generated module, after TypeORM's sync.
    const statements = entities.flatMap((e) => sqlIndexStatements(e));
    const schemaExtras = apiType === "rest" && statements.length > 0;
    const content = await this.renderTemplate(
      `./${apiType}/index-module-${apiType}`,
      { entities, schemaExtras, guards: opts?.guards !== false }
    );

    return [
      {
        path: "index.ts",
        content,
      },
      ...(schemaExtras
        ? [
            {
              path: "schema-extras.module.ts",
              content: await this.renderTemplate(
                "./rest/schema-extras-module",
                { statements }
              ),
            },
          ]
        : []),
    ];
  }

  async generateGuards(
    entities: Entity[],
    auth?: AuthConfig,
    relationshipMap?: RelationshipMap
  ): Promise<GeneratedFile[]> {
    const hasScopes = hasScopedEntities(entities);
    // One entry per trusted issuer; undefined when there is no sign-in.
    const jwtProviders = resolveJwtProviders(auth);
    const jwt = jwtProviders.length > 0 ? jwtProviders : undefined;
    const hasAuth = Boolean(jwt);

    // Roles come from the caller's identity; without auth there are none, and
    // a permissions block that is silently not enforced is worse than an error.
    const permissions = getPermissionConfig(entities, relationshipMap, auth);
    if (permissions && !hasAuth) {
      throw new Error(
        "permissions in .apsorc need an auth block: roles come from the signed-in caller"
      );
    }

    const scopedEntities = getScopedEntities(entities, relationshipMap);
    const files: GeneratedFile[] = [];
    const mcp = entities.some((e) => mcpOperations(e).length > 0);

    const templateData = {
      scopedEntities,
      // Every entity by route: the scope guard checks relations in write bodies.
      routeEntities: entities.map((e) => ({ route: toRouteName(e.name), name: e.name })),
      // Nested paths are only enforced on list and create with a caller's tenant.
      hasNestedFk:
        hasAuth && scopedEntities.some((e) => e.scopes.some((s) => s.fkField)),
      hasAuth,
      authProvider: authProviders(auth).map((a) => a.provider).join(", "),
      // Routes only a service caller reaches (sessions, accounts, ...).
      authRoutes: authEntityRoutes(entities, auth),
      jwt,
      permissions,
      // MCP tools are served at /mcp/internal for service callers, and at /mcp
      // for signed-in users when there is sign-in: tokens come from the listed issuers.
      mcp,
      mcpAuth: hasAuth && mcp,
    };

    // The API key check is part of every service.
    files.push({
      path: "guards/key.guard.ts",
      content: await this.renderTemplate("./guards/key.guard.eta", templateData),
    });

    // Generate auth.guard.ts if auth is configured
    if (hasAuth) {
      const authGuardContent = await this.renderTemplate(
        "./guards/jwt-auth.guard.eta",
        templateData
      );
      files.push({
        path: "guards/auth.guard.ts",
        content: authGuardContent,
      });
    }

    if (this.hasRelationAccess(entities, relationshipMap, auth)) {
      files.push({
        path: "guards/relations.interceptor.ts",
        content: await this.renderTemplate("./guards/relations.interceptor.eta", {
          permissions: Boolean(permissions),
          relationScopes: relationScopes(entities, relationshipMap, hasAuth),
        }),
      });
    }

    if (permissions) {
      files.push({
        path: "guards/permission.guard.ts",
        content: await this.renderTemplate(
          "./guards/permission.guard.eta",
          templateData
        ),
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
   * Emits a schema-derived manifest of the entities that have opted in to
   * domain-event emission (`.apsorc` `emitEvents`).
   *
   * Under the Apso Distribution Model the domain-event engine no longer ships
   * as generated code; it lives in the `@apso/domain-events` library and is
   * wired by the `domain-events` skill. The CLI's only responsibility is to
   * declare WHICH entities participate, via a single generated file:
   * `events/event-emitting.entities.ts`.
   *
   * Returns an empty array when no entity is opted in, so callers can skip
   * wiring entirely.
   *
   * @param entities All entities from the configuration
   * @param _apiType API type (unused; events are REST/Graphql agnostic)
   * @param opts.emitEvents Top-level (global) default for emitEvents
   */
  async generateDomainEvents(
    entities: Entity[],
    _apiType?: string,
    opts?: { emitEvents?: boolean }
  ): Promise<GeneratedFile[]> {
    const emittingEntities = getEventEmittingEntities(
      entities,
      opts?.emitEvents
    );

    if (emittingEntities.length === 0) {
      return [];
    }

    const content = await this.renderTemplate(
      "./events/event-emitting.entities.eta",
      {
        emittingEntities: emittingEntities.map((entity) => ({
          name: entity.name,
        })),
      }
    );

    return [
      {
        path: "events/event-emitting.entities.ts",
        content,
      },
    ];
  }

  /** True when requests can load a relation that is tenant-scoped or limited by role. */
  private hasRelationAccess(
    entities: Entity[],
    relationshipMap?: RelationshipMap,
    auth?: AuthConfig
  ): boolean {
    return Boolean(
      auth &&
        (hasPermissions(entities) || relationScopes(entities, relationshipMap, true))
    );
  }
}
