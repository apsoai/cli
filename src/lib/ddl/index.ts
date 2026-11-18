/**
 * Apso's own DDL writer: the CREATE statements for a whole .apsorc schema.
 *
 * Column rules mirror the TypeScript entity templates (templates/entities),
 * and names follow TypeORM's DefaultNamingStrategy (a prefix plus a sha1 of
 * "table_columns"). A database built from this SQL therefore matches the one
 * TypeORM builds for the generated entities, and services already deployed
 * see no drift. test/lib/ddl/project-parity.test.ts checks that against a
 * real scaffolded service.
 */
import {
  Entity,
  timestampDefaultOf,
  timestampNullableOf,
  timestampTypeOf,
} from "../types/entity";
import { ComputedField } from "../types/field";
import {
  RelationshipForTemplate,
  RelationshipMap,
  onDeleteOf,
} from "../types/relationship";
import { arrayElementType, getFieldForTemplate } from "../utils/field";
import { snakeCase } from "../utils/casing";
import { getRelationshipForTemplate } from "../utils/relationships";

// TypeORM's own casing, used for join table and join column names.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const typeormCase = require("typeorm/util/StringUtils");

// TypeORM hashes names with its own SHA-1 routine, which differs from the
// standard one on text with characters such as quotes or "<>" (a check
// expression, a partial index's condition). Names must come out as TypeORM's.
const {
  RandomGenerator,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require("typeorm/util/RandomGenerator");
const sha1 = (s: string): string => RandomGenerator.sha1(s);
const key = (table: string, columns: string[]) =>
  `${table.replace(".", "_")}_${[...columns].sort().join("_")}`;

export const constraintName = {
  primaryKey: (t: string, cols: string[]) =>
    "PK_" + sha1(key(t, cols)).slice(0, 27),
  unique: (t: string, cols: string[]) =>
    "UQ_" + sha1(key(t, cols)).slice(0, 27),
  relation: (t: string, cols: string[]) =>
    "REL_" + sha1(key(t, cols)).slice(0, 26),
  foreignKey: (t: string, cols: string[]) =>
    "FK_" + sha1(key(t, cols)).slice(0, 27),
  check: (t: string, expression: string) =>
    "CHK_" + sha1(`${t.replace(".", "_")}_${expression}`).slice(0, 26),
  // TypeORM adds a partial index's condition to the text it hashes.
  index: (t: string, cols: string[], where?: string) =>
    "IDX_" + sha1(key(t, cols) + (where ? `_${where}` : "")).slice(0, 26),
};

export const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const literal = (v: string) => `'${v.replace(/'/g, "''")}'`;

export const tableName = (e: Entity) => e.table || snakeCase(e.name);
export const enumTypeName = (table: string, column: string) =>
  `${table}_${column}_enum`;

export interface ColumnSpec {
  /** Column SQL without constraints: name, type, NOT NULL, DEFAULT. */
  sql: string;
  type: string;
  notNull: boolean;
  default?: string;
  unique: boolean;
  index: boolean;
}

const hasDefault = (f: ComputedField) =>
  f.default !== null && f.default !== undefined;
// TypeORM quotes every default it is given except booleans.
const quoted = (f: ComputedField) =>
  hasDefault(f) ? literal(String(f.default)) : undefined;

/** Types whose template is a bare @Column({ type }) with no size or options. */
const PLAIN_TYPES: Record<string, string> = {
  bytea: "bytea",
  real: "real",
  money: "money",
  time: "TIME",
  timetz: "TIME WITH TIME ZONE",
  interval: "interval",
  inet: "inet",
  xml: "xml",
  tsvector: "tsvector",
  int4range: "int4range",
};
/** Their templates take no literal default (a SQL default still applies). */
const NO_LITERAL_DEFAULT = new Set(["xml", "tsvector", "int4range"]);

/** One column as its entity template declares it. */
export function columnSpec(table: string, f: ComputedField): ColumnSpec {
  const textLike = (type: string): [string, string | undefined, boolean] => [
    type,
    quoted(f),
    Boolean(f.unique),
  ];
  const { length: size } = f;
  let type: string;
  let def: string | undefined;
  let unique = false;
  switch (f.type as string) {
    case "text":
    case "string":
      [type, def, unique] = textLike("text");
      break;
    case "varchar":
      [type, def, unique] = textLike(`character varying(${size || 255})`);
      break;
    case "char":
      [type, def, unique] = textLike(`character(${size || 1})`);
      break;
    case "enum":
      type = `"public".${q(enumTypeName(table, f.name))}`;
      def = quoted(f);
      break;
    case "integer":
    case "bigint":
    case "smallint":
      type = f.type;
      def = quoted(f);
      break;
    case "decimal":
    case "numeric":
      type = `numeric(${f.precision || 10},${f.scale || 2})`;
      def = quoted(f);
      break;
    case "float":
      type = "numeric";
      def = quoted(f);
      break;
    case "double":
      type = "double precision";
      def = quoted(f);
      break;
    case "boolean":
      type = "boolean";
      def = String(String(f.default).toLowerCase() === "true");
      break;
    case "uuid":
      type = "uuid";
      def = hasDefault(f) ? String(f.default) : undefined;
      unique = Boolean(f.unique);
      break;
    case "date":
      type = "date";
      unique = Boolean(f.unique);
      break;
    case "timestamp":
      type = "TIMESTAMP";
      unique = Boolean(f.unique);
      break;
    case "timestamptz":
      type = "TIMESTAMP WITH TIME ZONE";
      unique = Boolean(f.unique);
      break;
    case "json":
    case "jsonb":
      type = "jsonb";
      break;
    case "json-plain":
      type = "json";
      break;
    case "array": {
      // entity-col-array.eta: { type: elementType || "text", array: true }, no default.
      const element = arrayElementType(f);
      if (!/^[a-z][\w ]*$/i.test(element))
        throw new Error(
          `Field ${table}.${f.name} has an invalid elementType "${element}".`
        );
      type = `${element}[]`;
      break;
    }
    default:
      if (PLAIN_TYPES[f.type as string]) {
        type = PLAIN_TYPES[f.type as string];
        if (!NO_LITERAL_DEFAULT.has(f.type as string)) def = quoted(f);
        break;
      }
      // ponytail: spatial and serial templates; add each with a parity case
      // (spatial needs PostGIS, which the parity test's PGlite does not load).
      throw new Error(
        `The DDL writer does not support field type "${f.type}" yet (${table}.${f.name}).`
      );
  }
  // A SQL expression or JSON literal default applies to any type, and
  // "noDefault" removes the default a boolean would otherwise get.
  if (f.defaultSql !== undefined) def = f.defaultSql;
  else if (f.noDefault) def = undefined;
  let sql = `${q(f.name)} ${type}`;
  if (!f.nullable) sql += " NOT NULL";
  if (def !== undefined) sql += ` DEFAULT ${def}`;
  return {
    sql,
    type,
    notNull: !f.nullable,
    default: def,
    unique,
    index: Boolean(f.index),
  };
}

export interface SchemaInput {
  entities: Entity[];
  relationshipMap: RelationshipMap;
}

export interface ModelColumn {
  name: string;
  /** The column as CREATE TABLE writes it. */
  sql: string;
  type: string;
  notNull: boolean;
  default?: string;
  /** A SERIAL id, whose default is the table's id sequence. */
  serial?: boolean;
}

export interface ModelTable {
  name: string;
  columns: ModelColumn[];
}

export interface ModelConstraint {
  /** Identity independent of the name: kind, table, columns (and target). */
  key: string;
  name: string;
  table: string;
  kind: "pk" | "unique" | "fk" | "check";
  columns: string[];
  /** The condition of a check constraint. */
  expression?: string;
  /** Everything after CONSTRAINT "name". */
  body: string;
  references?: string;
  /** Added by ALTER TABLE after the table exists, as a foreign key is. */
  late?: boolean;
}

export interface ModelIndex {
  key: string;
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  /** The condition of a partial index. */
  where?: string;
  /** The column list as SQL, for an index TypeORM cannot declare. */
  columnsSql?: string;
}

export interface ModelEnum {
  name: string;
  values: string[];
}

/** Every object a schema creates, in creation order. */
export interface Model {
  extensions: string[];
  enums: ModelEnum[];
  tables: ModelTable[];
  constraints: ModelConstraint[];
  indexes: ModelIndex[];
}

const cols = (c: string[]) => c.map((x) => q(x)).join(", ");
const column = (
  name: string,
  type: string,
  notNull: boolean,
  def?: string,
  serial?: boolean
): ModelColumn => ({
  name,
  sql: `${q(name)} ${serial ? "SERIAL" : type}${notNull ? " NOT NULL" : ""}${
    def && !serial ? ` DEFAULT ${def}` : ""
  }`,
  type,
  notNull,
  default: def,
  serial,
});

export const pkColumn = (e: Entity): string =>
  (e.fields ?? []).find((f) => f.primary)?.name ?? "id";
/**
 * The primary key column of an entity, as a foreign key onto it must copy it:
 * its SQL type, the matching TypeORM column options and the TypeScript type.
 * A key declared as a field (varchar(100), text, bigint) keeps that type
 * instead of falling back to integer.
 *
 * @param {Entity} [target] - The referenced entity.
 * @returns {object} sql, options and ts for the key column.
 */
export const keyColumn = (
  target?: Entity
): { sql: string; options: string; ts: "string" | "number" } => {
  const keys = (target?.fields ?? []).filter((f) => f.primary);
  if (target && keys.length === 1) {
    const [f] = getFieldForTemplate(keys, target.name);
    const type = f.type as string;
    const length = ["varchar", "char"].includes(type)
      ? `, length: ${f.length ?? (type === "char" ? 1 : 255)}`
      : "";
    return {
      sql: columnSpec(tableName(target), f).type,
      options: `type: "${type}"${length}`,
      ts: ["integer", "smallint", "serial"].includes(type)
        ? "number"
        : "string",
    };
  }
  if (target?.primaryKeyType === "uuid")
    return { sql: "uuid", options: 'type: "uuid"', ts: "string" };
  if ((target?.primaryKeyType as string) === "text")
    return { sql: "text", options: 'type: "text"', ts: "string" };
  return { sql: "integer", options: 'type: "integer"', ts: "number" };
};
export const fkType = (target?: Entity): string => keyColumn(target).sql;

/**
 * The foreign key column of a ManyToOne or an owning OneToOne:
 * "joinColumnName" when the .apsorc sets one (an imported database keeps its
 * own column names), else the name TypeORM derives.
 */
export const relationColumn = (r: RelationshipForTemplate): string =>
  r.joinColumnName ||
  (r.type === "ManyToOne"
    ? r.camelCasedId
    : typeormCase.camelCase(`${r.relationshipName}_id`));

const ownsColumn = (r: RelationshipForTemplate): boolean =>
  r.type === "ManyToOne" || (r.type === "OneToOne" && r.joinTable);

/**
 * Every name an "indexes" or "uniques" entry may use for a foreign key, mapped
 * to its column: the relationship ("patient"), the id property ("patientId")
 * and the column itself ("patient_id").
 *
 * @param {RelationshipForTemplate[]} relationships - One entity's relationships.
 * @returns {Map<string, string>} Name to database column.
 */
export const relationColumns = (
  relationships: RelationshipForTemplate[]
): Map<string, string> => {
  const columns = new Map<string, string>();
  for (const r of relationships.filter((r) => ownsColumn(r))) {
    const column = relationColumn(r);
    for (const name of [r.relationshipName, r.camelCasedId, column])
      columns.set(name, column);
  }
  return columns;
};

/** The join table of an owning ManyToMany and its two key columns. */
export const joinTableOf = (
  e: Entity,
  r: RelationshipForTemplate,
  target: Entity
): { name: string; ownCol: string; otherCol: string } => {
  const table = tableName(e);
  const targetTable = tableName(target);
  return {
    name:
      r.joinTableName ||
      typeormCase.snakeCase(
        `${table}_${r.pluralizedRelationshipName}_${targetTable}`
      ),
    ownCol:
      r.joinColumnName || typeormCase.camelCase(`${table}_${pkColumn(e)}`),
    otherCol:
      r.inverseJoinColumnName ||
      typeormCase.camelCase(`${targetTable}_${pkColumn(target)}`),
  };
};

export function schemaModel(input: SchemaInput): Model {
  const { entities, relationshipMap } = input;
  const byName = new Map(entities.map((e) => [e.name, e]));
  const model: Model = {
    extensions: [],
    enums: [],
    tables: [],
    constraints: [],
    indexes: [],
  };
  const entityTables: ModelTable[] = [];
  const joinTables: ModelTable[] = [];
  const inline: ModelConstraint[] = [];
  const foreignKeys: ModelConstraint[] = [];

  // The same columns can be indexed twice (a field or relationship
  // "index": true plus an "indexes" entry). TypeORM names an index by its
  // table and columns, so a second CREATE INDEX would fail on deploy: keep one.
  // A named or partial index is its own index, so it is never merged.
  const index = (
    table: string,
    columns: string[],
    isUnique?: boolean,
    name?: string,
    where?: string
  ) => {
    const unique = Boolean(isUnique);
    const key = `index:${table}(${columns.join(",")})${
      where ? ` where ${where}` : ""
    }${name ? ` as ${name}` : ""}`;
    const seen = model.indexes.find((i) => i.key === key);
    if (seen) {
      seen.unique ||= unique;
      return;
    }
    model.indexes.push({
      key,
      name: name || constraintName.index(table, columns, where),
      table,
      columns,
      unique,
      ...(where && { where }),
    });
  };
  const unique = (
    table: string,
    columns: string[],
    name: string,
    list = inline
  ) =>
    list.push({
      key: `unique:${table}(${columns.join(",")})`,
      name,
      table,
      kind: "unique",
      columns,
      body: `UNIQUE (${cols(columns)})`,
    });
  const primaryKey = (
    table: string,
    columns: string[],
    list = inline,
    name = constraintName.primaryKey(table, columns)
  ) =>
    list.push({
      key: `pk:${table}`,
      name,
      table,
      kind: "pk",
      columns,
      body: `PRIMARY KEY (${cols(columns)})`,
    });
  const foreignKey = (
    table: string,
    col: string,
    target: string,
    targetCol: string,
    actions: string,
    name = constraintName.foreignKey(table, [col])
  ) =>
    foreignKeys.push({
      key: `fk:${table}(${col})->${target}`,
      name,
      table,
      kind: "fk",
      columns: [col],
      references: target,
      body: `FOREIGN KEY (${q(col)}) REFERENCES ${q(target)}(${q(
        targetCol
      )}) ${actions}`,
    });

  for (const e of entities) {
    const table = tableName(e);
    const t: ModelTable = { name: table, columns: [] };
    const relationships = getRelationshipForTemplate(
      e.name,
      relationshipMap[e.name] || [],
      entities
    );
    // A foreign key can be the primary key ("primary": true on the
    // relationship): a table keyed by the row it extends.
    const relationKeys = relationships
      .filter((r) => r.primary && ownsColumn(r))
      .map((r) => relationColumn(r));
    const customPk =
      (e.fields ?? []).some((f) => f.primary) || relationKeys.length > 0;

    if (!customPk) {
      const pkType: string = e.primaryKeyType || "serial";
      if (pkType === "uuid") {
        if (!e.primaryKeyDefault)
          model.extensions.push(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        t.columns.push(
          column("id", "uuid", true, e.primaryKeyDefault || "uuid_generate_v4()")
        );
      } else if (pkType === "text") t.columns.push(column("id", "text", true));
      else
        t.columns.push(
          column(
            "id",
            "integer",
            true,
            `nextval('${table}_id_seq'::regclass)`,
            true
          )
        );
    }
    for (const stamp of ["created_at", "updated_at"] as const)
      if (e[stamp])
        t.columns.push(
          column(
            stamp,
            timestampTypeOf(e, stamp) === "timestamptz"
              ? "TIMESTAMP WITH TIME ZONE"
              : "TIMESTAMP",
            !timestampNullableOf(e, stamp),
            timestampDefaultOf(e, stamp) ? "now()" : undefined
          )
        );

    for (const f of getFieldForTemplate(e.fields ?? [], e.name)) {
      if (!customPk && f.name === "id") continue;
      if (e.created_at && f.name === "created_at") continue;
      if (e.updated_at && f.name === "updated_at") continue;
      if (f.type === "enum" && f.values)
        model.enums.push({
          name: enumTypeName(table, f.name),
          values: [...f.values],
        });
      const spec = columnSpec(table, f);
      t.columns.push(column(f.name, spec.type, spec.notNull, spec.default));
      if (spec.unique)
        unique(table, [f.name], constraintName.unique(table, [f.name]));
      if (spec.index) index(table, [f.name]);
    }

    // "indexes" and "uniques" may name a foreign key by its relationship.
    // A field wins over a relationship of the same name.
    const columnByName = relationColumns(relationships);
    for (const c of t.columns) columnByName.set(c.name, c.name);
    for (const i of e.indexes ?? [])
      index(
        table,
        i.fields.map((f) => columnByName.get(f) ?? f),
        i.unique,
        i.name,
        i.where
      );
    for (const i of e.sqlIndexes ?? [])
      model.indexes.push({
        key: `sqlindex:${table}:${i.name}(${i.columns})${
          i.where ? ` where ${i.where}` : ""
        }`,
        name: i.name,
        table,
        columns: [],
        columnsSql: i.columns,
        unique: Boolean(i.unique),
        ...(i.where && { where: i.where }),
      });
    for (const c of e.checks ?? []) {
      const name = c.name || constraintName.check(table, c.expression);
      // NOT VALID is allowed only on a constraint added by ALTER TABLE.
      const late = c.validate === false;
      (late ? foreignKeys : inline).push({
        key: `check:${table}:${name}`,
        name,
        table,
        kind: "check",
        columns: [],
        expression: c.expression,
        body: `CHECK (${c.expression})${late ? " NOT VALID" : ""}`,
        ...(late && { late }),
      });
    }
    for (const u of e.uniques ?? []) {
      const columns = u.fields.map((f) => columnByName.get(f) ?? f);
      unique(table, columns, u.name || constraintName.unique(table, columns));
    }

    for (const r of relationships) {
      const target = byName.get(r.name);
      if (!target) continue;
      const targetTable = tableName(target);
      // The template gives OneToOne onDelete CASCADE and a nullable join column.
      const oneToOne = r.type === "OneToOne";
      const onDelete = oneToOne ? "CASCADE" : onDeleteOf(r) ?? "NO ACTION";

      if (r.type === "ManyToOne" || (oneToOne && r.joinTable)) {
        const col = relationColumn(r);
        t.columns.push(column(col, fkType(target), !(r.nullable || oneToOne)));
        if (oneToOne)
          unique(table, [col], constraintName.relation(table, [col]));
        if (r.type === "ManyToOne" && r.index) index(table, [col]);
        foreignKey(
          table,
          col,
          targetTable,
          pkColumn(target),
          // NOT VALID exists only on a key added by ALTER TABLE, as these are.
          `ON DELETE ${onDelete} ON UPDATE NO ACTION${
            r.validate === false ? " NOT VALID" : ""
          }`,
          r.foreignKeyName || undefined
        );
      }

      if (r.type === "ManyToMany" && r.joinTable) {
        const { name: join, ownCol, otherCol } = joinTableOf(e, r, target);
        joinTables.push({
          name: join,
          columns: [
            column(ownCol, fkType(e), true),
            column(otherCol, fkType(target), true),
          ],
        });
        primaryKey(join, [ownCol, otherCol]);
        index(join, [ownCol]);
        index(join, [otherCol]);
        // TypeORM cascades the inverse key only when no inverse relation exists.
        const inverse = r.biDirectional ? "NO ACTION" : "CASCADE";
        foreignKey(
          join,
          ownCol,
          table,
          pkColumn(e),
          "ON DELETE CASCADE ON UPDATE CASCADE"
        );
        foreignKey(
          join,
          otherCol,
          targetTable,
          pkColumn(target),
          `ON DELETE ${inverse} ON UPDATE ${inverse}`
        );
      }
    }

    const keyColumns = customPk
      ? [
          ...(e.fields ?? []).filter((f) => f.primary).map((f) => f.name),
          ...relationKeys,
        ]
      : ["id"];
    primaryKey(table, keyColumns, inline, e.primaryKeyName || undefined);
    entityTables.unshift(t);
  }

  model.extensions = [...new Set(model.extensions)];
  model.tables = [...entityTables, ...joinTables];
  model.constraints = [...inline, ...foreignKeys];
  return model;
}

export const createTypeSql = (e: ModelEnum) =>
  `CREATE TYPE "public".${q(e.name)} AS ENUM(${e.values
    .map((v) => literal(v))
    .join(", ")})`;
export const createIndexSql = (i: ModelIndex) =>
  `CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(i.name)} ON ${q(
    i.table
  )} (${i.columnsSql ?? cols(i.columns)})${
    i.where ? ` WHERE ${i.where}` : ""
  }`;

/**
 * The statements that create an entity's "sqlIndexes", safe to run again:
 * a generated service runs them after TypeORM's schema sync, which cannot
 * create these indexes itself.
 *
 * @param {Entity} e - An entity from .apsorc.
 * @returns {string[]} One CREATE INDEX IF NOT EXISTS per entry.
 */
export const sqlIndexStatements = (e: Entity): string[] =>
  (e.sqlIndexes ?? []).map(
    (i) =>
      `CREATE ${i.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${q(i.name)} ON ${q(
        tableName(e)
      )} (${i.columns})${i.where ? ` WHERE ${i.where}` : ""}`
  );
export const addConstraintSql = (c: ModelConstraint) =>
  `ALTER TABLE ${q(c.table)} ADD CONSTRAINT ${q(c.name)} ${c.body}`;
export const createTableSql = (t: ModelTable, constraints: ModelConstraint[]) =>
  `CREATE TABLE ${q(t.name)} (${[
    ...t.columns.map((c) => c.sql),
    ...constraints
      .filter((c) => c.table === t.name && c.kind !== "fk" && !c.late)
      .map((c) => `CONSTRAINT ${q(c.name)} ${c.body}`),
  ].join(", ")})`;

/** CREATE statements for every enum type, table, index and foreign key. */
export function schemaDdl(input: SchemaInput): string[] {
  const m = schemaModel(input);
  return [
    ...m.extensions,
    ...m.enums.map((e) => createTypeSql(e)),
    ...m.tables.map((t) => createTableSql(t, m.constraints)),
    ...m.indexes.map((i) => createIndexSql(i)),
    ...m.constraints
      .filter((c) => c.kind === "fk" || c.late)
      .map((c) => addConstraintSql(c)),
  ];
}
