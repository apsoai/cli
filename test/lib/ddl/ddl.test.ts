import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";
import { constraintName, schemaDdl } from "../../../src/lib/ddl";
import { catalogDiff, readCatalog } from "../../../src/lib/ddl/catalog";

// Correctness against real generated services is checked by
// project-parity.test.ts (opt-in). These run everywhere: the DDL must run on
// Postgres, and any change to what it writes shows up as a snapshot diff.
const fixtures = path.join(__dirname, "../../fixtures");
const cases: [string, string][] = [
  ...fs
    .readdirSync(path.join(fixtures, "plan"))
    .map((c): [string, string] => [
      c,
      path.join(fixtures, "plan", c, "after.apsorc"),
    ]),
  ["inventory-multi-fk", path.join(fixtures, "inventory-multi-fk.apsorc")],
  ["coverage", path.join(fixtures, "ddl", "coverage.apsorc")],
  ["duplicate-index", path.join(fixtures, "ddl", "duplicate-index.apsorc")],
  ["one-to-one-unique", path.join(fixtures, "ddl", "one-to-one-unique.apsorc")],
];
const ddl = (file: string) =>
  schemaDdl(parseApsorcV2(JSON.parse(fs.readFileSync(file).toString())));

// One entity with both timestamp columns, plus the given entity settings.
const note = (entity: object) =>
  schemaDdl(
    parseApsorcV2({ version: 2, rootFolder: "src", entities: [{ name: "Note", created_at: true, updated_at: true, ...entity }], relationships: [] } as any)
  );

describe("schemaDdl", () => {
  test("names match TypeORM's DefaultNamingStrategy", () => {
    // Names from a migration TypeORM generated for contact.companyId.
    expect(constraintName.foreignKey("contact", ["companyId"])).toBe(
      "FK_196374b312744cf2c400c962383"
    );
    expect(constraintName.index("contact", ["companyId"])).toBe(
      "IDX_196374b312744cf2c400c96238"
    );
    expect(constraintName.primaryKey("organization", ["id"])).toBe(
      "PK_472c1f99a32def1b0abb219cd67"
    );
  });

  test.each(cases)(
    "%s runs on Postgres and matches its snapshot",
    async (_name, file) => {
      const statements = ddl(file);
      const { PGlite } = await import("@electric-sql/pglite");
      const db = new PGlite();
      await db.exec(statements.join(";\n"));
      await db.close();
      expect(statements).toMatchSnapshot();
    }
  );

  // apsoai/cli#243: timestamp stays the default; timestampType matches a
  // database whose columns already carry a time zone, so migrate plans nothing.
  test("timestampType sets the created_at and updated_at column type, timestamp by default", async () => {
    const plain = note({});
    expect(plain.join("\n")).toContain('"created_at" TIMESTAMP NOT NULL DEFAULT now()');
    expect(plain.join("\n")).toContain('"updated_at" TIMESTAMP NOT NULL DEFAULT now()');

    const { PGlite } = await import("@electric-sql/pglite");
    const build = async (...batches: string[][]) => {
      const db = new PGlite();
      // eslint-disable-next-line no-await-in-loop
      for (const b of batches) await db.exec(b.join(";\n"));
      const catalog = await readCatalog(db);
      await db.close();
      return catalog;
    };
    // An existing database: the same table with time zones on both columns.
    const existing = await build(plain, [
      "ALTER TABLE note ALTER COLUMN created_at TYPE timestamptz",
      "ALTER TABLE note ALTER COLUMN updated_at TYPE timestamptz",
    ]);
    expect(catalogDiff(existing, await build(note({ timestampType: "timestamptz" })))).toEqual([]);
    expect(catalogDiff(existing, await build(plain))).not.toEqual([]);
  });

  test("an index declared twice is created once (it would fail on deploy)", () => {
    const creates = ddl(path.join(fixtures, "ddl", "duplicate-index.apsorc")).filter((s) => / INDEX /.test(s));
    expect(creates.filter((s) => s.includes('("projectId")'))).toHaveLength(1);
    expect(creates.filter((s) => s.includes('("title")'))).toEqual([expect.stringContaining("UNIQUE INDEX")]);
  });
});
