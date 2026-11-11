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
  resolveJwtProviders,
  Field,
  ComputedField,
  RelationshipMap,
} from "../types";
import {
  arrayElementType,
  getFieldForTemplate,
  typeExistsInEntity,
  fieldToEnumType,
} from "../utils/field";
import {
  getRelationshipForTemplate,
  getRelationshipsForImport,
} from "../utils/relationships";
import { camelCase } from "../utils/casing";
import { getEventEmittingEntities } from "../events";
import {
  authEntityRoutes,
  hidesRelation,
  entityScope,
  getPermissionConfig,
  hasPermissions,
  nestedScopeEntities,
  assertTenantClaim,
  relationScopes,
} from "../guards";
import { pyString } from "../ddl/migration-file";
import {
  columnSpec,
  enumTypeName,
  joinTableOf,
  relationColumn,
  ModelColumn,
  ModelConstraint,
  schemaModel,
  tableName,
} from "../ddl";
import { legacyGuardSql, legacyTable, legacyType, LegacyName } from "../ddl/sync";
import pluralize from "pluralize";

// Postgres array element type -> [SQLAlchemy column type, Python type]. The
// column type must give the same Postgres type the DDL writer does.
const arrayElementTypes: Record<string, [string, string]> = {
  text: ["Text", "str"],
  varchar: ["String", "str"],
  uuid: ["PGUUID(as_uuid=True)", "UUID"],
  integer: ["Integer", "int"],
  int: ["Integer", "int"],
  int4: ["Integer", "int"],
  smallint: ["SmallInteger", "int"],
  bigint: ["BigInteger", "int"],
  numeric: ["Numeric", "Decimal"],
  decimal: ["Numeric", "Decimal"],
  real: ["REAL", "float"],
  float: ["Float", "float"],
  float8: ["Float", "float"],
  "double precision": ["Float", "float"],
  boolean: ["Boolean", "bool"],
  bool: ["Boolean", "bool"],
  date: ["Date", "date"],
  timestamp: ["DateTime", "datetime"],
  timestamptz: ["DateTime(timezone=True)", "datetime"],
};

// Field type -> Pydantic schema template, where the type has none of its own.
const schemaTemplates: Record<string, string> = {
  char: "varchar",
  bigint: "integer",
  smallint: "integer",
  double: "float",
  "json-plain": "json",
};

// DDL column type -> [SQLAlchemy type, Python type]; the SQLAlchemy type
// creates that same Postgres type.
const saTypes: Record<string, [string, string]> = {
  text: ["Text", "str"],
  integer: ["Integer", "int"],
  bigint: ["BigInteger", "int"],
  smallint: ["SmallInteger", "int"],
  numeric: ["Numeric()", "Decimal"],
  "double precision": ["DOUBLE_PRECISION", "float"],
  boolean: ["Boolean", "bool"],
  uuid: ["PGUUID(as_uuid=True)", "UUID"],
  date: ["Date", "date"],
  TIMESTAMP: ["DateTime", "datetime"],
  "TIMESTAMP WITH TIME ZONE": ["DateTime(timezone=True)", "datetime"],
  jsonb: ["JSONB", "dict"],
  json: ["JSON", "dict"],
};

function saType(type: string): [string, string] {
  const sized = type.match(/^(character varying|character|numeric)\((\d+)(?:,(\d+))?\)$/);
  if (sized) {
    const [, kind, a, b] = sized;
    if (kind === "numeric") return [`Numeric(${a}, ${b})`, "Decimal"];
    return [`${kind === "character" ? "CHAR" : "String"}(${a})`, "str"];
  }
  if (type.endsWith("[]")) {
    const element = arrayElementTypes[type.slice(0, -2).toLowerCase()];
    if (!element)
      throw new Error(
        `The Python generator does not support ${type} columns. Use one of: ${Object.keys(arrayElementTypes).join(", ")}.`
      );
    return [`ARRAY(${element[0]})`, `List[${element[1]}]`];
  }
  const known = saTypes[type];
  if (!known) throw new Error(`The Python generator does not support ${type} columns.`);
  return known;
}

const withArrayTypes = <T extends Field>(columns: T[], entityName: string) =>
  columns.map((c) => {
    if (c.type !== "array") return c;
    const element = arrayElementType(c);
    const types = arrayElementTypes[element.toLowerCase()];
    if (!types)
      throw new Error(
        `Field ${entityName}.${c.name} has elementType "${element}", which the Python generator does not support. Use one of: ${Object.keys(arrayElementTypes).join(", ")}.`
      );
    return { ...c, arrayColumnType: types[0], arrayItemType: types[1] };
  });

/** The ForeignKey(...) of a DDL foreign key constraint. */
const pyForeignKey = (fk: ModelConstraint) => {
  const [, targetCol, onDelete, onUpdate] = fk.body.match(
    /REFERENCES "[^"]+"\("([^"]+)"\) ON DELETE (.+) ON UPDATE (.+)$/
  )!;
  return `ForeignKey(${pyString(`${fk.references}.${targetCol}`)}, name=${pyString(
    fk.name
  )}, ondelete=${pyString(onDelete)}, onupdate=${pyString(onUpdate)})`;
};

/**
 * A DDL column as a SQLAlchemy Column argument list: type, foreign key,
 * key, NULL and default exactly as the DDL writer creates them.
 */
function pyColumnArgs(
  table: string,
  c: ModelColumn,
  field: ComputedField | undefined,
  fk: ModelConstraint | undefined,
  primary: boolean
): { args: string[]; pyType: string } {
  const [type, enumOrPyType] =
    field?.type === "enum"
      ? [
          `SAEnum(enums.${field.dataType}, name=${pyString(
            enumTypeName(table, field.name)
          )}, values_callable=lambda x: [e.value for e in x])`,
          `enums.${field.dataType}`,
        ]
      : saType(c.type);
  const args = [type];
  if (fk) args.push(pyForeignKey(fk));
  if (primary) args.push("primary_key=True");
  if (c.serial) args.push("autoincrement=True");
  else if (!primary) args.push(`nullable=${c.notNull ? "False" : "True"}`);
  if (c.default !== undefined && !c.serial)
    args.push(`server_default=text(${pyString(c.default)})`);
  if (c.name === "updated_at") args.push("onupdate=func.now()");
  return { args, pyType: c.notNull ? enumOrPyType : `Optional[${enumOrPyType}]` };
}

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
    const { name, fields = [] } = entity;

    // Every table object comes from the DDL writer's model of the schema, so
    // create_all builds what the migrations from `apso migrate` build.
    const model = schemaModel({
      entities: allEntities,
      relationshipMap: {
        ...this.config.relationshipMap,
        [name]: relationships,
      },
    });
    const table = tableName(entity);
    const byField = new Map(
      getFieldForTemplate(fields, name).map((f) => [f.name, f])
    );
    const tableArgs = (t: string) => {
      const pk = model.constraints.find((c) => c.kind === "pk" && c.table === t)!;
      return {
        pk,
        args: [
          `PrimaryKeyConstraint(${[...pk.columns, `name=${pyString(pk.name)}`]
            .map((x) => (x.startsWith("name=") ? x : pyString(x)))
            .join(", ")})`,
          ...model.constraints
            .filter((c) => c.kind === "unique" && c.table === t)
            .map(
              (c) =>
                `UniqueConstraint(${c.columns
                  .map((x) => pyString(x))
                  .join(", ")}, name=${pyString(c.name)})`
            ),
          ...model.indexes
            .filter((i) => i.table === t)
            .map(
              (i) =>
                `Index(${[i.name, ...i.columns].map((x) => pyString(x)).join(", ")}${
                  i.unique ? ", unique=True" : ""
                })`
            ),
        ],
      };
    };
    const columnsOf = (
      t: string,
      fieldOf?: (c: string) => ComputedField | undefined
    ) => {
      const { pk, args } = tableArgs(t);
      const columns = model.tables
        .find((x) => x.name === t)!
        .columns.map((c) => ({
          name: c.name,
          ...pyColumnArgs(
            t,
            c,
            fieldOf?.(c.name),
            model.constraints.find(
              (k) => k.kind === "fk" && k.table === t && k.columns[0] === c.name
            ),
            pk.columns.includes(c.name)
          ),
        }));
      return { columns, tableArgs: args };
    };
    const own = columnsOf(table, (c) => byField.get(c));

    const relationshipsForTemplate = getRelationshipForTemplate(
      name,
      relationships,
      allEntities
    );
    const byName = new Map(allEntities.map((e) => [e.name, e]));
    const joinTables = relationshipsForTemplate
      .filter((r) => r.type === "ManyToMany" && r.joinTable && byName.get(r.name))
      .map((r) => {
        const j = joinTableOf(entity, r, byName.get(r.name)!);
        return { name: j.name, ...columnsOf(j.name) };
      });
    // A non-owning ManyToMany names the join table its owner declares.
    const associations = relationshipsForTemplate.map((r) => {
      if (r.type === "OneToOne" && r.joinTable)
        return { ...r, fkColumn: relationColumn(r) };
      if (r.type !== "ManyToMany" || !byName.get(r.name)) return r;
      const target = byName.get(r.name)!;
      if (r.joinTable) return { ...r, secondary: joinTableOf(entity, r, target).name };
      const owner = getRelationshipForTemplate(
        target.name,
        (this.config.relationshipMap ?? {})[target.name] || [],
        allEntities
      ).find((o) => o.type === "ManyToMany" && o.joinTable && o.name === name);
      return { ...r, secondary: owner && joinTableOf(target, owner, entity).name };
    });
    const entitiesToImport = getRelationshipsForImport(
      name,
      relationshipsForTemplate
    );

    const data = {
      name,
      tableName: table,
      columns: own.columns,
      tableArgs: own.tableArgs,
      joinTables,
      associations,
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
      scope: entityScope(entity, Boolean(options.auth)),
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

    const table = tableName(entity);
    const columns = withArrayTypes(
      getFieldForTemplate(fields, entityName),
      entityName
    ).map((c: any) => {
      const spec = columnSpec(table, c);
      return {
        ...c,
        schemaTemplate: schemaTemplates[c.type] || c.type,
        // NOT NULL with no default: the create schema requires it.
        required: spec.notNull && spec.default === undefined,
      };
    });
    const relationshipsTemplate = getRelationshipForTemplate(
      entityName,
      relationships,
      allEntities
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
      // Auth entities are for service callers only, so no other entity's
      // response carries one.
      associations: relationshipsTemplate.map((r: any) => ({
        ...r,
        hidden: hidesRelation(entityName, r.name, allEntities, options.auth),
      })),
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
    const revision = timestamp;
    const name = migrationName || "auto";
    const filename = `${timestamp}_${name}.py`;

    const upStatements = upSql
      .map((sql) => `    op.execute(${pyString(sql)})`)
      .join("\n");
    const downStatements = (downSql || [])
      .map((sql) => `    op.execute(${pyString(sql)})`)
      .join("\n");

    const content = `"""${name}"""
from alembic import op

revision = '${revision}'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
${upStatements}


def downgrade() -> None:
${downStatements || "    pass"}
`;

    return [
      {
        path: `alembic/versions/${filename}`,
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
    _apiType: string,
    _opts?: { auth?: AuthConfig }
  ): Promise<GeneratedFile[]> {
    const content = await this.renderTemplate("./index-module", {
      entities,
      permissions: hasPermissions(entities),
    });

    return [
      {
        path: "__init__.py",
        content,
      },
      {
        path: "models/__init__.py",
        content: await this.renderTemplate("./models/init", this.modelsInitData(entities)),
      },
    ];
  }

  /**
   * What create_all must run first: the extensions the tables use, and a
   * guard that stops when the database still has a join table or enum type
   * under the name older generated models gave it.
   */
  private modelsInitData(entities: Entity[]) {
    const relationshipMap = this.config.relationshipMap ?? {};
    const model = schemaModel({ entities, relationshipMap });
    const legacy: LegacyName[] = [];
    for (const entity of entities) {
      const table = tableName(entity);
      for (const f of entity.fields ?? [])
        if (f.type === "enum") {
          const old = `${entity.name}_${f.name}_enum`.toLowerCase();
          const now = enumTypeName(table, f.name);
          if (old !== now) legacy.push(legacyType(old, now));
        }
      for (const r of getRelationshipForTemplate(
        entity.name,
        relationshipMap[entity.name] || [],
        entities
      )) {
        const target = entities.find((e) => e.name === r.name);
        if (r.type !== "ManyToMany" || !r.joinTable || !target) continue;
        const j = joinTableOf(entity, r, target);
        const old = r.joinTableName || `${table}_${r.name.toLowerCase()}`;
        if (old !== j.name)
          legacy.push(
            legacyTable(old, j.name, [
              [r.joinColumnName || `${table}_id`, j.ownCol],
              [r.inverseJoinColumnName || `${r.name.toLowerCase()}_id`, j.otherCol],
            ])
          );
      }
    }
    const guard = legacyGuardSql(legacy);
    return {
      modules: entities.map((e) => [e.name.toLowerCase(), e.name]),
      statements: [...model.extensions, ...(guard ? [guard] : [])].map((x) =>
        pyString(x)
      ),
    };
  }

  /**
   * Emits a schema-derived manifest of the entities that opted in to
   * domain-event emission (`.apsorc` `emitEvents`), mirroring the TypeScript
   * generator. See apsoai/cli#81.
   *
   * Per the Apso Distribution Model the domain-event engine (the transactional
   * SQLAlchemy session hook, mapper, relay, delivery) is NOT generated here; it
   * ships as a versioned library wired by the `domain-events` skill. The CLI's
   * only job is to declare WHICH entities participate, via a single generated
   * file: `events/event_emitting_entities.py`.
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
        path: "events/event_emitting_entities.py",
        content,
      },
    ];
  }

  async generateGuards(
    entities: Entity[],
    auth?: AuthConfig,
    relationshipMap: RelationshipMap = this.config.relationshipMap ?? {}
  ): Promise<GeneratedFile[]> {
    if (entities.some((entity) => entity.mcp))
      throw new Error(
        "mcp in .apsorc is served by TypeScript services only for now; remove it or generate with --language typescript"
      );
    // Fails on a grants entity that would be an escalation path.
    const permissions = getPermissionConfig(entities, relationshipMap, auth);
    if (permissions && !auth)
      throw new Error(
        "permissions in .apsorc need an auth block: roles come from the signed-in caller"
      );
    const nested = auth ? nestedScopeEntities(entities) : [];
    if (nested.length > 0)
      throw new Error(
        `${nested.join(", ")}: a scopeBy path through a parent (for example "project.organizationId") is enforced in TypeScript services only for now. In Python, put the tenant field on the entity and scope by it, or generate with --language typescript.`
      );
    assertTenantClaim(entities, auth);
    // The API key check is part of every service; auth adds user sign-in.
    // One entry per trusted issuer; undefined when there is no sign-in.
    const jwt = resolveJwtProviders(auth);
    const data = {
      jwt: jwt.length > 0 ? jwt : undefined,
      // Routes only a service caller reaches (sessions, accounts, ...).
      authRoutes: authEntityRoutes(entities, auth),
      relationScopes: relationScopes(entities, relationshipMap, Boolean(auth)) ?? {},
    };
    const files: GeneratedFile[] = [
      { path: "auth.py", content: await this.renderTemplate("./auth", data) },
    ];
    if (permissions)
      files.push({
        path: "permissions.py",
        content: await this.renderTemplate("./permissions", { permissions }),
      });
    return files;
  }

  async generateQueryUtils(
    _entities: Entity[],
    _apiType: string
  ): Promise<GeneratedFile[]> {
    const queryContent = await this.renderTemplate("./utils/query", {});
    const initContent = await this.renderTemplate("./utils/init", {});

    return [
      { path: "utils/query.py", content: queryContent },
      { path: "utils/__init__.py", content: initContent },
    ];
  }
}
