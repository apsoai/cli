/**
 * Review a TypeORM-generated migration for statements that lose data or fail
 * on a populated database. TypeORM changes a column type by DROP + ADD, casts
 * enums without remapping removed values, and adds NOT NULL columns as if the
 * table were empty. The generated file is kept; each finding names a
 * statement to rewrite.
 */

export interface Finding {
  code: string;
  table: string;
  column?: string;
  message: string;
}

/** The SQL of each queryRunner.query call in a method body. */
const queries = (body: string) =>
  [...body.matchAll(/queryRunner\.query\(\s*`([\S\s]*?)`/g)].map((m) => m[1]);

const enumValues = (sql?: string) =>
  new Set(
    [...(sql?.match(/ENUM\(([^)]*)\)/)?.[1] ?? "").matchAll(/'([^']*)'/g)].map(
      (v) => v[1]
    )
  );

const typeSql = (sqls: string[], type: string) =>
  sqls.find((s) => s.startsWith(`CREATE TYPE "public"."${type}" AS ENUM`));

const list = (values: string[]) => values.map((v) => `"${v}"`).join(", ");

export function reviewMigration(source: string): Finding[] {
  const [upBody, downBody = ""] = source.split(/public\s+async\s+down\s*\(/);
  const up = queries(upBody);
  const down = queries(downBody);
  const findings: Finding[] = [];
  const add = (code: string, table: string, column: string | undefined, message: string) =>
    findings.push({ code, table, column, message });

  // Statements on tables this migration creates touch no existing rows.
  const created = new Set(
    up.map((q) => q.match(/^CREATE TABLE "([^"]+)"/)?.[1]).filter(Boolean)
  );
  const existing = (table: string) => !created.has(table);

  const dropped = new Map<string, string[]>();
  const added = new Map<string, string[]>();
  for (const q of up) {
    const d = q.match(/^ALTER TABLE "([^"]+)" DROP COLUMN "([^"]+)"/);
    if (d) dropped.set(d[1], [...(dropped.get(d[1]) ?? []), d[2]]);
    const a = q.match(/^ALTER TABLE "([^"]+)" ADD "([^"]+)"/);
    if (a) added.set(a[1], [...(added.get(a[1]) ?? []), a[2]]);
  }
  for (const [table, cols] of dropped) {
    const adds = added.get(table) ?? [];
    const newCols = adds.filter((a) => !cols.includes(a));
    for (const col of cols) {
      if (adds.includes(col))
        add("TYPE_CHANGE_DROPS_DATA", table, col,
          `${table}.${col}: TypeORM drops and re-adds the column to change its type, deleting every value. Replace the DROP and ADD with ALTER COLUMN "${col}" TYPE ... USING a cast that converts the existing values.`);
      else if (newCols.length > 0)
        add("POSSIBLE_RENAME", table, col,
          `${table}.${col} is dropped while ${list(newCols)} is added. If that is a rename, replace the DROP and ADD with RENAME COLUMN to keep the data; otherwise every value in "${col}" is deleted.`);
      else
        add("DROPS_COLUMN", table, col,
          `${table}.${col} is dropped with all its values. Confirm the loss, or copy the data first.`);
    }
  }

  for (const q of up) {
    let m = q.match(/^DROP TABLE "([^"]+)"/);
    if (m)
      add("DROPS_TABLE", m[1], undefined,
        `Table ${m[1]} is dropped with all its rows. Confirm the loss, or rename the table if an entity was renamed.`);

    m = q.match(/^ALTER TABLE "([^"]+)" ADD "([^"]+)" [^,]*\bNOT NULL\b(.*)$/);
    if (m && existing(m[1])) {
      const def = m[3].match(/DEFAULT (.+)$/)?.[1].trim();
      if (def)
        add("DEFAULT_BACKFILLS_ROWS", m[1], m[2],
          `${m[1]}.${m[2]} is added NOT NULL DEFAULT ${def}, so every existing row gets ${def}. Confirm that is right for existing rows, or add the column nullable, backfill it, then SET NOT NULL.`);
      else
        add("NOT_NULL_WITHOUT_BACKFILL", m[1], m[2],
          `${m[1]}.${m[2]} is added NOT NULL with no default, which fails if ${m[1]} has any rows. Add it nullable, backfill it, then SET NOT NULL.`);
    }

    m = q.match(/^ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET NOT NULL/);
    if (m && existing(m[1]))
      add("SET_NOT_NULL", m[1], m[2],
        `${m[1]}.${m[2]} becomes NOT NULL, which fails on any row where it is null. Backfill those rows first.`);

    m = q.match(/^ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" TYPE (?!"public"\."[^"]+_enum")/);
    if (m && existing(m[1]))
      add("TYPE_CAST", m[1], m[2],
        `${m[1]}.${m[2]} changes type in place; a value the cast cannot convert fails the migration. Check the USING clause handles every existing value.`);

    m =
      q.match(/^CREATE UNIQUE INDEX "[^"]+" ON "([^"]+)" \(([^)]+)\)/) ??
      q.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" UNIQUE \(([^)]+)\)/);
    if (m && existing(m[1]))
      add("UNIQUE_ON_EXISTING_ROWS", m[1], m[2].replace(/"/g, ""),
        `A unique constraint on ${m[1]} (${m[2].replace(/"/g, "")}) fails if existing rows hold duplicates. Check for duplicates first and decide which row wins.`);

    m = q.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" FOREIGN KEY \("([^"]+)"\) REFERENCES "([^"]+)"/);
    if (m && existing(m[1]) && created.has(m[3]))
      add("FOREIGN_KEY_TO_NEW_TABLE", m[1], m[2],
        `Existing ${m[1]} rows must point at ${m[3]}, which this migration creates empty, so the foreign key fails on any row with ${m[2]} set. If ${m[3]} replaces an existing entity, replace the CREATE TABLE with ALTER TABLE "<old table>" RENAME TO "${m[3]}" and ALTER SEQUENCE "<old table>_id_seq" RENAME TO "${m[3]}_id_seq"; TypeORM leaves the old table in place.`);
  }

  // TypeORM swaps an enum by renaming the old type to *_old, creating the new
  // one and casting through text; down() recreates *_old with the old values.
  for (const q of up) {
    const m = q.match(/^ALTER TYPE "public"\."([^"]+)" RENAME TO "([^"]+_old)"/);
    if (!m) continue;
    const now = enumValues(typeSql(up, m[1]));
    const cast = up.find((s) => s.includes(`TYPE "public"."${m[1]}" USING`));
    // A USING clause that names a removed value maps it; the rest still fail.
    const removed = [...enumValues(typeSql(down, m[2]))].filter(
      (v) => !now.has(v) && !cast?.includes(`'${v}'`)
    );
    const col = cast?.match(/^ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)"/);
    if (removed.length > 0 && col)
      add("ENUM_VALUES_REMOVED", col[1], col[2],
        `${col[1]}.${col[2]} drops enum value ${removed.map((v) => `'${v}'`).join(", ")}; the cast fails on any row that still holds it. Map those rows to a remaining value in the USING clause, e.g. CASE "${col[2]}"::text WHEN '${removed[0]}' THEN '...' ELSE "${col[2]}"::text END.`);
  }

  return findings;
}
