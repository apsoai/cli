import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";
import { constraintName, schemaDdl } from "../../../src/lib/ddl";

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
];
const ddl = (file: string) =>
  schemaDdl(parseApsorcV2(JSON.parse(fs.readFileSync(file).toString())));

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
});
