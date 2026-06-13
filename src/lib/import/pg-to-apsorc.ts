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
import { fieldTypeToColumnType } from "../utils/field";
import { getRelationshipIdField } from "../utils/relationships";
import {
  ImportReport,
  IntrospectedColumn,
  IntrospectedSchema,
  IntrospectedTable,
} from "./types";

export interface ApsorcImportFieldOutput {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  default?: unknown;
  index?: boolean;
  values?: string[];
  length?: number;
  precision?: number;
  scale?: number;
  primary?: boolean;
}

export interface ApsorcImportEntityOutput {
  name: string;
  primaryKeyType?: "serial" | "uuid" | "text";
  created_at?: boolean;
  updated_at?: boolean;
  fields?: ApsorcImportFieldOutput[];
  uniques?: Array<{ fields: string[]; name?: string }>;
  indexes?: Array<{ fields: string[]; unique?: boolean }>;
}

export interface ApsorcImportRelationshipOutput {
  from: string;
  to: string;
  type: "OneToMany" | "ManyToOne" | "ManyToMany" | "OneToOne";
  to_name?: string;
  nullable?: boolean;
  bi_directional?: boolean;
  cascadeDelete?: boolean;
}

export interface ApsorcImportOutput {
  version: number;
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
const AUTO_TIMESTAMP_DEFAULTS = new Set([
  "now()",
  "current_timestamp",
  "transaction_timestamp()",
  "clock_timestamp()",
]);

interface TypeResolution {
  type: string;
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
    return { type: "array", lossy: "array" };
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

  // Best-effort: emit a reference name but flag that the generated FK column
  // may not match the source column exactly.
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
      compositePks: [],
      compositeFks: [],
      nonStandardPks: [],
      noPrimaryKey: [],
      typesDefaulted: [],
      fkColumnNameUnmapped: [],
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

  for (const table of schema.tables) {
    report.tablesImported.push(table.name);
    if (isJoinTable(table)) {
      report.warnings.joinTablesDetected.push(table.name);
    }

    const entity: ApsorcImportEntityOutput = { name: table.name };

    // Columns covered by a single-column FK are materialized by the
    // relationship, so they must not also be emitted as scalar fields.
    const fkColumns = new Map<string, IntrospectedTable["foreignKeys"][number]>();
    for (const fk of table.foreignKeys) {
      if (fk.columns.length === 1) {
        fkColumns.set(fk.columns[0], fk);
      } else {
        report.warnings.compositeFks.push(table.name);
      }
    }

    // --- Primary key handling ---
    const pk = table.primaryKey;
    const pkSet = new Set(pk);
    let pkAsField = false;
    if (pk.length === 1) {
      const pkCol = table.columns.find((c) => c.name === pk[0]);
      if (pk[0] === "id" && pkCol) {
        const t = pgTypeToApsorcType(pkCol).type;
        if (t === "uuid") entity.primaryKeyType = "uuid";
        else if (t === "text" || t === "varchar") entity.primaryKeyType = "text";
        // integer/bigint/smallint id => default serial, omit primaryKeyType.
      } else {
        // Single, non-"id" PK: emit it as a primary field.
        pkAsField = true;
        report.warnings.nonStandardPks.push(table.name);
      }
    } else if (pk.length > 1) {
      pkAsField = true;
      report.warnings.compositePks.push(table.name);
    } else {
      report.warnings.noPrimaryKey.push(table.name);
    }

    // --- created_at / updated_at detection ---
    const autoTimestamps = new Set<string>();
    for (const name of ["created_at", "updated_at"] as const) {
      const col = table.columns.find((c) => c.name === name);
      if (col && TIMESTAMP_UDTS.has(col.udtName)) {
        entity[name] = true;
        autoTimestamps.add(name);
      }
    }

    // --- Fields ---
    const uniqueSingle = new Set<string>();
    const uniqueComposite: Array<{ fields: string[]; name?: string }> = [];
    for (const uc of table.uniqueConstraints) {
      if (uc.columns.length === 1) uniqueSingle.add(uc.columns[0]);
      else uniqueComposite.push({ fields: uc.columns, name: uc.name });
    }

    const indexSingle = new Set<string>();
    const indexComposite: Array<{ fields: string[]; unique?: boolean }> = [];
    for (const idx of table.indexes) {
      const cols = idx.columns;
      // Skip indexes that merely back the PK or a unique constraint.
      const backsPk =
        cols.length === pk.length && cols.every((c) => pkSet.has(c));
      const backsUnique = table.uniqueConstraints.some(
        (uc) =>
          uc.columns.length === cols.length &&
          uc.columns.every((c) => cols.includes(c))
      );
      if (backsPk || backsUnique) continue;
      if (cols.length === 1) indexSingle.add(cols[0]);
      else indexComposite.push({ fields: cols, unique: idx.unique });
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
      if (col.nullable) field.nullable = true;
      if (uniqueSingle.has(col.name)) field.unique = true;
      if (indexSingle.has(col.name)) field.index = true;
      if (pkSet.has(col.name) && pkAsField) field.primary = true;

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
      }

      // Defaults (skip for PK columns — those are implicit/sequence-driven).
      if (!(pkSet.has(col.name) && !pkAsField)) {
        const parsed = parseDefault(col.default, resolved.type);
        if (parsed.drop && col.default !== null) {
          report.warnings.defaultsDropped.push(`${table.name}.${col.name}`);
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
    if (indexComposite.length > 0) entity.indexes = indexComposite;
    entities.push(entity);

    // --- Foreign keys -> ManyToOne relationships ---
    for (const fk of table.foreignKeys) {
      if (fk.columns.length !== 1) continue; // composite FK handled above
      const sourceColumn = fk.columns[0];
      const col = table.columns.find((c) => c.name === sourceColumn);
      const rel: ApsorcImportRelationshipOutput = {
        from: table.name,
        to: fk.referencedTable,
        type: "ManyToOne",
      };
      const { toName, unmapped } = deriveToName(sourceColumn, fk.referencedTable);
      if (toName) rel.to_name = toName;
      if (unmapped) {
        report.warnings.fkColumnNameUnmapped.push(
          `${table.name}.${sourceColumn}`
        );
      }
      if (col?.nullable) rel.nullable = true;
      if (fk.onDelete === "CASCADE") rel.cascadeDelete = true;
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
