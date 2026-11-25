/**
 * Database Import — conversion layer
 *
 * Turns an `IntrospectedSchema` (read from a live Postgres/Supabase database)
 * into a `.apsorc`-shaped object. This is a pure function: same input always
 * yields the same output and report, with no I/O — which keeps it exhaustively
 * unit-testable.
 *
 * The reverse type map here is the inverse of `fieldTypeToColumnType`
 * (src/lib/utils/field.ts). The FK-to-relationship logic mirrors how the
 * platform derives FK column names in `getRelationshipIdField`
 * (src/lib/utils/relationships/parse.ts) so imported relationships round-trip.
 */

import { camelCase } from "../utils/casing";
import { ENUM_NAME, fieldTypeToColumnType } from "../utils/field";
import {
  getRelationshipIdField,
  getRelationshipName,
} from "../utils/relationships/parse";
import { KeyRules, OnDelete, Relationship } from "../types/relationship";
import { Entity, TimestampColumn, TimestampType } from "../types/entity";
import {
  ImportReport,
  IntrospectedColumn,
  IntrospectedFk,
  IntrospectedSchema,
  IntrospectedTable,
} from "./types";

export interface ApsorcImportFieldOutput {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  default?: unknown;
  noDefault?: boolean;
  generated?: string;
  index?: boolean;
  values?: string[];
  enumName?: string;
  length?: number;
  precision?: number;
  scale?: number;
  primary?: boolean;
  elementType?: string;
}

export interface ApsorcImportEntityOutput {
  name: string;
  primaryKeyType?: "serial" | "bigserial" | "uuid" | "text";
  primaryKeyName?: string;
  primaryKeyDefault?: string | null;
  created_at?: boolean;
  updated_at?: boolean;
  timestampType?: Entity["timestampType"];
  timestampNullable?: Entity["timestampNullable"];
  fields?: ApsorcImportFieldOutput[];
  uniques?: Array<{ fields: string[]; name?: string }>;
  checks?: Array<{ name?: string; expression: string; validate?: boolean }>;
  foreignKeys?: Entity["foreignKeys"];
  timestampDefault?: Entity["timestampDefault"];
  sqlIndexes?: Array<{
    name: string;
    columns: string;
    unique?: boolean;
    where?: string;
  }>;
  indexes?: Array<{
    fields: string[];
    unique?: boolean;
    name?: string;
    where?: string;
  }>;
}

export interface ApsorcImportRelationshipOutput {
  from: string;
  to: string;
  type: "OneToMany" | "ManyToOne" | "ManyToMany" | "OneToOne";
  to_name?: string;
  nullable?: boolean;
  bi_directional?: boolean;
  cascadeDelete?: boolean;
  onDelete?: OnDelete;
  onUpdate?: OnDelete;
  deferrable?: KeyRules["deferrable"];
  joinColumnDefault?: string;
  foreignKeyName?: string;
  primary?: boolean;
  validate?: boolean;
  index?: boolean;
  joinColumnName?: string;
}

export interface ApsorcImportOutput {
  version: number;
  /** Set when the file is written: the existing file's, else typescript. */
  language?: string;
  rootFolder: string;
  apiType: string;
  entities: ApsorcImportEntityOutput[];
  relationships: ApsorcImportRelationshipOutput[];
}

/** Maps a Postgres udt_name to the closest `.apsorc` field type. */
const udtToApsorcType: Record<string, string> = {
  int2: "smallint",
  int4: "integer",
  int8: "bigint",
  float4: "real",
  float8: "double",
  numeric: "numeric",
  money: "money",
  bool: "boolean",
  varchar: "varchar",
  bpchar: "char",
  text: "text",
  uuid: "uuid",
  json: "json",
  jsonb: "jsonb",
  date: "date",
  timestamp: "timestamp",
  timestamptz: "timestamptz",
  time: "time",
  timetz: "timetz",
  bytea: "bytea",
  xml: "xml",
  inet: "inet",
  cidr: "inet",
  interval: "interval",
  tsvector: "tsvector",
  int4range: "int4range",
  // PostGIS — pass-through (these are also keys in fieldTypeToColumnType)
  point: "point",
  geometry: "geometry",
  geography: "geography",
};

const TIMESTAMP_UDTS = new Set(["timestamp", "timestamptz"]);
/** Field types whose templates write a literal default; others take SQL. */
const LITERAL_DEFAULT_TYPES = new Set([
  "text",
  "varchar",
  "char",
  "integer",
  "smallint",
  "bigint",
  "numeric",
  "decimal",
  "float",
  "double",
  "boolean",
  "enum",
]);
const AUTO_TIMESTAMP_DEFAULTS = new Set([
  "now()",
  "current_timestamp",
  "transaction_timestamp()",
  "clock_timestamp()",
]);

interface TypeResolution {
  type: string;
  /** Element type of an array column, when it is not text. */
  elementType?: string;
  /** True when the mapping loses information (arrays, unknown types). */
  lossy?: "array" | "defaulted";
}

/**
 * Resolve a column's `.apsorc` field type from its Postgres type. Postgres
 * arrays (udt_name starting with "_") collapse to `array`; user enums become
 * `enum`; unknown types fall back to `text`.
 */
export function pgTypeToApsorcType(col: IntrospectedColumn): TypeResolution {
  if (col.isEnum) {
    return { type: "enum" };
  }
  if (col.dataType === "ARRAY" || col.udtName.startsWith("_")) {
    // uuid[] must stay uuid[]: the element type is the udt without its "_".
    const element = udtToApsorcType[col.udtName.replace(/^_/, "")];
    if (!element) return { type: "array", lossy: "array" };
    return element === "text"
      ? { type: "array" }
      : { type: "array", elementType: element };
  }
  const mapped = udtToApsorcType[col.udtName];
  if (mapped) {
    return { type: mapped };
  }
  return { type: "text", lossy: "defaulted" };
}

/**
 * Translate a raw Postgres default expression into an `.apsorc` default value.
 * Returns `{ drop: true }` when the default cannot be represented (function
 * calls, sequence/uuid generators). Auto-timestamp and sequence defaults are
 * dropped silently by callers that handle them structurally.
 */
export function parseDefault(
  raw: string | null,
  apsorcType: string
): { value?: unknown; drop?: boolean } {
  if (raw === null) return {};

  const expr = raw.trim();
  const lower = expr.toLowerCase();

  // Sequence / generator / function defaults can't be a literal .apsorc value.
  if (
    lower.startsWith("nextval(") ||
    lower.startsWith("gen_random_uuid(") ||
    lower.startsWith("uuid_generate_v4(") ||
    AUTO_TIMESTAMP_DEFAULTS.has(lower)
  ) {
    return { drop: true };
  }

  // Strip a trailing ::type cast, e.g. 'active'::text or 0::integer.
  const withoutCast = expr.replace(/::[\s\w".[\]]+$/, "").trim();

  // Quoted string literal.
  if (withoutCast.startsWith("'") && withoutCast.endsWith("'")) {
    const inner = withoutCast.slice(1, -1).replace(/''/g, "'");
    return { value: inner };
  }

  if (lower === "true" || lower === "false") {
    return { value: lower === "true" };
  }

  if (/^-?\d+(\.\d+)?$/.test(withoutCast)) {
    if (apsorcType === "numeric" || apsorcType === "decimal") {
      return { value: withoutCast };
    }
    return { value: Number(withoutCast) };
  }

  // Anything else (function calls, complex expressions) — drop with a warning.
  return { drop: true };
}

/**
 * The column list of a btree index from pg_get_indexdef's
 * "CREATE INDEX name ON t USING btree (<columns>) [WHERE ...]". Undefined for
 * another index method, which .apsorc cannot express.
 *
 * @param {string} [definition] - pg_get_indexdef's output.
 * @returns {string | undefined} The text between the outer parentheses.
 */
export function indexColumnsSql(definition?: string): string | undefined {
  const start = definition?.indexOf(" USING btree (") ?? -1;
  if (!definition || start < 0) return undefined;
  const open = start + " USING btree ".length;
  let depth = 0;
  for (let i = open; i < definition.length; i++) {
    if (definition[i] === "(") depth++;
    if (definition[i] === ")" && --depth === 0)
      return definition.slice(open + 1, i);
  }
  return undefined;
}

/**
 * How a single-column foreign key is written to .apsorc: the relationship
 * name ("to_name" when the default would not do) and "joinColumnName" when
 * the generated column would differ from the source column, so an import
 * never renames a foreign key (apsoai/cli#241).
 *
 * A relationship named like one of the table's own columns would collide
 * with that field ("facility" text beside "facility_id"), so it gets another
 * name; the column is kept either way (apsoai/cli#250).
 *
 * @param {string} sourceColumn - The foreign key column in the source table.
 * @param {string} targetTable - The table it references.
 * @param {string[]} columns - The source table's column names.
 * @returns {object} toName and joinColumnName when needed, and the relationship's property name.
 */
export function foreignKeyNames(
  sourceColumn: string,
  targetTable: string,
  columns: string[] = []
): {
  toName?: string;
  joinColumnName?: string;
  property: string;
  renamed: boolean;
} {
  let { toName } = deriveToName(sourceColumn, targetTable);
  const natural = getRelationshipName({
    name: targetTable,
    type: "ManyToOne",
    referenceName: toName,
  });
  const renamed = columns.includes(natural);
  if (renamed) {
    toName = `${natural}Record`;
    for (let n = 2; columns.includes(toName); n++)
      toName = `${natural}Record${n}`;
  }
  const relationship: Relationship = {
    name: targetTable,
    type: "ManyToOne",
    referenceName: toName,
  };
  return {
    toName,
    joinColumnName:
      getRelationshipIdField(relationship) === sourceColumn
        ? undefined
        : sourceColumn,
    property: getRelationshipName(relationship),
    renamed,
  };
}

/**
 * Derive the relationship `to_name` so the platform regenerates a FK column
 * matching the source column. Returns `undefined` when the default naming
 * (`${camelCase(target)}Id`) already produces the source column. Sets
 * `unmapped: true` when no name round-trips to the source column.
 */
export function deriveToName(
  sourceColumn: string,
  targetTable: string
): { toName?: string; unmapped?: boolean } {
  // The platform always generates camelCase FK columns, while Postgres/Supabase
  // columns are typically snake_case. Compare on the camelCased form so a
  // snake_case source that is semantically identical isn't flagged as a mismatch.
  const source = camelCase(sourceColumn);
  const defaultColumn = getRelationshipIdField({
    name: targetTable,
    type: "ManyToOne",
  });
  if (defaultColumn === source) {
    return {};
  }

  // Strip a trailing Id / _id and use the remainder as the reference name.
  const base = sourceColumn.replace(/(_id|Id)$/, "");
  if (base && base !== sourceColumn) {
    const candidate = camelCase(base);
    const roundTrip = getRelationshipIdField({
      name: targetTable,
      type: "ManyToOne",
      referenceName: candidate,
    });
    if (roundTrip === source) {
      return { toName: candidate };
    }
  }

  // No relationship name generates this column; "joinColumnName" keeps it.
  return { toName: camelCase(base || sourceColumn), unmapped: true };
}

function emptyReport(schema: IntrospectedSchema): ImportReport {
  return {
    tablesImported: [],
    relationships: 0,
    viewsSkipped: schema.skipped.views,
    systemSchemasSkipped: schema.skipped.systemSchemas,
    warnings: {
      arraysLossy: [],
      foreignKeysNotCarried: [],
      checksNotValid: [],
      timestampDefaultsAdded: [],
      indexesNotCarried: [],
      relationshipsRenamed: [],
      compositePks: [],
      compositeFks: [],
      nonStandardPks: [],
      noPrimaryKey: [],
      typesDefaulted: [],
      defaultsDropped: [],
      joinTablesDetected: [],
    },
  };
}

function isJoinTable(table: IntrospectedTable): boolean {
  const singleColumnFkNames = table.foreignKeys
    .filter((fk) => fk.columns.length === 1)
    .map((fk) => fk.columns[0]);
  return (
    table.foreignKeys.length === 2 &&
    singleColumnFkNames.length === 2 &&
    table.primaryKey.length === 2 &&
    table.primaryKey.every((c) => singleColumnFkNames.includes(c))
  );
}

/**
 * Convert an introspected Postgres schema into a `.apsorc`-shaped object plus a
 * report of everything that could not be represented losslessly.
 */
export function pgToApsorc(schema: IntrospectedSchema): {
  apsorc: ApsorcImportOutput;
  report: ImportReport;
} {
  const report = emptyReport(schema);
  const enumLabels = new Map(schema.enums.map((e) => [e.name, e.labels]));
  const entities: ApsorcImportEntityOutput[] = [];
  const relationships: ApsorcImportRelationshipOutput[] = [];

  const keyByTable = new Map(schema.tables.map((t) => [t.name, t.primaryKey]));
  for (const table of schema.tables) {
    report.tablesImported.push(table.name);
    if (isJoinTable(table)) {
      report.warnings.joinTablesDetected.push(table.name);
    }

    const entity: ApsorcImportEntityOutput = { name: table.name };
    // Keep the source's constraint names, so a first migration against the
    // existing database does not drop and recreate every key.
    if (table.primaryKeyName) entity.primaryKeyName = table.primaryKeyName;

    // Columns covered by a single-column FK are materialized by the
    // relationship, so they must not also be emitted as scalar fields.
    // A relationship, like a "foreignKeys" entry, references the primary key
    // of an imported table. Any other single-column key is reported and its
    // column stays a plain field.
    const fkColumns = new Map<string, IntrospectedTable["foreignKeys"][number]>();
    const singleKeys: IntrospectedFk[] = [];
    for (const fk of table.foreignKeys) {
      if (fk.columns.length !== 1) {
        report.warnings.compositeFks.push(table.name);
        continue;
      }
      const targetKey = fk.referencedSchema
        ? []
        : keyByTable.get(fk.referencedTable);
      if (targetKey?.length !== 1 || targetKey[0] !== fk.referencedColumns[0]) {
        report.warnings.foreignKeysNotCarried.push(
          `${table.name}.${fk.name} (${fk.columns[0]} -> ${
            fk.referencedSchema ? `${fk.referencedSchema}.` : ""
          }${fk.referencedTable}.${fk.referencedColumns[0]})`
        );
        continue;
      }
      singleKeys.push(fk);
      // The first key on a column is the relationship's.
      if (!fkColumns.has(fk.columns[0])) fkColumns.set(fk.columns[0], fk);
    }

    // --- Primary key handling ---
    const pk = table.primaryKey;
    const pkSet = new Set(pk);
    let pkAsField = false;
    if (pk.length === 1) {
      const pkCol = table.columns.find((c) => c.name === pk[0]);
      if (pk[0] === "id" && pkCol) {
        const t = pgTypeToApsorcType(pkCol).type;
        // A varchar(n) or char(n) id is kept as a primary field, so its
        // length and the columns that reference it keep theirs.
        // integer/smallint id => default serial, omit primaryKeyType. A
        // bigint id stays 64 bits wide.
        if (t === "uuid" || t === "text") entity.primaryKeyType = t;
        else if (t === "bigint") entity.primaryKeyType = "bigserial";
        // The generated uuid id uses uuid_generate_v4(); keep another
        // function, and keep "no default" (the caller supplies the id).
        const idDefault = pkCol.default?.trim();
        if (t === "uuid" && !idDefault) entity.primaryKeyDefault = null;
        else if (t === "uuid" && idDefault !== "uuid_generate_v4()")
          entity.primaryKeyDefault = idDefault;
        else pkAsField = t === "varchar" || t === "char";
      } else {
        // Single, non-"id" PK: a primary field, or the relationship's own
        // key when the column is a foreign key (a table keyed by the row it
        // extends).
        pkAsField = true;
        const keyIsForeignKey = fkColumns.has(pk[0]);
        if (!keyIsForeignKey) report.warnings.nonStandardPks.push(table.name);
      }
    } else if (pk.length > 1) {
      pkAsField = true;
      report.warnings.compositePks.push(table.name);
    } else {
      report.warnings.noPrimaryKey.push(table.name);
    }

    // --- created_at / updated_at detection ---
    const autoTimestamps = new Set<string>();
    const stampTypes: Partial<Record<TimestampColumn, TimestampType>> = {};
    const stampNullable: Partial<Record<TimestampColumn, boolean>> = {};
    const stampDefault: Partial<Record<TimestampColumn, boolean>> = {};
    for (const name of ["created_at", "updated_at"] as const) {
      const col = table.columns.find((c) => c.name === name);
      if (col && TIMESTAMP_UDTS.has(col.udtName)) {
        entity[name] = true;
        autoTimestamps.add(name);
        stampTypes[name] = col.udtName as TimestampType;
        if (col.default === null) {
          stampDefault[name] = false;
          report.warnings.timestampDefaultsAdded.push(`${table.name}.${name}`);
        }
        stampNullable[name] = col.nullable;
      }
    }
    if (Object.keys(stampDefault).length > 0)
      entity.timestampDefault =
        autoTimestamps.size === Object.keys(stampDefault).length
          ? false
          : stampDefault;
    const nullable = [...new Set(Object.values(stampNullable))];
    if (nullable.length > 1) entity.timestampNullable = stampNullable;
    else if (nullable[0]) entity.timestampNullable = true;
    // Keep the source types: one value when the columns agree (nothing when
    // that is the default "timestamp"), one per column when they differ.
    const stamps = [...new Set(Object.values(stampTypes))];
    if (stamps.length > 1) entity.timestampType = stampTypes;
    else if (stamps[0] === "timestamptz") entity.timestampType = "timestamptz";

    // --- Fields ---
    const uniqueSingle = new Set<string>();
    const uniqueComposite: Array<{ fields: string[]; name?: string }> = [];
    // A foreign key column is not a field: indexes and uniques name the
    // relationship that owns it, which the generators resolve to the column.
    const columnNames = table.columns.map((c) => c.name);
    const fkProperty = new Map<string, string>();
    for (const [column, fk] of fkColumns)
      fkProperty.set(
        column,
        foreignKeyNames(column, fk.referencedTable, columnNames).property
      );
    for (const uc of table.uniqueConstraints) {
      // A field's "unique": true gets a generated name, so a constraint the
      // source names goes in "uniques", which carries the name.
      if (uc.columns.length === 1 && !fkColumns.has(uc.columns[0]) && !uc.name)
        uniqueSingle.add(uc.columns[0]);
      else
        uniqueComposite.push({
          fields: uc.columns.map((c) => fkProperty.get(c) ?? c),
          name: uc.name,
        });
    }

    // Every index is an "indexes" entry with the source's name and WHERE
    // condition, so it is rebuilt as it was. A field's or a relationship's
    // "index": true would get a generated name.
    const indexes: NonNullable<ApsorcImportEntityOutput["indexes"]> = [];
    const sqlIndexes: NonNullable<ApsorcImportEntityOutput["sqlIndexes"]> = [];
    for (const idx of table.indexes) {
      const cols = idx.columns;
      // Skip the index Postgres itself creates for the primary key or a
      // unique constraint: it has the constraint's name. A separate index on
      // the same columns is the source's own and is kept.
      const backsConstraint =
        idx.name === table.primaryKeyName ||
        table.uniqueConstraints.some((uc) => uc.name === idx.name);
      if (backsConstraint) continue;
      // An index on an expression or with a DESC column goes in "sqlIndexes"
      // with its column list as Postgres prints it (apsoai/cli#249).
      if (idx.expression || idx.descending) {
        const columns = indexColumnsSql(idx.definition);
        if (columns === undefined) {
          report.warnings.indexesNotCarried.push(
            `${idx.definition ?? idx.name} (not imported)`
          );
        } else {
          sqlIndexes.push({
            name: idx.name,
            columns,
            ...(idx.unique && { unique: true }),
            ...(idx.predicate && { where: idx.predicate }),
          });
        }
        continue;
      }
      indexes.push({
        fields: cols.map((c) => fkProperty.get(c) ?? c),
        ...(idx.unique && { unique: true }),
        name: idx.name,
        ...(idx.predicate && { where: idx.predicate }),
      });
    }

    const fields: ApsorcImportFieldOutput[] = [];
    const sortedColumns = [...table.columns].sort(
      (a, b) => a.ordinal - b.ordinal
    );
    for (const col of sortedColumns) {
      // Skip columns represented elsewhere.
      if (fkColumns.has(col.name)) continue;
      if (autoTimestamps.has(col.name)) continue;
      if (pk.length === 1 && col.name === pk[0] && !pkAsField) continue;

      const resolved = pgTypeToApsorcType(col);
      if (resolved.lossy === "array") {
        report.warnings.arraysLossy.push(`${table.name}.${col.name}`);
      } else if (resolved.lossy === "defaulted") {
        report.warnings.typesDefaulted.push({
          column: `${table.name}.${col.name}`,
          udt: col.udtName,
        });
      }

      const field: ApsorcImportFieldOutput = {
        name: col.name,
        type: resolved.type,
      };
      if (resolved.elementType) field.elementType = resolved.elementType;
      if (col.nullable) field.nullable = true;
      if (uniqueSingle.has(col.name)) field.unique = true;
      if (pkSet.has(col.name) && pkAsField) field.primary = true;
      if (col.generated) field.generated = col.generated;

      if ((resolved.type === "varchar" || resolved.type === "char") && col.charMaxLength) field.length = col.charMaxLength;
      if (resolved.type === "numeric" || resolved.type === "decimal") {
        if (col.numericPrecision) field.precision = col.numericPrecision;
        if (col.numericScale !== null) field.scale = col.numericScale;
      }

      if (resolved.type === "enum") {
        const labels = col.enumTypeName
          ? enumLabels.get(col.enumTypeName)
          : undefined;
        if (labels) field.values = labels;
        // Always stated: the name TypeORM derives folds the column's case,
        // and two columns may share one type.
        if (col.enumTypeName && ENUM_NAME.test(col.enumTypeName))
          field.enumName = col.enumTypeName;
      }

      // Defaults (skip for PK columns — those are implicit/sequence-driven).
      if (!(pkSet.has(col.name) && !pkAsField) && !col.generated) {
        const parsed = parseDefault(col.default, resolved.type);
        const literal =
          "value" in parsed && LITERAL_DEFAULT_TYPES.has(resolved.type);
        if (col.default === null) {
          // A boolean field gets DEFAULT false unless it says otherwise, and
          // an enum field its first value unless its default is null.
          if (resolved.type === "boolean") field.noDefault = true;
          else if (resolved.type === "enum") field.default = null;
        } else if (col.default.trim().toLowerCase().startsWith("nextval(")) {
          // A sequence .apsorc does not create.
          report.warnings.defaultsDropped.push(`${table.name}.${col.name}`);
        } else if (!literal) {
          // A function call, an expression or a literal the field's template
          // cannot write (json, array, date, uuid): kept as Postgres prints it.
          field.default = { sql: col.default };
        } else if ("value" in parsed) {
          if (resolved.type === "enum") {
            // Only keep an enum default that is one of the allowed labels.
            if (field.values && field.values.includes(String(parsed.value))) {
              field.default = parsed.value;
            } else {
              report.warnings.defaultsDropped.push(
                `${table.name}.${col.name}`
              );
            }
          } else {
            field.default = parsed.value;
          }
        }
      }

      fields.push(field);
    }

    if (fields.length > 0) entity.fields = fields;
    if (uniqueComposite.length > 0) entity.uniques = uniqueComposite;
    if (indexes.length > 0) entity.indexes = indexes;
    if (sqlIndexes.length > 0) entity.sqlIndexes = sqlIndexes;
    const checks = table.checks ?? [];
    if (checks.length > 0)
      entity.checks = checks.map((c) => ({
        name: c.name,
        expression: c.expression,
        ...(c.notValid && { validate: false }),
      }));
    for (const c of checks)
      if (c.notValid)
        report.warnings.checksNotValid.push(`${table.name}.${c.name}`);
    entities.push(entity);

    // --- Foreign keys -> ManyToOne relationships ---
    const keyed = new Set<string>();
    for (const fk of singleKeys) {
      const sourceColumn = fk.columns[0];
      // A relationship holds one key per column. A second key on the same
      // column (usually an exact duplicate) is kept as a constraint only.
      if (keyed.has(sourceColumn)) {
        // Postgres names every constraint, so the name is always there.
        (entity.foreignKeys ??= []).push({
          name: fk.name ?? "",
          column: sourceColumn,
          to: fk.referencedTable,
          ...(fk.onDelete !== "NO ACTION" && { onDelete: fk.onDelete }),
          ...keyRules(fk),
        });
        continue;
      }
      keyed.add(sourceColumn);
      const col = table.columns.find((c) => c.name === sourceColumn);
      const rel: ApsorcImportRelationshipOutput = {
        from: table.name,
        to: fk.referencedTable,
        type: "ManyToOne",
      };
      const { toName, joinColumnName, property, renamed } = foreignKeyNames(
        sourceColumn,
        fk.referencedTable,
        columnNames
      );
      if (renamed)
        report.warnings.relationshipsRenamed.push(
          `${table.name}.${sourceColumn} is relationship "${property}"`
        );
      if (toName) rel.to_name = toName;
      if (joinColumnName) rel.joinColumnName = joinColumnName;
      if (fk.name) rel.foreignKeyName = fk.name;
      if (pkSet.has(sourceColumn)) rel.primary = true;
      Object.assign(rel, keyRules(fk));
      // The relationship makes the column, so it carries the default too.
      if (col?.default?.trim().toLowerCase().startsWith("nextval("))
        report.warnings.defaultsDropped.push(`${table.name}.${col.name}`);
      else if (col?.default) rel.joinColumnDefault = col.default;
      if (col?.nullable) rel.nullable = true;
      if (fk.onDelete === "CASCADE") rel.cascadeDelete = true;
      else if (fk.onDelete !== "NO ACTION") rel.onDelete = fk.onDelete;
      relationships.push(rel);
    }
  }

  report.relationships = relationships.length;

  return {
    apsorc: {
      version: 2,
      rootFolder: "src",
      apiType: "rest",
      entities,
      relationships,
    },
    report,
  };
}

/**
 * A source key's ON UPDATE rule, DEFERRABLE setting and NOT VALID mark, as
 * .apsorc states them on a relationship or a "foreignKeys" entry.
 * Migrations keep a key NOT VALID. A database built by TypeORM's own schema
 * sync has it validated, which only matters on an empty one.
 *
 * @param {IntrospectedFk} fk - The key as read from the source database.
 * @returns {KeyRules} Only the settings that differ from the defaults.
 */
const keyRules = (fk: IntrospectedFk): KeyRules => ({
  ...(fk.onUpdate && { onUpdate: fk.onUpdate }),
  ...(fk.deferrable && { deferrable: fk.deferrable }),
  ...(fk.notValid && { validate: false }),
});

/**
 * Invariant guard: every emitted field type must be a recognized `.apsorc`
 * column type, so code generation never silently falls back to varchar.
 * Returns the list of any offending types (empty when valid).
 */
export function findUnknownEmittedTypes(output: ApsorcImportOutput): string[] {
  const unknown: string[] = [];
  for (const entity of output.entities) {
    for (const field of entity.fields ?? []) {
      if (field.type === "enum") continue; // enum dispatched separately
      if (!(field.type in fieldTypeToColumnType)) unknown.push(field.type);
    }
  }
  return unknown;
}
