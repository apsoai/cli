import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { ApsorcType, parseApsorcV2 } from "../../../src/lib/apsorc-parser";
import { Field } from "../../../src/lib/types";
import { schemaDdl, schemaModel } from "../../../src/lib/ddl";
import { changeDdl, downDdl } from "../../../src/lib/ddl/change";
import { catalogDiff, readCatalog } from "../../../src/lib/ddl/catalog";
import { openQuestions, planMigration } from "../../../src/lib/plan";
import { answeredPlan, answers } from "./answers";

const dir = (c: string) => path.join(__dirname, "../../fixtures/plan", c);
const read = (c: string, f: string) =>
  fs.readFileSync(path.join(dir(c), f)).toString();

const pglite = async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  return new PGlite();
};

describe("changeDdl on the migration eval cases", () => {
  test.each(Object.keys(answers))("%s", async (c) => {
    const before = JSON.parse(read(c, "before.apsorc"));
    const after = JSON.parse(read(c, "after.apsorc"));
    const plan = answeredPlan(c, before, after);
    expect(openQuestions(plan)).toEqual([]);

    const db = await pglite();
    await db.exec(schemaDdl(parseApsorcV2(before)).join(";\n"));
    await db.exec(read(c, "seed.sql"));
    await db.exec(changeDdl(before, after, plan).up.join(";\n"));

    const fresh = await pglite();
    await fresh.exec(schemaDdl(parseApsorcV2(after)).join(";\n"));
    expect(
      catalogDiff(await readCatalog(fresh), await readCatalog(db))
    ).toEqual([]);

    const failed: string[] = [];
    const checks = read(c, "checks.sql")
      .split(";\n")
      .filter((s) => s.trim());
    const results = await Promise.all(
      checks.map((sql) => db.query<{ ok: boolean; label: string }>(sql))
    );
    for (const result of results)
      for (const row of result.rows)
        if (row.ok !== true) failed.push(row.label);
    expect(failed).toEqual([]);
    await db.close();
    await fresh.close();
  });

  test("answering drop instead of rename loses the data, and the checks catch it", async () => {
    const c = "rename-field";
    const before = JSON.parse(read(c, "before.apsorc"));
    const after = JSON.parse(read(c, "after.apsorc"));
    const first = planMigration(before, after);
    first.questions[0].answer = "drop";
    const plan = planMigration(before, after, first);
    const db = await pglite();
    await db.exec(schemaDdl(parseApsorcV2(before)).join(";\n"));
    await db.exec(read(c, "seed.sql"));
    await db.exec(changeDdl(before, after, plan).up.join(";\n"));
    const result = await db.query<{ ok: boolean }>(
      read(c, "checks.sql").split(";\n")[0]
    );
    expect(result.rows[0].ok).toBe(false);
    await db.close();
  });

  test("a plain cast fails on a value that is not a number", async () => {
    const c = "type-change";
    const before = JSON.parse(read(c, "before.apsorc"));
    const after = JSON.parse(read(c, "after.apsorc"));
    const plan = planMigration(before, after);
    plan.questions[0].answer = "cast";
    const db = await pglite();
    await db.exec(schemaDdl(parseApsorcV2(before)).join(";\n"));
    await db.exec(read(c, "seed.sql"));
    await expect(
      db.exec(changeDdl(before, after, plan).up.join(";\n"))
    ).rejects.toThrow(/invalid input syntax/);
    await db.close();
  });
});

test("an .apsorc without a relationships key renders (fresh scaffolds omit it)", () => {
  const label = { name: "label", type: "text" };
  const note = { name: "note", type: "text", nullable: true };
  const before = {
    version: 2,
    entities: [{ name: "SmokeWidget", fields: [label] }],
  } as unknown as ApsorcType;
  const after = {
    version: 2,
    entities: [{ name: "SmokeWidget", fields: [label, note] }],
  } as unknown as ApsorcType;
  const plan = planMigration(before, after);
  expect(changeDdl(before, after, plan).up).toEqual([
    'ALTER TABLE "smoke_widget" ADD "note" text',
  ]);
  expect(downDdl(before, after, plan)).toEqual({
    down: [expect.stringMatching(/"smoke_widget" DROP COLUMN "note"/)],
  });
});

describe("downDdl reverses each eval case", () => {
  // Split and cast lose detail by design (trimmed whitespace, 'n/a').
  const lossy = new Set(["split-field", "type-change"]);
  test.each(Object.keys(answers))("%s", async (c) => {
    const before = JSON.parse(read(c, "before.apsorc"));
    const after = JSON.parse(read(c, "after.apsorc"));
    const plan = answeredPlan(c, before, after);
    const reverse = downDdl(before, after, plan);
    expect(reverse).toHaveProperty("down");
    const down = (reverse as { down: string[] }).down;

    const db = await pglite();
    await db.exec(schemaDdl(parseApsorcV2(before)).join(";\n"));
    await db.exec(read(c, "seed.sql"));
    const tables = schemaModel(parseApsorcV2(before)).tables.map((t) => t.name);
    const rows = async () =>
      Promise.all(
        tables.map(async (t) => {
          const r = await db.query(`SELECT * FROM "${t}" ORDER BY 1`);
          return r.rows;
        })
      );
    const seeded = await rows();
    await db.exec(changeDdl(before, after, plan).up.join(";\n"));
    await db.exec(down.join(";\n"));

    const fresh = await pglite();
    await fresh.exec(schemaDdl(parseApsorcV2(before)).join(";\n"));
    expect(
      catalogDiff(await readCatalog(fresh), await readCatalog(db))
    ).toEqual([]);
    if (!lossy.has(c)) expect(await rows()).toEqual(seeded);
    await db.close();
    await fresh.close();
  });
});

describe("array fields", () => {
  const schema = (fields: Field[]): ApsorcType => ({
    version: 2,
    rootFolder: "src",
    apiType: "Rest" as ApsorcType["apiType"],
    entities: [{ name: "Email", fields }],
    relationships: [],
  });
  const subject: Field = { name: "subject", type: "text" };

  test("columns are text[] unless elementType is set", () => {
    const [table] = schemaModel(
      parseApsorcV2(
        schema([
          { name: "toAddresses", type: "array" },
          {
            name: "ids",
            type: "array",
            elementType: "integer",
            nullable: true,
          },
        ])
      )
    ).tables;
    expect(table.columns.slice(1).map((c) => c.sql)).toEqual([
      '"toAddresses" text[] NOT NULL',
      '"ids" integer[]',
    ]);
  });

  test("an elementType that is not a type name is refused", () => {
    expect(() =>
      schemaModel(
        parseApsorcV2(
          schema([{ name: "x", type: "array", elementType: "text); DROP" }])
        )
      )
    ).toThrow(/invalid elementType/);
  });

  test("adding one to an existing table, then changing its elementType", async () => {
    const v1 = schema([subject]);
    const v2 = schema([subject, { name: "cc", type: "array", nullable: true }]);
    const v3 = schema([
      subject,
      { name: "cc", type: "array", elementType: "integer", nullable: true },
    ]);
    const db = await pglite();
    await db.exec(schemaDdl(parseApsorcV2(v1)).join(";\n"));
    await db.exec(`INSERT INTO "email" ("subject") VALUES ('hi')`);
    const up = [
      [v1, v2],
      [v2, v3],
    ].flatMap(([from, to]) => {
      const plan = planMigration(from, to);
      for (const x of plan.questions) x.answer = "cast";
      expect(openQuestions(planMigration(from, to, plan))).toEqual([]);
      return changeDdl(from, to, plan).up;
    });
    expect(up).toContain(
      'ALTER TABLE "email" ALTER COLUMN "cc" TYPE integer[] USING "cc"::integer[]'
    );
    await db.exec(up.join(";\n"));
    const fresh = await pglite();
    await fresh.exec(schemaDdl(parseApsorcV2(v3)).join(";\n"));
    expect(
      catalogDiff(await readCatalog(fresh), await readCatalog(db))
    ).toEqual([]);
    await db.close();
    await fresh.close();
  });

  test("a value to an array takes SQL, not a plain cast", async () => {
    const before = schema([{ name: "to", type: "text" }]);
    const after = schema([{ name: "to", type: "array" }]);
    const plan = planMigration(before, after);
    expect(plan.questions.map((x) => x.options)).toEqual([["sql"]]);
    plan.questions[0].answer = "cast";
    expect(openQuestions(planMigration(before, after, plan))).toHaveLength(1);
    expect(() => changeDdl(before, after, plan)).toThrow(/plain cast/);

    plan.questions[0].answer = "sql";
    plan.questions[0].sql = `ARRAY["to"]`;
    const db = await pglite();
    await db.exec(schemaDdl(parseApsorcV2(before)).join(";\n"));
    await db.exec(`INSERT INTO "email" ("to") VALUES ('a@b.co')`);
    await db.exec(changeDdl(before, after, plan).up.join(";\n"));
    const r = await db.query<{ to: string[] }>(`SELECT "to" FROM "email"`);
    expect(r.rows[0].to).toEqual(["a@b.co"]);
    await db.close();
    // Nothing answers the way back, so the reverse is reported, not guessed.
    expect(downDdl(before, after, plan)).toHaveProperty("irreversible");
  });
});

describe("extensions", () => {
  test("adding a uuid-keyed entity creates uuid-ossp before the table", async () => {
    const base = {
      version: 2,
      rootFolder: "src",
      apiType: "Rest" as ApsorcType["apiType"],
      relationships: [],
    };
    const note = {
      name: "Note",
      fields: [{ name: "body", type: "text" } as Field],
    };
    const v1: ApsorcType = { ...base, entities: [note] };
    const v2: ApsorcType = {
      ...base,
      entities: [
        note,
        {
          name: "Event",
          primaryKeyType: "uuid",
          fields: [{ name: "kind", type: "text" } as Field],
        } as never,
      ],
    };
    const { up } = changeDdl(v1, v2, planMigration(v1, v2));
    const ext = up.indexOf('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    expect(ext).toBe(0);
    expect(
      up.findIndex((x) => x.startsWith('CREATE TABLE "event"'))
    ).toBeGreaterThan(ext);
    const { PGlite } = await import("@electric-sql/pglite");
    // eslint-disable-next-line @typescript-eslint/no-var-requires, camelcase, node/no-missing-require
    const { uuid_ossp } = require("@electric-sql/pglite/contrib/uuid_ossp");
    // eslint-disable-next-line camelcase
    const db = new PGlite({ extensions: { uuid_ossp } });
    await db.exec(schemaDdl(parseApsorcV2(v1)).join(";\n"));
    await db.exec(up.join(";\n"));
    const r = await db.query<{ id: string }>(
      `INSERT INTO "event" ("kind") VALUES ('x') RETURNING "id"`
    );
    expect(r.rows[0].id).toMatch(/^[\da-f-]{36}$/);
    await db.close();
  });

  test("a change that adds no uuid table adds no extension", () => {
    const base = {
      version: 2,
      rootFolder: "src",
      apiType: "Rest" as ApsorcType["apiType"],
      relationships: [],
    };
    const v1: ApsorcType = {
      ...base,
      entities: [{ name: "Note", fields: [{ name: "body", type: "text" }] }],
    };
    const v2: ApsorcType = {
      ...base,
      entities: [
        {
          name: "Note",
          fields: [
            { name: "body", type: "text" },
            { name: "title", type: "text", nullable: true },
          ],
        },
      ],
    };
    expect(
      changeDdl(v1, v2, planMigration(v1, v2)).up.some((x) =>
        x.startsWith("CREATE EXTENSION")
      )
    ).toBe(false);
  });
});
