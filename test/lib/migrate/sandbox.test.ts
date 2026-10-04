import { expect, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  runMigrationSandbox,
  applyMigration,
  resetSandbox,
  detectRenameCandidates,
} from "../../../src/lib/migrate/sandbox";
import { readSnapshot } from "../../../src/lib/migrate/snapshot";
import { EntityGeneratorInput } from "../../../src/lib/migrate/entity-generator";

// These are integration tests that run PGlite in-process.
// They require @electric-sql/pglite and typeorm-pglite to be installed.
// Skip if not available.
let pgliteAvailable = true;
try {
  require("@electric-sql/pglite");
  require("typeorm-pglite");
} catch {
  pgliteAvailable = false;
}

const describeIfPGlite = pgliteAvailable ? describe : describe.skip;

describeIfPGlite("migration sandbox (integration)", () => {
  jest.setTimeout(30_000);

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-sandbox-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("first run: creates migration for new entity", async () => {
    const input: EntityGeneratorInput = {
      entities: [
        {
          name: "User",
          primaryKeyType: "serial",
          fields: [
            { name: "email", type: "text", unique: true },
            { name: "name", type: "text" },
          ],
        },
      ],
      relationshipMap: {},
    };

    const result = await runMigrationSandbox(input, tmpDir);

    expect(result.needed).toBe(true);
    expect(result.success).toBe(true);
    expect(result.upSql.length).toBeGreaterThan(0);

    // SQL should contain CREATE TABLE
    const allSql = result.upSql.join(" ").toLowerCase();
    expect(allSql).toContain("create table");
    expect(allSql).toContain("user");
  });

  test("no changes: reports not needed when schema unchanged", async () => {
    const input: EntityGeneratorInput = {
      entities: [
        {
          name: "Product",
          primaryKeyType: "serial",
          fields: [{ name: "title", type: "text" }],
        },
      ],
      relationshipMap: {},
    };

    // First run to establish baseline
    const first = await runMigrationSandbox(input, tmpDir);
    expect(first.needed).toBe(true);
    expect(first.success).toBe(true);

    // Apply the migration (save snapshot)
    applyMigration(input, tmpDir);

    // Second run with same schema
    const second = await runMigrationSandbox(input, tmpDir);
    expect(second.needed).toBe(false);
  });

  test("add column: generates ALTER TABLE", async () => {
    const initial: EntityGeneratorInput = {
      entities: [
        {
          name: "Item",
          primaryKeyType: "serial",
          fields: [{ name: "name", type: "text" }],
        },
      ],
      relationshipMap: {},
    };

    // Run initial migration and apply
    await runMigrationSandbox(initial, tmpDir);
    applyMigration(initial, tmpDir);

    // Add a column
    const updated: EntityGeneratorInput = {
      entities: [
        {
          name: "Item",
          primaryKeyType: "serial",
          fields: [
            { name: "name", type: "text" },
            { name: "description", type: "text", nullable: true },
          ],
        },
      ],
      relationshipMap: {},
    };

    const result = await runMigrationSandbox(updated, tmpDir);

    expect(result.needed).toBe(true);
    expect(result.success).toBe(true);

    const allSql = result.upSql.join(" ").toLowerCase();
    expect(allSql).toContain("alter table");
    expect(allSql).toContain("description");
  });

  test("add entity: generates CREATE TABLE for new entity", async () => {
    const initial: EntityGeneratorInput = {
      entities: [
        {
          name: "Author",
          primaryKeyType: "serial",
          fields: [{ name: "name", type: "text" }],
        },
      ],
      relationshipMap: {},
    };

    await runMigrationSandbox(initial, tmpDir);
    applyMigration(initial, tmpDir);

    // Add a new entity
    const updated: EntityGeneratorInput = {
      entities: [
        {
          name: "Author",
          primaryKeyType: "serial",
          fields: [{ name: "name", type: "text" }],
        },
        {
          name: "Book",
          primaryKeyType: "serial",
          fields: [{ name: "title", type: "text" }],
        },
      ],
      relationshipMap: {},
    };

    const result = await runMigrationSandbox(updated, tmpDir);

    expect(result.needed).toBe(true);
    expect(result.success).toBe(true);

    const allSql = result.upSql.join(" ").toLowerCase();
    expect(allSql).toContain("create table");
    expect(allSql).toContain("book");
  });

  test("add relationship: generates foreign key constraint", async () => {
    const initial: EntityGeneratorInput = {
      entities: [
        {
          name: "Author",
          primaryKeyType: "serial",
          fields: [{ name: "name", type: "text" }],
        },
        {
          name: "Book",
          primaryKeyType: "serial",
          fields: [{ name: "title", type: "text" }],
        },
      ],
      relationshipMap: {},
    };

    await runMigrationSandbox(initial, tmpDir);
    applyMigration(initial, tmpDir);

    const updated: EntityGeneratorInput = {
      ...initial,
      relationshipMap: {
        Book: [
          {
            type: "ManyToOne",
            name: "Author",
            referenceName: "Author",
            nullable: false,
            index: false,
            cascadeDelete: false,
          },
        ],
      },
    };

    const result = await runMigrationSandbox(updated, tmpDir);

    expect(result.needed).toBe(true);
    expect(result.success).toBe(true);

    const allSql = result.upSql.join(" ").toLowerCase();
    expect(allSql).toContain("foreign key");
    expect(allSql).toContain("authorid");
  });
});

describe("applyMigration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-apply-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("saves snapshot after apply", () => {
    const input: EntityGeneratorInput = {
      entities: [
        {
          name: "Task",
          fields: [{ name: "title", type: "text" }],
        },
      ],
      relationshipMap: {},
    };

    applyMigration(input, tmpDir);

    const snapshot = readSnapshot(tmpDir);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.entities).toHaveLength(1);
    expect(snapshot!.entities[0].name).toBe("Task");
  });
});

describe("resetSandbox", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-reset-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clears snapshot and data", () => {
    // Create some sandbox data
    const sandboxDir = path.join(tmpDir, ".apso", "sandbox");
    const pgDataDir = path.join(sandboxDir, "pgdata");
    fs.mkdirSync(pgDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(sandboxDir, "schema-snapshot.json"),
      "{}",
      "utf-8"
    );
    fs.writeFileSync(path.join(pgDataDir, "test.db"), "data", "utf-8");

    resetSandbox(tmpDir);

    expect(fs.existsSync(sandboxDir)).toBe(false);
  });
});

const userWith = (fields: { name: string; type: string; nullable?: boolean }[]): EntityGeneratorInput => ({
  entities: [{ name: "User", primaryKeyType: "serial", fields: fields as any }],
  relationshipMap: {},
});

describe("detectRenameCandidates", () => {
  const snapshot = {
    entities: [{ name: "User", fields: [{ name: "fullName", type: "text" }, { name: "age", type: "integer" }] }],
  };

  test("pairs a removed field with an added field of the same type", () => {
    const current = userWith([{ name: "displayName", type: "text" }, { name: "age", type: "integer" }]).entities;
    expect(detectRenameCandidates(snapshot, current)).toEqual([
      { entity: "User", from: "fullName", to: "displayName" },
    ]);
  });

  test("ignores a removed and added field of different types", () => {
    const current = userWith([{ name: "score", type: "integer" }, { name: "age", type: "integer" }]).entities;
    expect(detectRenameCandidates(snapshot, current)).toEqual([]);
  });

  test("returns nothing without a snapshot", () => {
    expect(detectRenameCandidates(null, userWith([{ name: "x", type: "text" }]).entities)).toEqual([]);
  });
});

describeIfPGlite("migration sandbox renames (integration)", () => {
  jest.setTimeout(30_000);
  let tmpDir: string;
  const rename = [{ entity: "User", from: "fullName", to: "displayName" }];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-rename-test-"));
    const initial = userWith([{ name: "fullName", type: "text" }]);
    await runMigrationSandbox(initial, tmpDir);
    applyMigration(initial, tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("confirmed rename emits RENAME COLUMN and no DROP", async () => {
    const result = await runMigrationSandbox(userWith([{ name: "displayName", type: "text" }]), tmpDir, rename);

    expect(result.success).toBe(true);
    expect(result.upSql).toEqual(['ALTER TABLE "user" RENAME COLUMN "fullName" TO "displayName"']);
    expect(result.downSql).toEqual(['ALTER TABLE "user" RENAME COLUMN "displayName" TO "fullName"']);
  });

  // TypeORM renames on its own only when a table has exactly one changed
  // column. Renaming one field and adding another in the same edit drops data.
  const renameAndAdd = userWith([
    { name: "displayName", type: "text" },
    { name: "age", type: "integer" },
  ]);

  test("rename plus a new field drops the column when not confirmed", async () => {
    const result = await runMigrationSandbox(renameAndAdd, tmpDir);

    expect(result.success).toBe(true);
    expect(result.upSql.join(" ")).toContain('DROP COLUMN "fullName"');
  });

  test("rename plus a new field keeps the data when confirmed", async () => {
    const result = await runMigrationSandbox(renameAndAdd, tmpDir, rename);

    expect(result.success).toBe(true);
    expect(result.upSql[0]).toBe('ALTER TABLE "user" RENAME COLUMN "fullName" TO "displayName"');
    const all = result.upSql.join(" ");
    expect(all).toContain('ADD "age" integer');
    expect(all).not.toContain("DROP COLUMN");
  });

  test("rename plus a nullable change keeps both", async () => {
    const result = await runMigrationSandbox(
      userWith([{ name: "displayName", type: "text", nullable: true }]),
      tmpDir,
      rename
    );

    expect(result.success).toBe(true);
    expect(result.upSql[0]).toBe('ALTER TABLE "user" RENAME COLUMN "fullName" TO "displayName"');
    const rest = result.upSql.slice(1).join(" ");
    expect(rest).toContain('"displayName" DROP NOT NULL');
    expect(rest).not.toContain("DROP COLUMN");
  });
});
