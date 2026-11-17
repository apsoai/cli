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
    // What .apsorc cannot express is reported, never imported as something stricter.
    expect(report.warnings.indexesNotCarried).toEqual([
      expect.stringMatching(/enrollments_one_live_per_patient_uq .* \(not imported\)$/),
      expect.stringMatching(/patients_mrn_uq .* \(not imported\)$/),
    ]);
    const rebuilt = await database(
      schemaDdl(parseApsorcV2(apsorc as any)).join(";\n")
    );
    const diff = catalogDiff(await readCatalog(original), await readCatalog(rebuilt));
    await Promise.all([original.close(), rebuilt.close()]);
    expect(diff).toMatchSnapshot();
  });
});
