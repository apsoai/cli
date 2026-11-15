import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";
import { columnSpec, schemaDdl } from "../../../src/lib/ddl";
import { catalogDiff, readCatalog } from "../../../src/lib/ddl/catalog";
import {
  legacyColumn,
  legacyTable,
  legacyType,
  syncStatements,
} from "../../../src/lib/ddl/sync";

// The parity fixture covers every field type the Python and Go generators
// support; pygo-parity.test.ts checks real services against it (opt-in).
const input = parseApsorcV2(
  JSON.parse(
    fs
      .readFileSync(
        path.join(__dirname, "../../fixtures/ddl/pygo-parity.apsorc")
      )
      .toString()
  )
);

const database = async (...batches: string[][]) => {
  const { PGlite } = await import("@electric-sql/pglite");
  // The uuid-keyed Document needs uuid_generate_v4().
  // eslint-disable-next-line @typescript-eslint/no-var-requires, camelcase, node/no-missing-require
  const { uuid_ossp } = require("@electric-sql/pglite/contrib/uuid_ossp");
  // eslint-disable-next-line camelcase
  const db = new PGlite({ extensions: { uuid_ossp } });
  // eslint-disable-next-line no-await-in-loop
  for (const statements of batches) await db.exec(statements.join(";\n"));
  return db;
};

describe("syncStatements", () => {
  test("a fresh database ends up exactly as schemaDdl builds it", async () => {
    const ddl = await database(schemaDdl(input));
    const synced = await database(syncStatements(input));
    expect(catalogDiff(await readCatalog(ddl), await readCatalog(synced))).toEqual([]);
    await Promise.all([ddl.close(), synced.close()]);
  });

  test("changes nothing on a database the DDL built", async () => {
    const db = await database(schemaDdl(input));
    const before = await readCatalog(db);
    await db.exec(syncStatements(input).join(";\n"));
    expect(catalogDiff(before, await readCatalog(db))).toEqual([]);
    await db.close();
  });

  test("adds the columns, indexes and constraints an older schema lacks", async () => {
    const older = JSON.parse(JSON.stringify(input));
    const account = older.entities.find((e: { name: string }) => e.name === "Account");
    account.fields = account.fields.filter((f: { name: string }) => f.name !== "handle");
    const db = await database(schemaDdl(older));
    await db.exec(syncStatements(input).join(";\n"));
    const ddl = await database(schemaDdl(input));
    expect(catalogDiff(await readCatalog(ddl), await readCatalog(db))).toEqual([]);
    await Promise.all([ddl.close(), db.close()]);
  });

  test("refuses, naming the renames, while older names hold the data", async () => {
    const db = await database(schemaDdl(input), [
      `ALTER TABLE account RENAME COLUMN "seenAt" TO seen_at`,
      `ALTER TABLE post_tags_tag RENAME TO post_tag`,
      `ALTER TYPE "account_planType_enum" RENAME TO account_plantype_enum`,
    ]);
    const before = await readCatalog(db);
    const legacy = [
      legacyColumn("account", "seen_at", "seenAt"),
      legacyColumn("account", "visit_count", "visits"), // never existed
      legacyTable("post_tag", "post_tags_tag"),
      legacyType("account_plantype_enum", "account_planType_enum"),
    ];
    const error = await db
      .exec(syncStatements(input, legacy).join(";\n"))
      .catch((error_: Error) => error_);
    expect((error as Error).message).toContain("older Apso-generated service");
    expect((error as Error).message).toContain(
      'ALTER TABLE "account" RENAME COLUMN "seen_at" TO "seenAt";\nALTER TABLE "post_tag" RENAME TO "post_tags_tag";\nALTER TYPE "public"."account_plantype_enum" RENAME TO "account_planType_enum";'
    );
    expect((error as Error).message).not.toContain("visit_count");
    expect(catalogDiff(before, await readCatalog(db))).toEqual([]);
    await db.close();
  });
});

const spec = (f: object) =>
  columnSpec("t", { name: "a", type: "array", dataType: "", ...f } as never).type;

describe("array element type", () => {
  test("the DDL honors the old arrayType and arrayItemType keys", () => {
    expect(spec({ arrayType: "integer" })).toBe("integer[]");
    expect(spec({ arrayItemType: "bigint" })).toBe("bigint[]");
    expect(spec({ elementType: "boolean", arrayType: "integer" })).toBe("boolean[]");
    expect(spec({})).toBe("text[]");
  });
});
