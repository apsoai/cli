import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ORM_CONFIG_V1,
  ORM_CONFIG_V1_PGLITE,
  PGLITE_DEPS,
  upgradeOrmConfigForPglite,
} from "../../../src/lib/utils/pglite-upgrade";
import { supportsPglite } from "../../../src/lib/verify";

const project = (ormConfig: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-pglite-upgrade-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "orm.config.ts"), ormConfig);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: { typeorm: "^0.3.0" } })
  );
  return dir;
};
const read = (dir: string, file: string) =>
  fs.readFileSync(path.join(dir, file), "utf8");

describe("upgradeOrmConfigForPglite", () => {
  test("upgrades the stock v1 config (any whitespace) and declares the PGlite packages", () => {
    const dir = project(ORM_CONFIG_V1.replace(/\n/g, "\r\n  "));
    expect(upgradeOrmConfigForPglite(dir)).toBe(true);
    expect(read(dir, "src/orm.config.ts")).toBe(ORM_CONFIG_V1_PGLITE);
    expect(supportsPglite(dir)).toBe(true);
    expect(JSON.parse(read(dir, "package.json")).dependencies).toMatchObject(
      PGLITE_DEPS
    );
    expect(upgradeOrmConfigForPglite(dir)).toBe(false);
  });

  test("leaves a customized config alone", () => {
    const custom = ORM_CONFIG_V1.replace(
      "synchronize:",
      "poolSize: 20,\n  synchronize:"
    );
    const dir = project(custom);
    expect(upgradeOrmConfigForPglite(dir)).toBe(false);
    expect(read(dir, "src/orm.config.ts")).toBe(custom);
  });

  test("passes the data dir as an option, which typeorm-pglite 0.3.4 needs", () => {
    const dir = project(
      "driver: new PGliteDriver(process.env.PGLITE_DATA_DIR || undefined).driver"
    );
    expect(upgradeOrmConfigForPglite(dir)).toBe(true);
    expect(read(dir, "src/orm.config.ts")).toBe(
      "driver: new PGliteDriver({ dataDir: process.env.PGLITE_DATA_DIR }).driver"
    );
    expect(ORM_CONFIG_V1_PGLITE).toContain(
      "dataDir: process.env.PGLITE_DATA_DIR"
    );
  });
});
