import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";
import { schemaDdl } from "../../../src/lib/ddl";
import { catalogDiff, readCatalog } from "../../../src/lib/ddl/catalog";
import { introspectClient } from "../../../src/lib/import/introspect";
import { pgToApsorc } from "../../../src/lib/import/pg-to-apsorc";

// apsoai/cli#242: import an existing database, build the schema the imported
// .apsorc describes, and compare the two catalogs. Every line of the snapshot
// is something the import changes today ("-" is the source database, "+" is
// what Apso would build). A fix removes its lines; nothing may add one.
const source = fs
  .readFileSync(path.join(__dirname, "../../fixtures/import/roundtrip.sql"))
  .toString();

const database = async (sql: string) => {
  const { PGlite } = await import("@electric-sql/pglite");
  // eslint-disable-next-line @typescript-eslint/no-var-requires, camelcase, node/no-missing-require
  const { uuid_ossp } = require("@electric-sql/pglite/contrib/uuid_ossp");
  // eslint-disable-next-line camelcase
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(sql);
  return db;
};

describe("import round trip", () => {
  test("the rebuilt schema differs from the source only in the known ways", async () => {
    const original = await database(source);
    const { apsorc, report } = pgToApsorc(await introspectClient(original, "public"));
    // A second foreign key on a column is kept, as a constraint only.
    expect(apsorc.entities.find((e) => e.name === "enrollments")?.foreignKeys).toEqual([{ name: "enrollments_patient_id_fkey2", column: "patient_id", to: "patients", onDelete: "CASCADE", validate: false }]);
    // A key keeps its ON UPDATE rule, SET DEFAULT and DEFERRABLE, and a table
    // keyed by a foreign key can be referenced.
    expect(apsorc.relationships.find((r) => r.foreignKeyName === "setting_notes_setting_fk")).toEqual({
      from: "setting_notes", to: "tenant_settings", type: "ManyToOne", to_name: "setting", joinColumnName: "setting_id",
      foreignKeyName: "setting_notes_setting_fk", onDelete: "SET DEFAULT", onUpdate: "CASCADE", deferrable: "INITIALLY DEFERRED",
    });
    expect(apsorc.entities.find((e) => e.name === "setting_notes")?.foreignKeys).toEqual([
      { name: "setting_notes_facility_fk2", column: "facility_id", to: "facilities", onUpdate: "RESTRICT", deferrable: "INITIALLY IMMEDIATE" },
    ]);
    expect(report.warnings.foreignKeysNotCarried).toEqual([]);
    // A generated column keeps its expression; it is not imported as a plain column.
    expect(apsorc.entities.find((e) => e.name === "enrollments")?.fields).toContainEqual({ name: "minutes_doubled", type: "integer", nullable: true, generated: "(minutes * 2)" });
    expect(report.warnings.arraysLossy).toEqual([]);
    expect(apsorc.entities.find((e) => e.name === "patients")?.indexes).toContainEqual({ fields: ["mrn"], unique: true, name: "patients_mrn_plain_uq" });
    // What .apsorc cannot express is reported, never imported as something stricter.
    expect(report.warnings.indexesNotCarried).toEqual([]);
    expect(apsorc.entities.find((e) => e.name === "patients")?.sqlIndexes).toEqual([
      {
        name: "patients_mrn_uq",
        columns: "organization_id, lower(btrim(mrn))",
        unique: true,
        where: "(mrn IS NOT NULL)",
      },
    ]);
    const rebuilt = await database(
      schemaDdl(parseApsorcV2(apsorc as any)).join(";\n")
    );
    const diff = catalogDiff(await readCatalog(original), await readCatalog(rebuilt));
    await Promise.all([original.close(), rebuilt.close()]);
    expect(diff).toMatchSnapshot();
  });
});
