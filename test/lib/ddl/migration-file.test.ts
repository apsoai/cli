import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  typeormMigration,
  writePlannedMigration,
} from "../../../src/lib/ddl/migration-file";

const fixture = (c: string, f: string) =>
  path.join(__dirname, "../../fixtures/plan", c, f);
const project = (c: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-planned-"));
  fs.copyFileSync(fixture(c, "after.apsorc"), path.join(dir, ".apsorc"));
  return dir;
};

describe("writePlannedMigration", () => {
  test("writes nothing while a plan question is open", () => {
    const dir = project("rename-field");
    const result = writePlannedMigration(
      dir,
      fixture("rename-field", "before.apsorc"),
      "SchemaUpdate",
      path.join(dir, ".apso/migration-plan.json")
    );
    expect(result.ok).toBe(false);
    expect(result.open?.map((q) => q.id)).toEqual(["field:Contact.phone"]);
    expect(fs.existsSync(path.join(dir, "src", "migrations"))).toBe(false);
  });

  test("writes the migration and its plan once answered", () => {
    const dir = project("rename-field");
    const planPath = path.join(dir, ".apso/migration-plan.json");
    writePlannedMigration(
      dir,
      fixture("rename-field", "before.apsorc"),
      "SchemaUpdate",
      planPath
    );
    const plan = JSON.parse(fs.readFileSync(planPath).toString());
    plan.questions[0].answer = "rename:mobilePhone";
    fs.writeFileSync(planPath, JSON.stringify(plan));
    const result = writePlannedMigration(
      dir,
      fixture("rename-field", "before.apsorc"),
      "SchemaUpdate",
      planPath,
      1_700_000_000_000
    );
    expect(result.file).toBe(
      "src/migrations/1700000000000-SchemaUpdate-migration.ts"
    );
    const source = fs.readFileSync(path.join(dir, result.file!)).toString();
    expect(source).toContain(
      "export class SchemaUpdateMigration1700000000000 implements MigrationInterface"
    );
    expect(source).toContain(
      'ALTER TABLE "contact" RENAME COLUMN "phone" TO "mobilePhone"'
    );
    expect(source).toContain(
      'ALTER TABLE "contact" RENAME COLUMN "mobilePhone" TO "phone"'
    );
    expect(fs.existsSync(path.join(dir, result.planFile!))).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe("typeormMigration", () => {
  test("escapes backticks and template placeholders in SQL", () => {
    // eslint-disable-next-line no-template-curly-in-string
    const source = typeormMigration("X1", ["SELECT '`${x}`'"], { down: [] });
    expect(source).toContain(
      // eslint-disable-next-line no-template-curly-in-string
      "await queryRunner.query(`SELECT '\\`\\${x}\\`'`);"
    );
  });

  test("down() throws, naming what can't be reversed", () => {
    const source = typeormMigration("X1", ["SELECT 1"], {
      irreversible: ["backfill:Contact.fullName: needs a value"],
    });
    expect(source).toContain(
      "can't be reversed automatically: backfill:Contact.fullName: needs a value"
    );
  });
});
