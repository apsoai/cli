import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { reviewMigration } from "../../../src/lib/verify/review";
import { dataLoss, unaccepted } from "../../../src/lib/verify";

// Each fixture is what `apso migrate generate` (TypeORM migration:generate)
// wrote for one .apsorc change to a Company/Contact schema.
const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "../../fixtures/typeorm-migrations", `${name}.ts`), "utf8");
const codes = (name: string) =>
  reviewMigration(fixture(name)).map((f) => `${f.code} ${f.table}.${f.column}`);

describe("reviewMigration on TypeORM output", () => {
  test("a field rename TypeORM already emits as RENAME COLUMN is clean", () => {
    expect(codes("rename-field")).toEqual([]);
  });

  test("a type change done as DROP + ADD", () => {
    expect(codes("type-change")).toEqual(["TYPE_CHANGE_DROPS_DATA contact.score"]);
  });

  test("an enum swap that removes a value", () => {
    const [f] = reviewMigration(fixture("enum-replace"));
    expect(f.code).toBe("ENUM_VALUES_REMOVED");
    expect(`${f.table}.${f.column}`).toBe("contact.status");
    expect(f.message).toContain("'archived'");
    const mapped = fixture("enum-replace").replace(
      `USING "status"::"text"::"public"."contact_status_enum"`,
      `USING (CASE "status"::text WHEN 'archived' THEN 'closed' ELSE "status"::text END)::"public"."contact_status_enum"`
    );
    expect(reviewMigration(mapped)).toEqual([]);
  });

  test("a required enum field backfilled by its default", () => {
    expect(codes("required-field")).toEqual(["DEFAULT_BACKFILLS_ROWS company.region"]);
  });

  test("an entity rename that creates an empty table", () => {
    expect(codes("rename-entity")).toEqual(["FOREIGN_KEY_TO_NEW_TABLE contact.organizationId"]);
  });
});

const migration = (...up: string[]) =>
  `public async up(queryRunner) {\n${up.map((q) => `await queryRunner.query(\`${q}\`);`).join("\n")}\n}\npublic async down(queryRunner) {}`;

describe("reviewMigration rules", () => {
  test("a dropped column with another added is a possible rename", () => {
    const f = reviewMigration(
      migration(`ALTER TABLE "contact" DROP COLUMN "phone"`, `ALTER TABLE "contact" ADD "mobile" integer`)
    );
    expect(f.map((x) => x.code)).toEqual(["POSSIBLE_RENAME"]);
  });

  test("drops, NOT NULL without default, SET NOT NULL, unique and casts on existing tables", () => {
    const f = reviewMigration(
      migration(
        `ALTER TABLE "company" DROP COLUMN "notes"`,
        `DROP TABLE "legacy"`,
        `ALTER TABLE "contact" ADD "email" text NOT NULL`,
        `ALTER TABLE "contact" ALTER COLUMN "phone" SET NOT NULL`,
        `CREATE UNIQUE INDEX "IDX_1" ON "contact" ("email") `,
        `ALTER TABLE "contact" ADD CONSTRAINT "UQ_1" UNIQUE ("phone")`,
        `ALTER TABLE "contact" ALTER COLUMN "age" TYPE integer USING "age"::integer`
      )
    );
    expect(f.map((x) => x.code)).toEqual([
      "DROPS_COLUMN",
      "DROPS_TABLE",
      "NOT_NULL_WITHOUT_BACKFILL",
      "SET_NOT_NULL",
      "UNIQUE_ON_EXISTING_ROWS",
      "UNIQUE_ON_EXISTING_ROWS",
      "TYPE_CAST",
    ]);
  });

  test("a drop or SET NOT NULL after the data is copied or backfilled is clean", () => {
    expect(
      reviewMigration(
        migration(
          `ALTER TABLE "contact" ADD "firstName" text`,
          `UPDATE "contact" SET "firstName" = split_part("fullName", ' ', 1)`,
          `ALTER TABLE "contact" ALTER COLUMN "firstName" SET NOT NULL`,
          `ALTER TABLE "contact" DROP COLUMN "fullName"`
        )
      )
    ).toEqual([]);
  });

  test("statements on a table the migration creates are safe", () => {
    expect(
      reviewMigration(
        migration(
          `CREATE TABLE "note" ("id" SERIAL NOT NULL, CONSTRAINT "PK_1" PRIMARY KEY ("id"))`,
          `ALTER TABLE "note" ADD "body" text NOT NULL`,
          `CREATE UNIQUE INDEX "IDX_2" ON "note" ("body") `
        )
      )
    ).toEqual([]);
  });
});

describe("dataLoss", () => {
  const before = {
    company: { rows: 2, values: { id: 2, name: 2 } },
    contact: { rows: 4, values: { id: 4, phone: 3, score: 4 } },
  };

  test("follows renamed tables and columns", () => {
    const after = {
      organization: { rows: 2, values: { id: 2, name: 2 } },
      contact: { rows: 4, values: { id: 4, mobilePhone: 3, score: 4 } },
    };
    const sql = `ALTER TABLE "company" RENAME TO "organization"; ALTER TABLE "contact" RENAME COLUMN "phone" TO "mobilePhone"`;
    expect(dataLoss(before, after, sql)).toEqual([]);
  });

  test("reports lost rows, tables and values", () => {
    const after = { contact: { rows: 3, values: { id: 3, phone: 3, score: 0 } } };
    expect(dataLoss(before, after, "")).toEqual([
      "table company: all 2 rows",
      "table contact: 1 of 4 rows",
      "contact.id: 1 of 4 values",
      "contact.score: 4 of 4 values",
    ]);
  });

  test("data moved to another table or a join table is not lost", () => {
    const seeded = {
      contact: {
        rows: 3,
        values: { id: 3, phone: 2, companyId: 3 },
        distinct: { id: ["1", "2", "3"], phone: ["555-01", "555-02"], companyId: ["1", "2"] },
      },
    };
    const after = {
      contact: { rows: 3, values: { id: 3 }, distinct: { id: ["1", "2", "3"] } },
      "phone_number": { rows: 2, values: { number: 2 }, distinct: { number: ["555-01", "555-02"] } },
      "contact_companies_company": { rows: 3, values: { companyId: 3 }, distinct: { companyId: ["1", "2"] } },
    };
    expect(dataLoss(seeded, after, "")).toEqual([]);
    const dropped = { ...after, "phone_number": { rows: 1, values: { number: 1 }, distinct: { number: ["555-01"] } } };
    expect(dataLoss(seeded, dropped, "")).toEqual(["contact.phone: 2 of 2 values"]);
    const company = { rows: 2, values: { id: 2 }, distinct: { id: ["1", "2"] } };
    const emptyJoin = { contact: after.contact, company, "contact_companies_company": { rows: 0, values: { companyId: 0 }, distinct: { companyId: [] } } };
    expect(dataLoss({ ...seeded, company }, { ...emptyJoin, "phone_number": after.phone_number }, "")).toEqual([
      "contact.companyId: 3 of 3 values",
    ]);
  });

  test("accepted losses are named by table or column", () => {
    const lost = ["table legacy: all 2 rows", "contact.fullName: 4 of 4 values", "contact.score: 1 of 4 values"];
    expect(unaccepted(lost, ["legacy", "contact.fullName"])).toEqual(["contact.score: 1 of 4 values"]);
  });
});
