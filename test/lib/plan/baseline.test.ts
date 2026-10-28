import { expect, describe, test } from "@jest/globals";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveBaseline } from "../../../src/lib/plan/baseline";

const schema = (n: number) =>
  ({
    version: 2,
    rootFolder: "src",
    entities: [{ name: `E${n}`, fields: [] }],
    relationships: [],
  } as any);
const project = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-baseline-"));
  fs.mkdirSync(path.join(dir, "src", "migrations"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".apsorc"), JSON.stringify(schema(9)));
  return dir;
};
const savePlan = (dir: string, ts: number, before: number, after: number) =>
  fs.writeFileSync(
    path.join(
      dir,
      "src",
      "migrations",
      `${ts}-SchemaUpdate-migration.plan.json`
    ),
    JSON.stringify({
      version: 1,
      questions: [],
      before: schema(before),
      after: schema(after),
    })
  );
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    stdio: "ignore",
  });

describe("resolveBaseline", () => {
  test("the newest migration's after schema", () => {
    const dir = project();
    savePlan(dir, 1000, 1, 2);
    savePlan(dir, 2000, 2, 3);
    const b = resolveBaseline(dir, schema(9));
    expect(b.schema.entities[0].name).toBe("E3");
    expect(b.source).toBe(
      "src/migrations/2000-SchemaUpdate-migration.plan.json"
    );
  });

  test("a plan in progress beats the newest migration", () => {
    const dir = project();
    savePlan(dir, 1000, 1, 2);
    const planPath = path.join(dir, ".apso", "migration-plan.json");
    fs.mkdirSync(path.dirname(planPath));
    fs.writeFileSync(
      planPath,
      JSON.stringify({ questions: [], before: schema(5) })
    );
    expect(
      resolveBaseline(dir, schema(9), undefined, planPath).schema.entities[0]
        .name
    ).toBe("E5");
  });

  test("--baseline beats everything", () => {
    const dir = project();
    savePlan(dir, 1000, 1, 2);
    const file = path.join(dir, "deployed.apsorc");
    fs.writeFileSync(file, JSON.stringify(schema(7)));
    expect(resolveBaseline(dir, schema(9), file).schema.entities[0].name).toBe(
      "E7"
    );
  });

  test("without planned migrations, the .apsorc from the last commit that changed them", () => {
    const dir = project();
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, ".apsorc"), JSON.stringify(schema(1)));
    fs.writeFileSync(path.join(dir, "src", "migrations", "1-Init.ts"), "");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    fs.writeFileSync(path.join(dir, ".apsorc"), JSON.stringify(schema(2)));
    git(dir, "commit", "-qam", "schema change, no migration yet");
    const b = resolveBaseline(dir, schema(2));
    expect(b.schema.entities[0].name).toBe("E1");
    expect(b.source).toMatch(/the last commit that changed src\/migrations/);
  });

  test("says what to do when nothing tells it", () => {
    expect(() => resolveBaseline(project(), schema(9))).toThrow(/--baseline/);
  });
});
