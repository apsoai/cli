/**
 * DATABASE_SYNC for services whose ORM can't build the DDL on its own (Go):
 * the same objects schemaDdl creates, as statements that create only what is
 * missing. A fresh database ends up exactly as `apso migrate` builds it, and
 * a database built by the migrations is left as it is. Nothing is altered or
 * dropped, like gorm's AutoMigrate.
 */
import {
  createIndexSql,
  createTableSql,
  createTypeSql,
  literal,
  q,
  schemaModel,
  SchemaInput,
} from ".";

/** Something an older generated service named differently, and the SQL that renames it. */
export interface LegacyName {
  /** SQL that is true when the database still has the old name. */
  when: string;
  fix: string[];
}

const columnExists = (table: string, column: string) =>
  `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${literal(
    table
  )} AND column_name = ${literal(column)})`;
const tableExists = (table: string) => `to_regclass(${literal(q(table))}) IS NOT NULL`;
const typeExists = (name: string) =>
  `EXISTS (SELECT 1 FROM pg_type WHERE typname = ${literal(
    name
  )} AND typnamespace = 'public'::regnamespace)`;

export const legacyColumn = (
  table: string,
  from: string,
  to: string
): LegacyName => ({
  when: `${columnExists(table, from)} AND NOT ${columnExists(table, to)}`,
  fix: [`ALTER TABLE ${q(table)} RENAME COLUMN ${q(from)} TO ${q(to)}`],
});

export const legacyTable = (
  from: string,
  to: string,
  columns: [string, string][] = []
): LegacyName => ({
  when: `${tableExists(from)} AND NOT ${tableExists(to)}`,
  fix: [
    `ALTER TABLE ${q(from)} RENAME TO ${q(to)}`,
    ...columns
      .filter(([a, b]) => a !== b)
      .map(([a, b]) => `ALTER TABLE ${q(to)} RENAME COLUMN ${q(a)} TO ${q(b)}`),
  ],
});

export const legacyType = (from: string, to: string): LegacyName => ({
  when: `${typeExists(from)} AND NOT ${typeExists(to)}`,
  fix: [`ALTER TYPE "public".${q(from)} RENAME TO ${q(to)}`],
});

const block = (body: string) => `DO $apso$ BEGIN ${body} END $apso$`;

/**
 * One statement that fails, naming the renames to run, when the database
 * still has names an older generated service used. Run before anything
 * else, so a sync never adds empty columns beside ones that hold the data.
 */
export function legacyGuardSql(legacy: LegacyName[]): string | undefined {
  if (legacy.length === 0) return undefined;
  const checks = legacy
    .map(
      (l) =>
        `IF ${l.when} THEN fix := fix || ${literal(
          l.fix.map((s) => s + ";\n").join("")
        )}; END IF;`
    )
    .join(" ");
  return `DO $apso$ DECLARE fix text := ''; BEGIN ${checks} IF fix <> '' THEN RAISE EXCEPTION USING MESSAGE = ${literal(
    "This database was created by an older Apso-generated service, which named these columns, tables or types differently. Nothing was changed. Run this SQL once to keep the data, then start the service again:\n"
  )} || fix; END IF; END $apso$`;
}

/** Statements that bring a database up to the schema without dropping or altering anything. */
export function syncStatements(
  input: SchemaInput,
  legacy: LegacyName[] = []
): string[] {
  const m = schemaModel(input);
  const guard = legacyGuardSql(legacy);
  return [
    ...(guard ? [guard] : []),
    ...m.extensions,
    ...m.enums.map((e) =>
      block(`IF NOT ${typeExists(e.name)} THEN ${createTypeSql(e)}; END IF;`)
    ),
    ...m.tables.flatMap((t) => {
      const pk = new Set(
        m.constraints
          .filter((c) => c.kind === "pk" && c.table === t.name)
          .flatMap((c) => c.columns)
      );
      return [
        createTableSql(t, m.constraints).replace(
          /^CREATE TABLE /,
          "CREATE TABLE IF NOT EXISTS "
        ),
        // A table from an older .apsorc gets the columns added since. Key
        // columns are left out: an existing table has them, and ADD COLUMN
        // IF NOT EXISTS with SERIAL makes a sequence even when it skips.
        ...t.columns
          .filter((c) => !pk.has(c.name))
          .map((c) => `ALTER TABLE ${q(t.name)} ADD COLUMN IF NOT EXISTS ${c.sql}`),
      ];
    }),
    ...m.indexes.map((i) =>
      createIndexSql(i).replace(/^CREATE (UNIQUE )?INDEX /, "CREATE $1INDEX IF NOT EXISTS ")
    ),
    ...m.constraints
      .filter((c) => c.kind !== "pk")
      .map((c) =>
        block(
          `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ${literal(
            c.name
          )} AND conrelid = to_regclass(${literal(q(c.table))})) THEN ALTER TABLE ${q(
            c.table
          )} ADD CONSTRAINT ${q(c.name)} ${c.body}; END IF;`
        )
      ),
  ];
}
