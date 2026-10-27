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
import {
  RelationshipMap,
  RelationshipForTemplate,
} from "../types/relationship";
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
      // The template writes `Boolean(field.default) || false`, so a missing
      // default (computed as the string "false") becomes true.
      type = "boolean";
      def = String(Boolean(f.default) || false);
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
  return { sql, unique, index: Boolean(f.index) };
}

export interface SchemaInput {
  entities: Entity[];
  relationshipMap: RelationshipMap;
}

const index = (table: string, cols: string[], unique = false) =>
  `CREATE ${unique ? "UNIQUE " : ""}INDEX ${q(
    constraintName.index(table, cols)
  )} ON ${q(table)} (${cols.map((c) => q(c)).join(", ")})`;

const pkColumn = (e: Entity) =>
  (e.fields ?? []).find((f) => f.primary)?.name ?? "id";
const fkType = (target?: Entity) =>
  target?.primaryKeyType === "uuid" ? "uuid" : "integer";

/** CREATE statements for every enum type, table, index and foreign key. */
export function schemaDdl(input: SchemaInput): string[] {
  const { entities, relationshipMap } = input;
  const byName = new Map(entities.map((e) => [e.name, e]));
  const prelude: string[] = [];
  const enums: string[] = [];
  const tables: string[] = [];
  const indexes: string[] = [];
  const foreignKeys: string[] = [];

  const rels = (e: Entity): RelationshipForTemplate[] =>
    getRelationshipForTemplate(e.name, relationshipMap[e.name] || [], entities);

  for (const e of entities) {
    const table = tableName(e);
    const cols: string[] = [];
    const constraints: string[] = [];
    const customPk = (e.fields ?? []).some((f) => f.primary);

    if (!customPk) {
      const pkType: string = e.primaryKeyType || "serial";
      if (pkType === "uuid") {
        prelude.push(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        cols.push(`"id" uuid NOT NULL DEFAULT uuid_generate_v4()`);
      } else if (pkType === "text") cols.push(`"id" text NOT NULL`);
      else cols.push(`"id" SERIAL NOT NULL`);
    }
    if (e.created_at)
      cols.push(`"created_at" TIMESTAMP NOT NULL DEFAULT now()`);
    if (e.updated_at)
      cols.push(`"updated_at" TIMESTAMP NOT NULL DEFAULT now()`);

    for (const f of getFieldForTemplate(e.fields ?? [], e.name)) {
      if (!customPk && f.name === "id") continue;
      if (e.created_at && f.name === "created_at") continue;
      if (e.updated_at && f.name === "updated_at") continue;
      if (f.type === "enum" && f.values)
        enums.push(
          `CREATE TYPE "public".${q(
            enumTypeName(table, f.name)
          )} AS ENUM(${f.values.map((v) => literal(v)).join(", ")})`
        );
      const spec = columnSpec(table, f);
      cols.push(spec.sql);
      if (spec.unique)
        constraints.push(
          `CONSTRAINT ${q(constraintName.unique(table, [f.name]))} UNIQUE (${q(
            f.name
          )})`
        );
      if (spec.index) indexes.push(index(table, [f.name]));
    }

    for (const i of e.indexes ?? [])
      indexes.push(index(table, i.fields, i.unique));
    for (const u of e.uniques ?? [])
      constraints.push(
        `CONSTRAINT ${q(
          u.name || constraintName.unique(table, u.fields)
        )} UNIQUE (${u.fields.map((c) => q(c)).join(", ")})`
      );

    for (const r of rels(e)) {
      const target = byName.get(r.name);
      if (!target) continue;
      const targetTable = tableName(target);
      // The template gives OneToOne onDelete CASCADE and a nullable join column.
      const oneToOne = r.type === "OneToOne";
      const onDelete = r.cascadeDelete || oneToOne ? "CASCADE" : "NO ACTION";

      if (r.type === "ManyToOne" || (r.type === "OneToOne" && r.joinTable)) {
        const col =
          r.type === "ManyToOne"
            ? r.camelCasedId
            : typeormCase.camelCase(`${r.relationshipName}_id`);
        cols.push(
          `${q(col)} ${fkType(target)}${
            r.nullable || oneToOne ? "" : " NOT NULL"
          }`
        );
        if (r.type === "OneToOne")
          constraints.push(
            `CONSTRAINT ${q(constraintName.relation(table, [col]))} UNIQUE (${q(
              col
            )})`
          );
        if (r.type === "ManyToOne" && r.index)
          indexes.push(index(table, [col]));
        foreignKeys.push(
          `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(
            constraintName.foreignKey(table, [col])
          )} FOREIGN KEY (${q(col)}) REFERENCES ${q(targetTable)}(${q(
            pkColumn(target)
          )}) ON DELETE ${onDelete} ON UPDATE NO ACTION`
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
        tables.push(
          `CREATE TABLE ${q(join)} (${q(ownCol)} ${fkType(e)} NOT NULL, ${q(
            otherCol
          )} ${fkType(target)} NOT NULL, ` +
            `CONSTRAINT ${q(
              constraintName.primaryKey(join, [ownCol, otherCol])
            )} PRIMARY KEY (${q(ownCol)}, ${q(otherCol)}))`
        );
        indexes.push(index(join, [ownCol]), index(join, [otherCol]));
        // TypeORM cascades the inverse key only when no inverse relation exists.
        const inverse = r.biDirectional ? "NO ACTION" : "CASCADE";
        foreignKeys.push(
          `ALTER TABLE ${q(join)} ADD CONSTRAINT ${q(
            constraintName.foreignKey(join, [ownCol])
          )} FOREIGN KEY (${q(ownCol)}) REFERENCES ${q(table)}(${q(
            pkColumn(e)
          )}) ON DELETE CASCADE ON UPDATE CASCADE`,
          `ALTER TABLE ${q(join)} ADD CONSTRAINT ${q(
            constraintName.foreignKey(join, [otherCol])
          )} FOREIGN KEY (${q(otherCol)}) REFERENCES ${q(targetTable)}(${q(
            pkColumn(target)
          )}) ON DELETE ${inverse} ON UPDATE ${inverse}`
        );
      }
    }

    const pkCols = customPk
      ? (e.fields ?? []).filter((f) => f.primary).map((f) => f.name)
      : ["id"];
    constraints.push(
      `CONSTRAINT ${q(
        constraintName.primaryKey(table, pkCols)
      )} PRIMARY KEY (${pkCols.map((c) => q(c)).join(", ")})`
    );
    tables.unshift(
      `CREATE TABLE ${q(table)} (${[...cols, ...constraints].join(", ")})`
    );
  }

  return [...new Set(prelude), ...enums, ...tables, ...indexes, ...foreignKeys];
}
