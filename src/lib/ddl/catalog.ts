/**
 * Read a database's schema back out of Postgres's own catalog, in a form two
 * databases can be compared by. Postgres normalizes what it stores (types,
 * defaults, constraint definitions), so two databases built by different SQL
 * compare equal when they ended up the same.
 */

export interface Catalog {
  columns: string[];
  constraints: string[];
  indexes: string[];
  enums: string[];
}

interface Queryable {
  query<T>(sql: string): Promise<{ rows: T[] }>;
}

const COLUMNS = `
SELECT table_name || '.' || column_name || ' ' || format_type(a.atttypid, a.atttypmod)
       || CASE WHEN c.is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
       || COALESCE(' DEFAULT ' || c.column_default, '') AS line
FROM information_schema.columns c
JOIN pg_attribute a ON a.attrelid = ('"' || c.table_name || '"')::regclass AND a.attname = c.column_name
WHERE c.table_schema = 'public'`;

const CONSTRAINTS = `
SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS line
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype IN ('p', 'u', 'f', 'c')`;

const INDEXES = `
SELECT indexdef AS line FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace)`;

const ENUMS = `
SELECT t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS line
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typnamespace = 'public'::regnamespace
GROUP BY t.typname`;

const lines = async (db: Queryable, sql: string) => {
  const result = await db.query<{ line: string }>(sql);
  return result.rows.map((r) => r.line).sort();
};

export async function readCatalog(db: Queryable): Promise<Catalog> {
  return {
    columns: await lines(db, COLUMNS),
    constraints: await lines(db, CONSTRAINTS),
    indexes: await lines(db, INDEXES),
    enums: await lines(db, ENUMS),
  };
}

/** Lines present in one catalog and not the other, prefixed - or +. */
export function catalogDiff(a: Catalog, b: Catalog): string[] {
  const out: string[] = [];
  for (const key of Object.keys(a) as (keyof Catalog)[]) {
    const left = new Set(a[key]);
    const right = new Set(b[key]);
    for (const l of a[key]) if (!right.has(l)) out.push(`- ${key}: ${l}`);
    for (const l of b[key]) if (!left.has(l)) out.push(`+ ${key}: ${l}`);
  }
  return out;
}
