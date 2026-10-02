import { expect } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { lintApsorc } from "../../../src/commands/schema/lint";
import { ApsorcType } from "../../../src/lib/apsorc-parser";

const apsorc = {
  version: 2,
  rootFolder: "src",
  entities: [
    { name: "Contact", created_at: true, updated_at: true, fields: [{ name: "notes", type: "text" }] },
    { name: "Note", created_at: true, updated_at: true, fields: [{ name: "body", type: "text" }] },
  ],
  relationships: [{ from: "Note", to: "Contact", type: "ManyToOne", index: true }],
} as unknown as ApsorcType;

describe("apso schema lint", () => {
  let dir: string;
  let configPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-lint-"));
    configPath = path.join(dir, ".apsorc");
    fs.writeFileSync(configPath, JSON.stringify(apsorc));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("reports the collision without touching the file", () => {
    const { result, fixed } = lintApsorc(configPath, apsorc, false);
    expect(result.errorCount).toBe(1);
    expect(result.issues[0]).toMatchObject({ rule: "FIELD_RELATIONSHIP_COLLISION", entity: "Contact", field: "notes", fixable: true });
    expect(fixed).toEqual([]);
    expect(fs.readFileSync(configPath, "utf8")).toBe(JSON.stringify(apsorc));
  });

  test("--fix renames the field, saves .apsorc and keeps a backup", () => {
    const { result, fixed, backupPath } = lintApsorc(configPath, apsorc, true);
    expect(result.errorCount).toBe(0);
    expect(fixed.map((i) => i.rule)).toEqual(["FIELD_RELATIONSHIP_COLLISION"]);
    // eslint-disable-next-line unicorn/prefer-json-parse-buffer -- JSON.parse's TS type requires a string
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(saved.entities[0].fields[0].name).toBe("notes_text");
    expect(saved.relationships).toEqual(apsorc.relationships);
    expect(fs.readFileSync(backupPath!, "utf8")).toBe(JSON.stringify(apsorc));
  });
});
