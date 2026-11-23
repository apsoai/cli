import { afterEach, describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeApsorcIdentity } from "../../src/lib/utils/apsorc-identity";
import { credentials } from "../../src/lib/config";

const ids = { serviceName: "my-api", serviceId: "42", workspaceId: "7" };

function tmp(contents?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apsorc-"));
  if (contents !== undefined) fs.writeFileSync(path.join(dir, ".apsorc"), contents);
  return dir;
}

describe("writeApsorcIdentity", () => {
  it("adds identity after version, keeps the rest and the indent", () => {
    const dir = tmp('{\n    "version": 1,\n    "rootFolder": "src",\n    "entities": []\n}\n');
    expect(writeApsorcIdentity(dir, ids)).toBe(true);
    const text = fs.readFileSync(path.join(dir, ".apsorc"), "utf8");
    expect(Object.keys(JSON.parse(text))).toEqual(["version", "serviceName", "serviceId", "workspaceId", "rootFolder", "entities"]);
    expect(text).toContain('\n    "serviceName": "my-api"');
  });

  it("replaces existing identity instead of duplicating it", () => {
    const dir = tmp(JSON.stringify({ version: 2, serviceName: "old", serviceId: "1", entities: [] }));
    writeApsorcIdentity(dir, ids);
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, ".apsorc"), "utf8"));
    expect(parsed).toMatchObject(ids);
    expect(Object.keys(parsed).filter((k) => k === "serviceName")).toHaveLength(1);
  });

  it("returns false when .apsorc is missing or not JSON", () => {
    expect(writeApsorcIdentity(tmp(), ids)).toBe(false);
    expect(writeApsorcIdentity(tmp("not json"), ids)).toBe(false);
  });
});

describe("APSO_TOKEN", () => {
  afterEach(() => { delete process.env.APSO_TOKEN; });
  it("counts as valid credentials without a login", () => {
    process.env.APSO_TOKEN = "tok";
    expect(credentials.isValid()).toBe(true);
    expect(credentials.read()?.tokens.accessToken).toBe("tok");
  });
});
