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
  resolveJwtProviders,
} from "../types";
import {
  authEntityNames,
  hidesRelation,
  entityScope,
  hasPermissions,
  nestedScopeEntities,
} from "../guards";
import {
  arrayElementType,
  getFieldForTemplate,
  typeExistsInEntity,
  fieldToEnumType,
} from "../utils/field";
import { getRelationshipForTemplate } from "../utils/relationships";
import { snakeCase, camelCase, pascalCase, kebabCase } from "../utils/casing";
import { getEventEmittingEntities } from "../events";
import { gooseStatements } from "../ddl/migration-file";
import {
  columnSpec,
  enumTypeName,
  fkType,
  joinTableOf,
  relationColumn,
  tableName,
} from "../ddl";
import { legacyColumn, LegacyName, syncStatements } from "../ddl/sync";
import { Relationship, RelationshipMap } from "../types";
import pluralize from "pluralize";

// Postgres array element type -> lib/pq array type and its Go element type.
// Anything else is read and written as text (pq.StringArray).
const pqArrayTypes: Record<string, [string, string]> = {
  integer: ["pq.Int32Array", "int32"],
  int: ["pq.Int32Array", "int32"],
  int4: ["pq.Int32Array", "int32"],
  smallint: ["pq.Int32Array", "int32"],
  bigint: ["pq.Int64Array", "int64"],
  numeric: ["pq.Float64Array", "float64"],
  decimal: ["pq.Float64Array", "float64"],
  float: ["pq.Float64Array", "float64"],
  float8: ["pq.Float64Array", "float64"],
  "double precision": ["pq.Float64Array", "float64"],
  real: ["pq.Float32Array", "float32"],
  boolean: ["pq.BoolArray", "bool"],
  bool: ["pq.BoolArray", "bool"],
};

// Field type -> [Go type, DTO template]. Arrays and enums are typed per field.
const goFieldTypes: Record<string, [string, string]> = {
  text: ["string", "text"],
  string: ["string", "string"],
  varchar: ["string", "varchar"],
  char: ["string", "varchar"],
  uuid: ["string", "uuid"],
  enum: ["string", "enum"],
  integer: ["int", "integer"],
  bigint: ["int64", "integer"],
  smallint: ["int16", "integer"],
  float: ["float64", "float"],
  double: ["float64", "float"],
  decimal: ["float64", "decimal"],
  numeric: ["float64", "numeric"],
  boolean: ["bool", "boolean"],
  date: ["time.Time", "date"],
  timestamp: ["time.Time", "timestamp"],
  timestamptz: ["time.Time", "timestamptz"],
  json: ["map[string]interface{}", "json"],
  jsonb: ["map[string]interface{}", "jsonb"],
  "json-plain": ["map[string]interface{}", "json"],
  array: ["", "array"],
};

/**
 * A gorm struct tag value from its settings. gorm splits on ";" (a "\;"
 * stays literal), and the tag is a Go string literal, so quotes and
 * backslashes are escaped for it.
 */
const gormTag = (settings: string[]): string =>
  settings
    .map((s) => s.replace(/;/g, "\\;"))
    .join(";")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

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
      autoTrim: false,
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
          "char",
          "integer",
          "bigint",
          "smallint",
          "double",
          "json-plain",
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

  private arrayTypes(field: Field, entityName: string) {
    const elementType = arrayElementType(field);
    // It goes into a struct tag, so only a plain type name.
    if (!/^[a-z][\w ]*$/i.test(elementType))
      throw new Error(
        `Field ${entityName}.${field.name} has an invalid elementType "${elementType}".`
      );
    const [arrayGoType, arrayItemGoType] = pqArrayTypes[
      elementType.toLowerCase()
    ] || ["pq.StringArray", "string"];
    return { elementType, arrayGoType, arrayItemGoType };
  }

  /**
   * Fields for the Go templates. The gorm tag carries the column exactly as
   * the DDL writer creates it (name, type, NOT NULL, default), so the model
   * reads and writes the database `apso migrate` builds.
   */
  private getGoFieldsForTemplate(fields: Field[], entity: Entity): any[] {
    const table = tableName(entity);
    return getFieldForTemplate(fields, entity.name).map((field: any) => {
      const spec = columnSpec(table, field);
      const [goScalar, dtoTemplate] = goFieldTypes[field.type as string] || [];
      const array = field.type === "array" && this.arrayTypes(field, entity.name);
      const enumType = field.type === "enum" ? field.dataType : undefined;
      const scalar = enumType ? `enums.${enumType}` : goScalar;
      const tag = [
        `column:${field.name}`,
        `type:${
          field.type === "enum"
            ? `"${enumTypeName(table, field.name)}"`
            : spec.type.toLowerCase().replace("timestamp with time zone", "timestamptz")
        }`,
        ...(field.primary ? ["primaryKey"] : []),
        ...(spec.notNull ? ["not null"] : []),
        // gorm parses a number or boolean default itself, so it goes unquoted.
        ...(spec.default === undefined
          ? []
          : [`default:${/^(u?int|float|bool)/.test(goScalar) ? String(field.default) : spec.default}`]),
        ...(goScalar === "map[string]interface{}" ? ["serializer:json"] : []),
      ];
      return {
        ...field,
        ...array,
        goType: scalar,
        modelGoType: array
          ? array.arrayGoType
          : goScalar === "map[string]interface{}"
          ? goScalar
          : `*${scalar}`,
        gormTag: gormTag(tag),
        dtoTemplate,
        pascalName: pascalCase(field.name),
        snakeName: snakeCase(field.name),
        // NOT NULL with no default: the create DTO requires it.
        mustSend: spec.notNull && spec.default === undefined,
        enumType,
      };
    });
  }

  /** Relationships with what the Go templates need: field names, columns, join tables. */
  private goAssociations(
    entity: Entity,
    relationships: Relationship[],
    allEntities: Entity[]
  ): any[] {
    const byName = new Map(allEntities.map((e) => [e.name, e]));
    const relationshipMap: RelationshipMap = this.config.relationshipMap ?? {};
    return getRelationshipForTemplate(entity.name, relationships, allEntities).map(
      (rel) => {
        const target = byName.get(rel.name);
        const many = rel.type === "OneToMany" || rel.type === "ManyToMany";
        const fieldName = pascalCase(
          many ? rel.pluralizedRelationshipName : rel.relationshipName
        );
        const owns =
          rel.type === "ManyToOne" || (rel.type === "OneToOne" && rel.joinTable);
        const fkNullable = rel.type === "OneToOne" || Boolean(rel.nullable);
        const pkGoType = this.getPrimaryKeyGoType(
          target?.primaryKeyType || "serial"
        );
        let join: { name: string; ownCol: string; otherCol: string } | undefined;
        if (rel.type === "ManyToMany" && target) {
          if (rel.joinTable) join = joinTableOf(entity, rel, target);
          else {
            // The other side owns the join table; its key columns swap.
            const owner = getRelationshipForTemplate(
              target.name,
              relationshipMap[target.name] || [],
              allEntities
            ).find(
              (r) =>
                r.type === "ManyToMany" && r.joinTable && r.name === entity.name
            );
            if (owner) {
              const j = joinTableOf(target, owner, entity);
              join = { name: j.name, ownCol: j.otherCol, otherCol: j.ownCol };
            }
          }
        }
        return {
          ...rel,
          fieldName,
          jsonName: camelCase(fieldName),
          owns,
          fkField: `${pascalCase(rel.relationshipName)}ID`,
          fkColumn: owns ? relationColumn(rel) : undefined,
          fkNullable,
          primaryKeyGoType: pkGoType,
          fkGoType: `${fkNullable ? "*" : ""}${pkGoType}`,
          fkTag: owns
            ? gormTag([
                `column:${relationColumn(rel)}`,
                `type:${fkType(target)}`,
                ...(fkNullable ? [] : ["not null"]),
              ])
            : undefined,
          // The child's foreign key field, for OneToMany and the inverse OneToOne.
          foreignKey: `${pascalCase(rel.inverseReferenceName || entity.name)}ID`,
          onDeleteCascade: rel.type === "OneToOne" || Boolean(rel.cascadeDelete),
          join,
          camelReferenceName: camelCase(rel.referenceName || rel.name),
          snakeReferenceName: snakeCase(rel.referenceName || rel.name),
        };
      }
    );
  }

  async generateEntity(
    options: EntityGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { entity, relationships, allEntities, apiType } = options;
    const { name, fields = [] } = entity;

    const columns = this.getGoFieldsForTemplate(fields, entity);
    const createPrimaryKey =
      columns.filter((column: Field) => column.primary === true).length === 0;
    const primaryKeyType = entity.primaryKeyType || "serial";
    const associations = this.goAssociations(entity, relationships, allEntities);

    const data = {
      name,
      createPrimaryKey,
      primaryKeyType,
      tableName: tableName(entity),
      createdAt: entity.created_at,
      updatedAt: entity.updated_at,
      columns,
      associations,
      importTime:
        Boolean(entity.created_at || entity.updated_at) ||
        columns.some((c: any) => c.goType === "time.Time"),
      importEnums: typeExistsInEntity(entity, "enum") !== -1,
      importPq: typeExistsInEntity(entity, "array") !== -1,
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
      scope: entityScope(entity, Boolean(options.auth)),
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

    const columns = this.getGoFieldsForTemplate(fields, entity);
    const goRelationships = this.goAssociations(
      entity,
      relationships,
      allEntities
    );

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
      // Auth entities are for service callers only, so no other entity's
      // response carries one.
      associations: goRelationships.map((r: any) => ({
        ...r,
        hidden: hidesRelation(entityName, r.name, allEntities, options.auth),
      })),
      scope: this.goScope(entity, Boolean(options.auth)),
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
    const scopeFields = new Set(
      entityScope(entity, Boolean(options.auth))?.fields.map((f) => f.field)
    );

    const columns = this.getGoFieldsForTemplate(fields, entity);
    const goRelationships = this.goAssociations(
      entity,
      relationships,
      allEntities
    ).map((rel) => ({
      ...rel,
      // The service sets a scopeBy foreign key from the caller on create.
      scoped: scopeFields.has(`${rel.camelReferenceName}Id`),
    }));

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
      importTime:
        Boolean(createdAt || updatedAt) ||
        columns.some((c: any) => c.goType === "time.Time"),
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
    options: MigrationGenerationOptions
  ): Promise<GeneratedFile[]> {
    const { upSql, downSql, migrationName } = options;

    if (!upSql || upSql.length === 0) {
      return [];
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[:T-]/g, "")
      .slice(0, 14);
    const name = migrationName || "auto";
    const filename = `${timestamp}_${name}.sql`;

    const upStatements = gooseStatements(upSql);
    const downStatements = gooseStatements(downSql || []);

    const content = `-- +goose Up
${upStatements}

-- +goose Down
${downStatements}
`;

    return [
      {
        path: `migrations/${filename}`,
        content,
      },
    ];
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
    _apiType: string,
    opts?: { emitEvents?: boolean; http?: boolean; auth?: AuthConfig }
  ): Promise<GeneratedFile[]> {
    // Effective HTTP flag per entity (entity override > top-level default >
    // true). When false we skip the handler + route registration but keep the
    // service and model, matching the handler suppression in generate.ts.
    // See apsoai/cli#95.
    const entitiesData = entities.map((entity) => ({
      name: entity.name,
      camelName: camelCase(entity.name),
      kebabName: kebabCase(entity.name),
      http: entity.http ?? opts?.http ?? true,
    }));

    const content = await this.renderTemplate("./index-module", {
      entities: entitiesData,
    });

    const modelRefs = entities
      .map((e) => `\t\t&${pascalCase(e.name)}{},`)
      .join("\n");
    const registryContent = `package models

// All returns all registered GORM models.
// This file is auto-generated by the Apso CLI.
func All() []interface{} {
\treturn []interface{}{
${modelRefs}
\t}
}
`;

    return [
      {
        path: "routes/routes.go",
        content,
      },
      {
        path: "models/registry.go",
        content: registryContent,
      },
      {
        path: "models/schema.go",
        content: await this.renderTemplate("./models/schema", this.schemaData(entities)),
      },
    ];
  }

  /**
   * DATABASE_SYNC's statements (the DDL writer's, creating only what is
   * missing) and the join table columns gorm must be told about.
   */
  private schemaData(entities: Entity[]) {
    const relationshipMap = this.config.relationshipMap ?? {};
    const legacy: LegacyName[] = [];
    const joinColumns = new Map<string, string>();
    for (const entity of entities) {
      const table = tableName(entity);
      // Older Go models let gorm name columns: snake_case of the Go field.
      const renames: [string, string][] = (entity.fields ?? []).map((f) => [
        snakeCase(f.name),
        f.name,
      ]);
      for (const a of this.goAssociations(
        entity,
        relationshipMap[entity.name] || [],
        entities
      )) {
        if (a.owns) renames.push([`${snakeCase(a.relationshipName)}_id`, a.fkColumn]);
        if (a.join)
          for (const c of [a.join.ownCol, a.join.otherCol])
            joinColumns.set(c.charAt(0).toUpperCase() + c.slice(1), c);
      }
      for (const [from, to] of renames)
        if (from !== to) legacy.push(legacyColumn(table, from, to));
    }
    return {
      statements: syncStatements({ entities, relationshipMap }, legacy).map(
        (sql) => JSON.stringify(sql)
      ),
      joinColumns: [...joinColumns].map(([k, v]) => [
        JSON.stringify(k),
        JSON.stringify(v),
      ]),
    };
  }

  /**
   * Emits a schema-derived manifest of the entities that opted in to
   * domain-event emission (`.apsorc` `emitEvents`), mirroring the TypeScript
   * generator. See apsoai/cli#82.
   *
   * Per the Apso Distribution Model the domain-event engine (the transactional
   * GORM hook/callback, mapper, relay, delivery) is NOT generated here; it
   * ships as a versioned library wired by the `domain-events` skill. The CLI's
   * only job is to declare WHICH entities participate, via a single generated
   * file: `events/event_emitting_entities.go`.
   *
   * Returns an empty array when no entity is opted in.
   *
   * Resolution mirrors TS: `entity.emitEvents ?? <top-level emitEvents> ?? false`.
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
      "./events/event-emitting-entities",
      {
        emittingEntities: emittingEntities.map((entity) => ({
          name: entity.name,
        })),
      }
    );

    return [
      {
        path: "events/event_emitting_entities.go",
        content,
      },
    ];
  }

  /**
   * Scope data for a Go service: each direct scopeBy field's struct field and
   * column (the .apsorc name, as the DDL writer names it). A field declared on the entity is
   * pascalCase; a relation's foreign key (organizationId) is OrganizationID.
   */
  private goScope(entity: Entity, hasAuth: boolean) {
    const scope = entityScope(entity, hasAuth);
    if (!scope) return;
    const declared = new Set((entity.fields ?? []).map((f) => f.name));
    return {
      ...scope,
      fields: scope.fields.map((f) => ({
        ...f,
        goField:
          declared.has(f.field) || !f.field.endsWith("Id")
            ? pascalCase(f.field)
            : `${pascalCase(f.field.slice(0, -2))}ID`,
        column: f.field,
      })),
    };
  }

  async generateGuards(
    entities: Entity[],
    auth?: AuthConfig
  ): Promise<GeneratedFile[]> {
    if (entities.some((entity) => entity.mcp))
      throw new Error(
        "mcp in .apsorc is served by TypeScript services only for now; remove it or generate with --language typescript"
      );
    if (hasPermissions(entities))
      throw new Error(
        "permissions in .apsorc are enforced in TypeScript services only for now; remove them or generate with --language typescript"
      );
    const nested = auth ? nestedScopeEntities(entities) : [];
    if (nested.length > 0)
      console.warn(
        `[apso] Nested scopeBy paths are enforced in TypeScript services only; ${nested.join(", ")} will not be filtered by those paths in this Go service`
      );
    // The API key check is part of every service; auth adds user sign-in.
    // One entry per trusted issuer; undefined when there is no sign-in.
    const jwt = resolveJwtProviders(auth);
    const data = {
      jwt: jwt.length > 0 ? jwt : undefined,
      // Routes only a service caller reaches (sessions, accounts, ...).
      authRoutes: authEntityNames(entities, auth).map((name) =>
        kebabCase(pluralize(name))
      ),
    };
    const content = await this.renderTemplate("./middleware/auth", data);
    const files: GeneratedFile[] = [{ path: "middleware/auth.go", content }];
    // Shared helpers for services and handlers of entities with a direct scopeBy.
    if (auth && entities.some((e) => entityScope(e, true))) {
      files.push(
        {
          path: "services/scope.go",
          content: await this.renderTemplate("./services/scope", {}),
        },
        {
          path: "handlers/scope.go",
          content: await this.renderTemplate("./handlers/scope", {}),
        }
      );
    }
    return files;
  }

  async generateQueryUtils(
    _entities: Entity[],
    _apiType: string
  ): Promise<GeneratedFile[]> {
    const typesContent = await this.renderTemplate("./utils/types", {});
    const queryContent = await this.renderTemplate("./utils/query", {});

    return [
      { path: "utils/types.go", content: typesContent },
      { path: "utils/query.go", content: queryContent },
    ];
  }
}
