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
import { createHash } from "crypto";
import { Entity } from "../types/entity";
import { ComputedField } from "../types/field";
import { RelationshipMap } from "../types/relationship";
import { getFieldForTemplate } from "../utils/field";
import { snakeCase } from "../utils/casing";
import { getRelationshipForTemplate } from "../utils/relationships";

// TypeORM's own casing, used for join table and join column names.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const typeormCase = require("typeorm/util/StringUtils");

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
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
  index: (t: string, cols: string[]) =>
    "IDX_" + sha1(key(t, cols)).slice(0, 26),
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
      break;
    case "date":
      type = "date";
      break;
    case "timestamp":
      type = "TIMESTAMP";
      break;
    case "timestamptz":
      type = "TIMESTAMP WITH TIME ZONE";
      break;
    case "json":
    case "jsonb":
      type = "jsonb";
      break;
    case "json-plain":
      type = "json";
      break;
    default:
      // ponytail: spatial, range and other special templates; add each with a parity case.
      throw new Error(
        `The DDL writer does not support field type "${f.type}" yet (${table}.${f.name}).`
      );
  }
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
  kind: "pk" | "unique" | "fk";
  columns: string[];
  /** Everything after CONSTRAINT "name". */
  body: string;
  references?: string;
}

export interface ModelIndex {
  key: string;
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
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

const pkColumn = (e: Entity) =>
  (e.fields ?? []).find((f) => f.primary)?.name ?? "id";
const fkType = (target?: Entity) =>
  target?.primaryKeyType === "uuid" ? "uuid" : "integer";

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

  const index = (table: string, columns: string[], unique = false) =>
    model.indexes.push({
      key: `index:${table}(${columns.join(",")})`,
      name: constraintName.index(table, columns),
      table,
      columns,
      unique,
    });
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
  const primaryKey = (table: string, columns: string[], list = inline) =>
    list.push({
      key: `pk:${table}`,
      name: constraintName.primaryKey(table, columns),
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
    actions: string
  ) =>
    foreignKeys.push({
      key: `fk:${table}(${col})->${target}`,
      name: constraintName.foreignKey(table, [col]),
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
    const customPk = (e.fields ?? []).some((f) => f.primary);

    if (!customPk) {
      const pkType: string = e.primaryKeyType || "serial";
      if (pkType === "uuid") {
        model.extensions.push(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        t.columns.push(column("id", "uuid", true, "uuid_generate_v4()"));
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
    if (e.created_at)
      t.columns.push(column("created_at", "TIMESTAMP", true, "now()"));
    if (e.updated_at)
      t.columns.push(column("updated_at", "TIMESTAMP", true, "now()"));

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

    for (const i of e.indexes ?? []) index(table, i.fields, i.unique);
    for (const u of e.uniques ?? [])
      unique(table, u.fields, u.name || constraintName.unique(table, u.fields));

    for (const r of getRelationshipForTemplate(
      e.name,
      relationshipMap[e.name] || [],
      entities
    )) {
      const target = byName.get(r.name);
      if (!target) continue;
      const targetTable = tableName(target);
      // The template gives OneToOne onDelete CASCADE and a nullable join column.
      const oneToOne = r.type === "OneToOne";
      const onDelete = r.cascadeDelete || oneToOne ? "CASCADE" : "NO ACTION";

      if (r.type === "ManyToOne" || (oneToOne && r.joinTable)) {
        const col =
          r.type === "ManyToOne"
            ? r.camelCasedId
            : typeormCase.camelCase(`${r.relationshipName}_id`);
        t.columns.push(column(col, fkType(target), !(r.nullable || oneToOne)));
        if (oneToOne)
          unique(table, [col], constraintName.relation(table, [col]));
        if (r.type === "ManyToOne" && r.index) index(table, [col]);
        foreignKey(
          table,
          col,
          targetTable,
          pkColumn(target),
          `ON DELETE ${onDelete} ON UPDATE NO ACTION`
        );
      }

      if (r.type === "ManyToMany" && r.joinTable) {
        const join =
          r.joinTableName ||
          typeormCase.snakeCase(
            `${table}_${r.pluralizedRelationshipName}_${targetTable}`
          );
        const ownCol =
          r.joinColumnName || typeormCase.camelCase(`${table}_${pkColumn(e)}`);
        const otherCol =
          r.inverseJoinColumnName ||
          typeormCase.camelCase(`${targetTable}_${pkColumn(target)}`);
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

    primaryKey(
      table,
      customPk
        ? (e.fields ?? []).filter((f) => f.primary).map((f) => f.name)
        : ["id"]
    );
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
  )} (${cols(i.columns)})`;
export const addConstraintSql = (c: ModelConstraint) =>
  `ALTER TABLE ${q(c.table)} ADD CONSTRAINT ${q(c.name)} ${c.body}`;
export const createTableSql = (t: ModelTable, constraints: ModelConstraint[]) =>
  `CREATE TABLE ${q(t.name)} (${[
    ...t.columns.map((c) => c.sql),
    ...constraints
      .filter((c) => c.table === t.name && c.kind !== "fk")
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
      .filter((c) => c.kind === "fk")
      .map((c) => addConstraintSql(c)),
  ];
}
