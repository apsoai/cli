import { expect, describe, test } from "@jest/globals";
import {
  buildInsertSql,
  buildSelectSql,
  executeCopy,
  planCopy,
  targetColumnsFromSchema,
  SourceReader,
  TargetWriter,
} from "../../../src/lib/import/copy-data";
import { introspectClient } from "../../../src/lib/import/introspect";

// The copy reads every value as the text Postgres prints and lets the target
// column parse it. Before, values became JavaScript values on the way: an
// array column failed with "malformed array literal" and a timestamp kept
// milliseconds only.
const columns = `
  id bigint primary key,
  tags text[] not null,
  ids uuid[],
  seen timestamptz not null,
  local_seen timestamp,
  meta jsonb not null,
  raw bytea,
  wait interval,
  price numeric(12,4),
  flag boolean not null`;

const ddl = `
  create schema src;
  create schema tgt;
  create table src.items (${columns});
  create table tgt.items (${columns});
  create table src.notes (id integer primary key, tags text[] not null);
  create table tgt.notes (id integer primary key, tags jsonb not null);
  insert into src.items values
    (9007199254740993, '{design,"two words",NULL}', '{11111111-1111-1111-1111-111111111111}',
     '2026-11-25 20:52:25.439824+00', '2026-11-20 09:30:15.123456', '{"priority": 1, "list": [1, 2]}',
     '\\x00ff10', '1 day 02:03:04.5', 1234.5600, true),
    (2, '{}', NULL, '1999-12-31 23:59:59.999999+00', NULL, '[]', NULL, NULL, NULL, false);
  insert into src.notes values (1, '{a,b}'), (2, '{}');
`;

const rowsAsText = (table: string) =>
  `select array_agg(t::text order by t.id) as rows from ${table} t`;

// node-pg sends a string as untyped text and the server parses it for the
// column. PGlite parses parameters itself, so the test sends the values as
// untyped literals, which the server treats the same way.
const literal = (v: unknown) =>
  v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

const noop = () => Promise.resolve();

describe("import data copy", () => {
  test("arrays, microseconds, json, bytea and a 64-bit id arrive as they left", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    await db.exec(ddl);
    const count = async (table: string) => {
      const res = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      return res.rows[0].n;
    };

    const reader: SourceReader = {
      totalRows: (t) => count(`src."${t}"`),
      // eslint-disable-next-line max-params
      readBatch: async (t, cols, orderBy, offset, limit, expressions) => {
        const res = await db.query<Record<string, unknown>>(
          buildSelectSql(t, cols, orderBy, "src", expressions),
          [offset, limit]
        );
        return res.rows.map((row) => cols.map((c) => row[c]));
      },
    };
    const writer: TargetWriter = {
      rowCount: (t) => count(`tgt."${t}"`),
      insertBatch: async (t, cols, rows) => {
        const { text, values } = buildInsertSql(t, cols, rows, "tgt");
        await db.exec(
          text.replace(/\$(\d+)/g, (_, n) => literal(values[Number(n) - 1]))
        );
      },
      resetSequence: noop,
      begin: noop,
      commit: noop,
      rollback: noop,
    };

    const plan = planCopy(
      await introspectClient(db, "src"),
      targetColumnsFromSchema(await introspectClient(db, "tgt"))
    );
    const result = await executeCopy(plan, reader, writer, { batchSize: 1 });
    expect(result.perTable).toEqual([
      { table: "items", rows: 2 },
      { table: "notes", rows: 2 },
    ]);

    const text = async (table: string) => {
      const res = await db.query<{ rows: string[] }>(rowsAsText(table));
      return res.rows[0].rows;
    };
    expect(await text("tgt.items")).toEqual(await text("src.items"));
    // An array copied into a jsonb column (the field was changed after the
    // import) arrives as a JSON array.
    const notes = await db.query<{ tags: string }>(
      `select tags::text from tgt.notes order by id`
    );
    expect(notes.rows).toEqual([{ tags: '["a", "b"]' }, { tags: "[]" }]);
  });
});

describe("buildSelectSql", () => {
  test("reads each column through its expression, under the column's name", () => {
    expect(
      buildSelectSql("tasks", ["id", "tags"], "id", "public", ['"id"::text', 'to_jsonb("tags")::text'])
    ).toBe(
      'SELECT "id"::text AS "id", to_jsonb("tags")::text AS "tags" FROM "public"."tasks" ORDER BY "id" OFFSET $1 LIMIT $2'
    );
    expect(buildSelectSql("tasks", ["id"], null)).toBe(
      'SELECT "id" AS "id" FROM "tasks" OFFSET $1 LIMIT $2'
    );
  });
});
