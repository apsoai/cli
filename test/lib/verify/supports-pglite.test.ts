import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { smokeTest, supportsPglite } from "../../../src/lib/verify";

const project = (ormConfig?: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-pglite-check-"));
  if (ormConfig !== undefined) {
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "orm.config.ts"), ormConfig);
  }
  return dir;
};

describe("supportsPglite", () => {
  test("true for the current template's orm.config", () => {
    expect(supportsPglite(project("PGliteDriver = require('typeorm-pglite').PGliteDriver;"))).toBe(true);
  });

  test("false for a v1 orm.config or none", () => {
    expect(supportsPglite(project("export default new DataSource({ type: 'postgres' });"))).toBe(false);
    expect(supportsPglite(project())).toBe(false);
  });

  test("checks pass as skipped instead of failing a v1 project", async () => {
    const result = await smokeTest(project("type: 'postgres'"), ["Widget"], { skipBuild: true });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual(["skipped"]);
  });
});
