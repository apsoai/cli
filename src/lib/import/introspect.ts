/**
 * Database Import — introspection layer
 *
 * Reads the schema of a live Postgres/Supabase database. This layer is
 * deliberately thin and side-effect-light: it only issues read-only SELECTs
 * against information_schema/pg_catalog and returns an `IntrospectedSchema`.
 * All interpretation lives in the conversion layer (pg-to-apsorc.ts).
 *
 * `pg` is loaded lazily so importing this module (e.g. from the command) does
 * not pull the driver until an actual connection is made.
 */

import {
  IntrospectedColumn,
  IntrospectedEnum,
  IntrospectedFk,
  IntrospectedSchema,
  IntrospectedTable,
  Introspector,
  OnDeleteAction,
} from "./types";

/** Supabase- and Postgres-managed schemas we never import from. */
export const SYSTEM_SCHEMAS = new Set([
  "auth",
  "storage",
  "realtime",
  "_realtime",
  "vault",
  "extensions",
  "graphql",
  "graphql_public",
  "pgsodium",
  "pgsodium_masks",
  "pgbouncer",
  "cron",
  "net",
  "supabase_functions",
  "supabase_migrations",
  "_analytics",
  "information_schema",
  "pg_catalog",
  "pg_toast",
]);

const CONFDELTYPE_TO_ACTION: Record<string, OnDeleteAction> = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

/** Strip credentials from a connection string for safe display in errors. */
export function redactConnectionString(input: string): string {
  return input.replace(/(\/\/[^/:@]+:)[^@]*(@)/, "$1****$2");
}

interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
}

/**
 * Reads schema metadata from a Postgres database via a connection string.
 * SSL is enabled by default (Supabase requires it).
 */
export class PgIntrospector implements Introspector {
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  private async connect(): Promise<QueryClient> {
    // Lazy import keeps `pg` out of the module graph until we actually connect.
    const pg = await import("pg");
    const Client = (pg as any).Client ?? (pg as any).default?.Client;
    const client = new Client({
      connectionString: this.connectionString,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    return client as QueryClient;
  }

  async introspect(schema: string): Promise<IntrospectedSchema> {
    let client: QueryClient | undefined;
    try {
      client = await this.connect();

      const [
        tableRows,
        columnRows,
        pkRows,
        fkRows,
        uniqueRows,
        indexRows,
        enumRows,
        schemaRows,
      ] = [
        await client.query(TABLES_SQL, [schema]),
        await client.query(COLUMNS_SQL, [schema]),
        await client.query(PRIMARY_KEYS_SQL, [schema]),
        await client.query(FOREIGN_KEYS_SQL, [schema]),
        await client.query(UNIQUE_SQL, [schema]),
        await client.query(INDEXES_SQL, [schema]),
        await client.query(ENUMS_SQL, [schema]),
        await client.query(SCHEMAS_SQL),
      ];

      return buildSchema(schema, {
        tableRows: tableRows.rows,
        columnRows: columnRows.rows,
        pkRows: pkRows.rows,
        fkRows: fkRows.rows,
        uniqueRows: uniqueRows.rows,
        indexRows: indexRows.rows,
        enumRows: enumRows.rows,
        schemaRows: schemaRows.rows,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to introspect database: ${redactConnectionString(message)}`
      );
    } finally {
      if (client) await client.end();
    }
  }
}

const TABLES_SQL = `
  SELECT table_name, table_type
  FROM information_schema.tables
  WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW')
  ORDER BY table_name`;

const COLUMNS_SQL = `
  SELECT table_name, column_name, udt_name, data_type, is_nullable,
         column_default, character_maximum_length, numeric_precision,
         numeric_scale, ordinal_position
  FROM information_schema.columns
  WHERE table_schema = $1
  ORDER BY table_name, ordinal_position`;

const PRIMARY_KEYS_SQL = `
  SELECT cl.relname AS table_name, att.attname AS column_name, ord.n AS key_index
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = cl.relnamespace
  JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, n) ON true
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.attnum
  WHERE con.contype = 'p' AND ns.nspname = $1
  ORDER BY cl.relname, ord.n`;

const FOREIGN_KEYS_SQL = `
  SELECT con.conname, cl.relname AS table_name, att.attname AS column_name,
         clf.relname AS referenced_table, attf.attname AS referenced_column,
         con.confdeltype, ord.n AS key_index
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = cl.relnamespace
  JOIN pg_class clf ON clf.oid = con.confrelid
  JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, n) ON true
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.attnum
  JOIN pg_attribute attf ON attf.attrelid = con.confrelid AND attf.attnum = con.confkey[ord.n]
  WHERE con.contype = 'f' AND ns.nspname = $1
  ORDER BY con.conname, ord.n`;

const UNIQUE_SQL = `
  SELECT con.conname, cl.relname AS table_name, att.attname AS column_name, ord.n AS key_index
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = cl.relnamespace
  JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, n) ON true
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.attnum
  WHERE con.contype = 'u' AND ns.nspname = $1
  ORDER BY con.conname, ord.n`;

const INDEXES_SQL = `
  SELECT tc.relname AS table_name, ic.relname AS index_name,
         a.attname AS column_name, ix.indisunique, k.n AS ord
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace ns ON ns.oid = tc.relnamespace
  JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n) ON true
  JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = k.attnum
  WHERE ns.nspname = $1 AND ix.indisprimary = false
  ORDER BY tc.relname, ic.relname, k.n`;

const ENUMS_SQL = `
  SELECT t.typname AS enum_name, e.enumlabel AS label
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = $1
  ORDER BY t.typname, e.enumsortorder`;

const SCHEMAS_SQL = `SELECT schema_name FROM information_schema.schemata`;

interface RawRows {
  tableRows: any[];
  columnRows: any[];
  pkRows: any[];
  fkRows: any[];
  uniqueRows: any[];
  indexRows: any[];
  enumRows: any[];
  schemaRows: any[];
}

/**
 * Assemble raw query rows into an IntrospectedSchema. Exported (separate from
 * the DB connection) so it can be unit-tested with fixture rows.
 */
export function buildSchema(schema: string, raw: RawRows): IntrospectedSchema {
  // Enums
  const enumMap = new Map<string, string[]>();
  for (const row of raw.enumRows) {
    const list = enumMap.get(row.enum_name) ?? [];
    list.push(row.label);
    enumMap.set(row.enum_name, list);
  }
  const enums: IntrospectedEnum[] = [...enumMap.entries()].map(
    ([name, labels]) => ({ name, labels })
  );

  // Tables / views
  const baseTables = raw.tableRows
    .filter((r) => r.table_type === "BASE TABLE")
    .map((r) => r.table_name as string);
  const views = raw.tableRows
    .filter((r) => r.table_type === "VIEW")
    .map((r) => r.table_name as string);

  // Columns grouped by table
  const columnsByTable = new Map<string, IntrospectedColumn[]>();
  for (const row of raw.columnRows) {
    const isEnum =
      row.data_type === "USER-DEFINED" && enumMap.has(row.udt_name);
    const col: IntrospectedColumn = {
      name: row.column_name,
      udtName: row.udt_name,
      dataType: row.data_type,
      nullable: row.is_nullable === "YES",
      default: row.column_default ?? null,
      charMaxLength: row.character_maximum_length ?? null,
      numericPrecision: row.numeric_precision ?? null,
      numericScale: row.numeric_scale ?? null,
      ordinal: row.ordinal_position,
      isEnum,
      enumTypeName: isEnum ? row.udt_name : undefined,
    };
    const list = columnsByTable.get(row.table_name) ?? [];
    list.push(col);
    columnsByTable.set(row.table_name, list);
  }

  // Primary keys
  const pkByTable = new Map<string, string[]>();
  for (const row of raw.pkRows) {
    const list = pkByTable.get(row.table_name) ?? [];
    list.push(row.column_name);
    pkByTable.set(row.table_name, list);
  }

  // Foreign keys (grouped by constraint name to handle composite keys)
  const fkByConstraint = new Map<
    string,
    { table: string; columns: string[]; refTable: string; refColumns: string[]; confdeltype: string }
  >();
  for (const row of raw.fkRows) {
    const existing = fkByConstraint.get(row.conname);
    if (existing) {
      existing.columns.push(row.column_name);
      existing.refColumns.push(row.referenced_column);
    } else {
      fkByConstraint.set(row.conname, {
        table: row.table_name,
        columns: [row.column_name],
        refTable: row.referenced_table,
        refColumns: [row.referenced_column],
        confdeltype: row.confdeltype,
      });
    }
  }
  const fksByTable = new Map<string, IntrospectedFk[]>();
  for (const fk of fkByConstraint.values()) {
    const list = fksByTable.get(fk.table) ?? [];
    list.push({
      columns: fk.columns,
      referencedTable: fk.refTable,
      referencedColumns: fk.refColumns,
      onDelete: CONFDELTYPE_TO_ACTION[fk.confdeltype] ?? "NO ACTION",
    });
    fksByTable.set(fk.table, list);
  }

  // Unique constraints (grouped by constraint name)
  const uniqueByConstraint = new Map<
    string,
    { table: string; columns: string[] }
  >();
  for (const row of raw.uniqueRows) {
    const existing = uniqueByConstraint.get(row.conname);
    if (existing) existing.columns.push(row.column_name);
    else
      uniqueByConstraint.set(row.conname, {
        table: row.table_name,
        columns: [row.column_name],
      });
  }
  const uniquesByTable = new Map<
    string,
    Array<{ name: string; columns: string[] }>
  >();
  for (const [name, uc] of uniqueByConstraint.entries()) {
    const list = uniquesByTable.get(uc.table) ?? [];
    list.push({ name, columns: uc.columns });
    uniquesByTable.set(uc.table, list);
  }

  // Indexes (grouped by index name)
  const indexByName = new Map<
    string,
    { table: string; columns: string[]; unique: boolean }
  >();
  for (const row of raw.indexRows) {
    const existing = indexByName.get(row.index_name);
    if (existing) existing.columns.push(row.column_name);
    else
      indexByName.set(row.index_name, {
        table: row.table_name,
        columns: [row.column_name],
        unique: row.indisunique,
      });
  }
  const indexesByTable = new Map<
    string,
    Array<{ name: string; columns: string[]; unique: boolean }>
  >();
  for (const [name, idx] of indexByName.entries()) {
    const list = indexesByTable.get(idx.table) ?? [];
    list.push({ name, columns: idx.columns, unique: idx.unique });
    indexesByTable.set(idx.table, list);
  }

  const tables: IntrospectedTable[] = baseTables.map((name) => ({
    name,
    columns: columnsByTable.get(name) ?? [],
    primaryKey: pkByTable.get(name) ?? [],
    foreignKeys: fksByTable.get(name) ?? [],
    uniqueConstraints: uniquesByTable.get(name) ?? [],
    indexes: indexesByTable.get(name) ?? [],
  }));

  const systemSchemas = raw.schemaRows
    .map((r) => r.schema_name as string)
    .filter((s) => SYSTEM_SCHEMAS.has(s) && s !== schema)
    .sort();

  return {
    schema,
    tables,
    enums,
    skipped: { views, systemSchemas },
  };
}
