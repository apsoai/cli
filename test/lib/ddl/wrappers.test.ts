import { expect, describe, test } from "@jest/globals";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { changeDdl, downDdl } from "../../../src/lib/ddl/change";
import {
  alembicHead,
  alembicMigration,
  gooseMigration,
  migrationSql,
  writePlannedMigration,
} from "../../../src/lib/ddl/migration-file";
import { PythonGenerator } from "../../../src/lib/generators/python";
import { verifyMigration } from "../../../src/lib/verify";
import { answeredPlan, answers } from "./answers";

const fixture = (c: string, f: string) =>
  path.join(__dirname, "../../fixtures/plan", c, f);
const read = (c: string, f: string) =>
  JSON.parse(fs.readFileSync(fixture(c, f)).toString());
const cliBin = path.join(__dirname, "../../../bin/run");

let python = true;
try {
  execFileSync("python3", ["--version"], { stdio: "ignore" });
} catch {
  python = false;
}
/** Python accepts the file. Without python3, every SQL literal must round-trip. */
const compiles = (source: string) => {
  if (!python) {
    for (const m of source.matchAll(/op\.execute\((.*)\)$/gm))
      expect(typeof JSON.parse(m[1])).toBe("string");
    return;
  }
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "apso-py-")),
    "m.py"
  );
  fs.writeFileSync(file, source);
  execFileSync("python3", ["-m", "py_compile", file]);
};

describe.each(Object.keys(answers))("%s", (c) => {
  const before = read(c, "before.apsorc");
  const after = read(c, "after.apsorc");
  const plan = answeredPlan(c, before, after);
  const { up } = changeDdl(before, after, plan);
  const down = downDdl(before, after, plan);

  test("Alembic revision compiles and gives back its SQL", () => {
    const source = alembicMigration("20231114221320", "20231101000000", up, down);
    expect(source).toMatchSnapshot();
    compiles(source);
    const sql = migrationSql("x.py", source);
    expect(sql.up).toBe(up.join(";\n"));
    expect(sql.down).toBe((down as { down: string[] }).down.join(";\n"));
  });

  test("goose file matches its snapshot", () => {
    expect(gooseMigration(up, down)).toMatchSnapshot();
  });
});

describe("wrappers", () => {
  test("SQL ending in a quoted identifier stays valid Python (#148)", async () => {
    const [file] = await new PythonGenerator({
      language: "python",
    } as any).generateMigration({
      entities: [],
      upSql: ['DROP TABLE "user"'],
      downSql: ['CREATE TABLE "user" ("id" integer, "note" text DEFAULT \'a\\b """\')'],
    } as any);
    compiles(file.content);
    expect(file.content).toContain('op.execute("DROP TABLE \\"user\\"")');
  });

  test("an irreversible down refuses to run", () => {
    const irreversible = { irreversible: ["backfill:Contact.fullName: 100%"] };
    const py = alembicMigration("2", undefined, ["SELECT 1"], irreversible);
    compiles(py);
    expect(py).toContain("raise NotImplementedError(");
    expect(py).toContain("down_revision = None");
    expect(migrationSql("x.py", py).down).toBeUndefined();
    const sql = gooseMigration(["SELECT 1"], irreversible);
    expect(sql).toContain("-- +goose StatementBegin\nDO $$ BEGIN RAISE EXCEPTION");
    expect(sql).toContain("100%%");
    expect(migrationSql("x.sql", sql)).toEqual({ up: "\nSELECT 1;\n\n", down: undefined });
  });

  test("a statement with its own semicolon is fenced for goose", () => {
    expect(gooseMigration(["SELECT ';'", "SELECT 2"], { down: [] })).toContain(
      "-- +goose StatementBegin\nSELECT ';';\n-- +goose StatementEnd\nSELECT 2;"
    );
  });

  test("the Alembic head is the revision nothing revises", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-alembic-"));
    expect(alembicHead(dir)).toBeUndefined();
    const rev = (f: string, r: string, d: string) =>
      fs.writeFileSync(
        path.join(dir, f),
        `revision: str = '${r}'\ndown_revision: Union[str, None] = ${d}\n`
      );
    rev("a_init.py", "aaa", "None");
    rev("c_third.py", "ccc", "'bbb'");
    rev("b_second.py", "bbb", "'aaa'");
    expect(alembicHead(dir)).toBe("ccc");
  });
});

describe.each(["python", "go"])("apso migrate for %s", (language) => {
  const project = (c: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `apso-${language}-`));
    const after = { ...read(c, "after.apsorc"), language };
    fs.writeFileSync(path.join(dir, ".apsorc"), JSON.stringify(after));
    const plan = answeredPlan(c, read(c, "before.apsorc"), after);
    const planPath = path.join(dir, ".apso", "migration-plan.json");
    fs.mkdirSync(path.dirname(planPath));
    fs.writeFileSync(planPath, JSON.stringify(plan));
    return { dir, planPath };
  };

  test("writes the migration where the template keeps them", () => {
    const { dir, planPath } = project("rename-field");
    const result = writePlannedMigration(
      dir,
      read("rename-field", "before.apsorc"),
      "SchemaUpdate",
      planPath,
      1_700_000_000_000
    );
    expect(result.file).toBe(
      language === "python"
        ? "alembic/versions/20231114221320_schema_update.py"
        : "migrations/20231114221320_schema_update.sql"
    );
    expect(result.planFile).toBe(
      result.file!.replace(/\.(py|sql)$/, ".plan.json")
    );
    expect(result.findings).toEqual([]);
  });

  test.each([
    ["rename-field", []],
    ["split-field", ["contact.fullName"]],
    ["extract-entity", []],
  ])(
    "%s verifies with its seed and checks",
    async (c, acceptLoss) => {
      const { dir, planPath } = project(c);
      const written = writePlannedMigration(
        dir,
        read(c, "before.apsorc"),
        "SchemaUpdate",
        planPath
      );
      const result = await verifyMigration(
        dir,
        fixture(c, "before.apsorc"),
        written.file!,
        cliBin,
        {
          seedFile: fixture(c, "seed.sql"),
          checkFile: fixture(c, "checks.sql"),
          acceptLoss: acceptLoss as string[],
        }
      );
      expect(result.steps).toEqual(
        ["baseline", "seed", "migrate", "count", "data", "check", "drift", "down", "down drift"].map(
          (name) => expect.objectContaining({ name, ok: true })
        )
      );
      expect(result.ok).toBe(true);
    },
    60_000
  );

  test("drift fails when the migration leaves the schema short", async () => {
    const { dir, planPath } = project("rename-field");
    const written = writePlannedMigration(
      dir,
      read("rename-field", "before.apsorc"),
      "SchemaUpdate",
      planPath
    );
    const file = path.join(dir, written.file!);
    // Drop the rename: the deployed column stays "phone".
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file)
        .toString()
        .replace(/^.*RENAME COLUMN \\?"phone\\?" TO .*$/m, "")
    );
    const result = await verifyMigration(
      dir,
      fixture("rename-field", "before.apsorc"),
      written.file!,
      cliBin
    );
    expect(result.ok).toBe(false);
    expect(result.steps[result.steps.length - 1]).toMatchObject({ name: "drift", ok: false });
  }, 60_000);
});
