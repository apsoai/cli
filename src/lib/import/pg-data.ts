/**
 * Database Import — pg-backed data access for the copy executor.
 *
 * Thin wrappers around `pg` implementing the SourceReader / TargetWriter
 * interfaces from copy-data.ts. `pg` is imported lazily and SSL is enabled by
 * default (Supabase requires it). Integration-level: covered by manual/E2E
 * runs, while the copy logic itself is unit-tested with fakes.
 */

import { SourceReader, TargetWriter } from "./copy-data";

interface PgClient {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
  end(): Promise<void>;
}

async function createClient(connectionString: string): Promise<PgClient> {
  const pg = await import("pg");
  const Client = (pg as any).Client ?? (pg as any).default?.Client;
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client as PgClient;
}

function qualified(schema: string, table: string): string {
  return `"${schema}"."${table}"`;
}

/** Reads rows from the source database (read-only). */
export class PgSourceReader implements SourceReader {
  private readonly client: PgClient;
  private readonly schema: string;

  private constructor(client: PgClient, schema: string) {
    this.client = client;
    this.schema = schema;
  }

  static async connect(
    connectionString: string,
    schema: string
  ): Promise<PgSourceReader> {
    return new PgSourceReader(await createClient(connectionString), schema);
  }

  async totalRows(table: string): Promise<number> {
    const res = await this.client.query(
      `SELECT count(*)::int AS n FROM ${qualified(this.schema, table)}`
    );
    return res.rows[0].n;
  }

  async readBatch(
    table: string,
    columns: string[],
    orderBy: string | null,
    offset: number,
    limit: number
  ): Promise<unknown[][]> {
    const cols = columns.map((c) => `"${c}"`).join(", ");
    const order = orderBy ? ` ORDER BY "${orderBy}"` : "";
    const res = await this.client.query(
      `SELECT ${cols} FROM ${qualified(this.schema, table)}${order} OFFSET $1 LIMIT $2`,
      [offset, limit]
    );
    return res.rows.map((row) => columns.map((c) => row[c]));
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

/** Writes rows into the target database within a single transaction. */
export class PgTargetWriter implements TargetWriter {
  private readonly client: PgClient;
  private readonly schema: string;

  private constructor(client: PgClient, schema: string) {
    this.client = client;
    this.schema = schema;
  }

  static async connect(
    connectionString: string,
    schema: string
  ): Promise<PgTargetWriter> {
    return new PgTargetWriter(await createClient(connectionString), schema);
  }

  async rowCount(table: string): Promise<number> {
    const res = await this.client.query(
      `SELECT count(*)::int AS n FROM ${qualified(this.schema, table)}`
    );
    return res.rows[0].n;
  }

  async insertBatch(
    table: string,
    columns: string[],
    rows: unknown[][]
  ): Promise<void> {
    const { buildInsertSql } = await import("./copy-data");
    const { text, values } = buildInsertSql(table, columns, rows, this.schema);
    await this.client.query(text, values);
  }

  async resetSequence(table: string, column: string): Promise<void> {
    // Advance the column's owned sequence past the max value just inserted.
    await this.client.query(
      `SELECT setval(
         pg_get_serial_sequence($1, $2),
         (SELECT COALESCE(MAX("${column}"), 0) FROM ${qualified(this.schema, table)}),
         true
       )`,
      [`${this.schema}.${table}`, column]
    );
  }

  async begin(): Promise<void> {
    await this.client.query("BEGIN");
  }

  async commit(): Promise<void> {
    await this.client.query("COMMIT");
  }

  async rollback(): Promise<void> {
    await this.client.query("ROLLBACK");
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
