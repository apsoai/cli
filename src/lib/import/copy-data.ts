/**
 * Database Import — data copy (phase 2)
 *
 * Plans and executes a row copy from a source Postgres/Supabase database into a
 * target database that was rebuilt from the imported schema (phase 1). The
 * planning logic is pure and fully unit-testable; the actual reads/writes go
 * through the injectable `SourceReader` / `TargetWriter` interfaces so the
 * executor can be tested with fakes (mirroring phase 1's `Introspector`).
 *
 * Mapping rules mirror phase 1 exactly:
 *  - target table name  = snakeCase(entity name) = snakeCase(source table name)
 *  - single-column FK   = renamed to the platform's camelCase `<ref>Id`
 *  - every other column = copied under its original name
 */

import { snakeCase } from "../utils/casing";
import { getRelationshipIdField } from "../utils/relationships";
import { deriveToName } from "./pg-to-apsorc";
import { IntrospectedSchema, IntrospectedTable } from "./types";

const INTEGER_PK_UDTS = new Set(["int2", "int4", "int8"]);

export interface ColumnMapping {
  sourceColumn: string;
  targetColumn: string;
}

export interface TableCopyPlan {
  sourceTable: string;
  targetTable: string;
  /** Kept source columns (those whose mapped target column exists), in order. */
  sourceColumns: string[];
  /** Target column names, parallel to sourceColumns. */
  targetColumns: string[];
  /** Source PK column used to order paged reads (null when there is no PK). */
  orderBy: string | null;
  /** Target PK column whose sequence to reset after copy (null if not serial). */
  serialPkColumn: string | null;
}

export interface CopyPlan {
  tables: TableCopyPlan[];
  skippedColumns: Array<{ table: string; column: string; reason: string }>;
  /** Source tables with no corresponding target table (skipped entirely). */
  missingTargetTables: string[];
  /** Tables involved in a FK cycle (copied best-effort, after acyclic tables). */
  cyclicTables: string[];
}

/** The target table name the generator produces for a given source table. */
export function targetTableName(sourceTable: string): string {
  return snakeCase(sourceTable);
}

/** Map every source column to its target column name (FK rename or identity). */
export function buildColumnMapping(table: IntrospectedTable): ColumnMapping[] {
  const fkRefByColumn = new Map<string, string>();
  for (const fk of table.foreignKeys) {
    if (fk.columns.length === 1) {
      fkRefByColumn.set(fk.columns[0], fk.referencedTable);
    }
  }

  return [...table.columns]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((col) => {
      const refTable = fkRefByColumn.get(col.name);
      if (refTable) {
        const { toName } = deriveToName(col.name, refTable);
        const targetColumn = getRelationshipIdField({
          name: refTable,
          type: "ManyToOne",
          referenceName: toName,
        });
        return { sourceColumn: col.name, targetColumn };
      }
      return { sourceColumn: col.name, targetColumn: col.name };
    });
}

/**
 * Order tables so each is copied after the tables it references via FK
 * (parents before children). Self-references are ignored; tables in a cycle are
 * reported and appended best-effort at the end.
 */
export function topoSortTables(tables: IntrospectedTable[]): {
  order: string[];
  cyclic: string[];
} {
  const names = new Set(tables.map((t) => t.name));
  const deps = new Map<string, Set<string>>();
  for (const t of tables) {
    const d = new Set<string>();
    for (const fk of t.foreignKeys) {
      if (fk.referencedTable !== t.name && names.has(fk.referencedTable)) {
        d.add(fk.referencedTable);
      }
    }
    deps.set(t.name, d);
  }

  const order: string[] = [];
  const visited = new Set<string>();
  let progress = true;
  while (order.length < tables.length && progress) {
    progress = false;
    for (const t of tables) {
      if (visited.has(t.name)) continue;
      if ([...deps.get(t.name)!].every((x) => visited.has(x))) {
        order.push(t.name);
        visited.add(t.name);
        progress = true;
      }
    }
  }

  const cyclic = tables
    .filter((t) => !visited.has(t.name))
    .map((t) => t.name);
  for (const c of cyclic) order.push(c); // best-effort append

  return { order, cyclic };
}

/**
 * Build a full copy plan from the source schema and the set of columns that
 * actually exist in each target table. Source columns whose mapped target
 * column is missing are dropped (and reported); source tables with no target
 * table are skipped entirely.
 */
export function planCopy(
  source: IntrospectedSchema,
  targetColumnsByTable: Map<string, Set<string>>,
  tableFilter?: string[]
): CopyPlan {
  const filter = tableFilter && tableFilter.length > 0 ? new Set(tableFilter) : null;
  const consideredTables = source.tables.filter(
    (t) => !filter || filter.has(t.name)
  );

  const { order, cyclic } = topoSortTables(consideredTables);
  const byName = new Map(consideredTables.map((t) => [t.name, t]));

  const tables: TableCopyPlan[] = [];
  const skippedColumns: CopyPlan["skippedColumns"] = [];
  const missingTargetTables: string[] = [];

  for (const sourceTable of order) {
    const table = byName.get(sourceTable)!;
    const targetTable = targetTableName(sourceTable);
    const targetColumns = targetColumnsByTable.get(targetTable);
    if (!targetColumns) {
      missingTargetTables.push(sourceTable);
      continue;
    }

    const mapping = buildColumnMapping(table);
    const keptSource: string[] = [];
    const keptTarget: string[] = [];
    for (const m of mapping) {
      if (targetColumns.has(m.targetColumn)) {
        keptSource.push(m.sourceColumn);
        keptTarget.push(m.targetColumn);
      } else {
        skippedColumns.push({
          table: sourceTable,
          column: m.sourceColumn,
          reason: `target column "${m.targetColumn}" not found in ${targetTable}`,
        });
      }
    }

    // Determine ordering + serial PK handling from a single-column PK.
    let orderBy: string | null = null;
    let serialPkColumn: string | null = null;
    if (table.primaryKey.length === 1) {
      const pkCol = table.primaryKey[0];
      orderBy = pkCol;
      const pk = table.columns.find((c) => c.name === pkCol);
      const targetPk = mapping.find((m) => m.sourceColumn === pkCol)?.targetColumn;
      if (pk && targetPk && INTEGER_PK_UDTS.has(pk.udtName)) {
        serialPkColumn = targetPk;
      }
    }

    tables.push({
      sourceTable,
      targetTable,
      sourceColumns: keptSource,
      targetColumns: keptTarget,
      orderBy,
      serialPkColumn,
    });
  }

  return { tables, skippedColumns, missingTargetTables, cyclicTables: cyclic };
}

/** Coerce a value read from pg into something safe to bind on insert. */
export function coerceValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

/** Build a parameterized multi-row INSERT statement for a batch. */
export function buildInsertSql(
  table: string,
  columns: string[],
  rows: unknown[][],
  schema?: string
): { text: string; values: unknown[] } {
  const tableRef = schema ? `"${schema}"."${table}"` : `"${table}"`;
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = row.map((val) => {
      values.push(coerceValue(val));
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return {
    text: `INSERT INTO ${tableRef} (${colList}) VALUES ${tuples.join(", ")}`,
    values,
  };
}

export interface SourceReader {
  totalRows(table: string): Promise<number>;
  readBatch(
    table: string,
    columns: string[],
    orderBy: string | null,
    offset: number,
    limit: number
  ): Promise<unknown[][]>;
}

export interface TargetWriter {
  rowCount(table: string): Promise<number>;
  insertBatch(
    table: string,
    columns: string[],
    rows: unknown[][]
  ): Promise<void>;
  resetSequence(table: string, column: string): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface CopyResult {
  dryRun: boolean;
  perTable: Array<{ table: string; rows: number }>;
  skippedColumns: CopyPlan["skippedColumns"];
  missingTargetTables: string[];
  cyclicTables: string[];
  /** Target tables that already had rows (blocks a real, insert-only run). */
  blockedTables: string[];
}

export interface ExecuteOptions {
  batchSize?: number;
  dryRun?: boolean;
}

/**
 * Execute a copy plan. Insert-only: if any target table already has rows the
 * run aborts before writing anything. The whole copy runs in one transaction
 * on the target, so a failure rolls everything back.
 */
export async function executeCopy(
  plan: CopyPlan,
  source: SourceReader,
  target: TargetWriter,
  options: ExecuteOptions = {}
): Promise<CopyResult> {
  const batchSize = options.batchSize ?? 500;
  const dryRun = options.dryRun ?? false;

  // Pre-flight: detect non-empty target tables.
  const blockedTables: string[] = [];
  for (const t of plan.tables) {
    // eslint-disable-next-line no-await-in-loop
    const count = await target.rowCount(t.targetTable);
    if (count > 0) blockedTables.push(t.targetTable);
  }

  const perTable: Array<{ table: string; rows: number }> = [];

  if (dryRun) {
    for (const t of plan.tables) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await source.totalRows(t.sourceTable);
      perTable.push({ table: t.targetTable, rows });
    }
    return {
      dryRun: true,
      perTable,
      skippedColumns: plan.skippedColumns,
      missingTargetTables: plan.missingTargetTables,
      cyclicTables: plan.cyclicTables,
      blockedTables,
    };
  }

  if (blockedTables.length > 0) {
    throw new Error(
      `Aborting: target table(s) already contain rows: ${blockedTables.join(
        ", "
      )}. Use a fresh target or clear these tables first.`
    );
  }

  await target.begin();
  try {
    for (const t of plan.tables) {
      let offset = 0;
      let copied = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const rows = await source.readBatch(
          t.sourceTable,
          t.sourceColumns,
          t.orderBy,
          offset,
          batchSize
        );
        if (rows.length === 0) break;
        // eslint-disable-next-line no-await-in-loop
        await target.insertBatch(t.targetTable, t.targetColumns, rows);
        copied += rows.length;
        offset += rows.length;
        if (rows.length < batchSize) break;
      }
      if (t.serialPkColumn && copied > 0) {
        // eslint-disable-next-line no-await-in-loop
        await target.resetSequence(t.targetTable, t.serialPkColumn);
      }
      perTable.push({ table: t.targetTable, rows: copied });
    }
    await target.commit();
  } catch (error) {
    await target.rollback();
    throw error;
  }

  return {
    dryRun: false,
    perTable,
    skippedColumns: plan.skippedColumns,
    missingTargetTables: plan.missingTargetTables,
    cyclicTables: plan.cyclicTables,
    blockedTables,
  };
}

/** Build the target column lookup used by planCopy from an introspected target. */
export function targetColumnsFromSchema(
  target: IntrospectedSchema
): Map<string, Set<string>> {
  return new Map(
    target.tables.map((t) => [t.name, new Set(t.columns.map((c) => c.name))])
  );
}
