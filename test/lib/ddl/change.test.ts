import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";
import { schemaDdl, schemaModel } from "../../../src/lib/ddl";
import { changeDdl, downDdl } from "../../../src/lib/ddl/change";
import { catalogDiff, readCatalog } from "../../../src/lib/ddl/catalog";
import { openQuestions, planMigration, Plan } from "../../../src/lib/plan";

// Each migration eval case, answered the way the eval expects. The change
// must leave the seeded database identical in schema to a fresh build of the
// new .apsorc, with every row check in checks.sql passing.
const answers: Record<
  string,
  Record<
    string,
    string | { answer: string; sql: string | Record<string, string> }
  >
> = {
  "rename-entity": { "entity:Company": "rename:Organization" },
  "rename-field": { "field:Contact.phone": "rename:mobilePhone" },
  "split-field": {
    "field:Contact.fullName": {
      answer: "split:firstName,lastName",
      sql: {
        firstName: `split_part(btrim("fullName"), ' ', 1)`,
        lastName: `NULLIF(btrim(substr(btrim("fullName"), length(split_part(btrim("fullName"), ' ', 1)) + 1)), '')`,
      },
    },
  },
  "extract-entity": { "field:Contact.phone": "move:PhoneNumber.number" },
  "many-to-many": { "relation:Contact.Company": "copy-links" },
  "enum-replace": { "enum:Contact.status:archived": "closed" },
  "required-field": { "backfill:Company.region": "us" },
  "type-change": {
    "cast:Contact.score": {
      answer: "sql",
      sql: `NULLIF(regexp_replace("score", '[^0-9-]', '', 'g'), '')::integer`,
    },
  },
};

const dir = (c: string) => path.join(__dirname, "../../fixtures/plan", c);
const read = (c: string, f: string) =>
  fs.readFileSync(path.join(dir(c), f)).toString();

const answeredPlan = (c: string, before: any, after: any): Plan => {
  let plan = planMigration(before, after);
  for (let round = 0; round < 3; round++) {
    for (const q of plan.questions) {
      const a = answers[c][q.id];
      if (a === undefined) continue;
      if (typeof a === "string") q.answer = a;
      else Object.assign(q, a);
    }
    plan = planMigration(before, after, plan);
  }
  return plan;
};

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
