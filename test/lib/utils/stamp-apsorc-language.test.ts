import { expect } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { stampApsorcLanguage } from "../../../src/lib/utils/template";

const noop = (): void => { /* no-op logger for tests */ };

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apso-stamp-test-"));
}

describe("stampApsorcLanguage", () => {
  test("writes the language into an .apsorc that lacks one (scaffold-smoke red)", () => {
    const dir = tmpProject();
    fs.writeFileSync(
      path.join(dir, ".apsorc"),
      JSON.stringify({ version: 1, rootFolder: "src", entities: [] }, null, 4)
    );

    stampApsorcLanguage(dir, "typescript", noop);

    // eslint-disable-next-line unicorn/prefer-json-parse-buffer -- TS types JSON.parse as string-only
    const config = JSON.parse(fs.readFileSync(path.join(dir, ".apsorc"), "utf-8"));
    expect(config.language).toBe("typescript");
    // Existing fields survive the rewrite.
    expect(config.version).toBe(1);
    expect(config.rootFolder).toBe("src");
    expect(config.entities).toEqual([]);
  });

  test("leaves an existing language value alone", () => {
    const dir = tmpProject();
    const original = JSON.stringify({ version: 2, language: "go", entities: [] });
    fs.writeFileSync(path.join(dir, ".apsorc"), original);

    stampApsorcLanguage(dir, "typescript", noop);

    expect(fs.readFileSync(path.join(dir, ".apsorc"), "utf-8")).toBe(original);
  });

  test("is a no-op when the project has no .apsorc", () => {
    const dir = tmpProject();

    stampApsorcLanguage(dir, "typescript", noop);

    expect(fs.existsSync(path.join(dir, ".apsorc"))).toBe(false);
  });

  test("leaves an unparseable .apsorc untouched", () => {
    const dir = tmpProject();
    const original = '// jsonc comment\n{ "version": 1 }\n';
    fs.writeFileSync(path.join(dir, ".apsorc"), original);

    stampApsorcLanguage(dir, "python", noop);

    expect(fs.readFileSync(path.join(dir, ".apsorc"), "utf-8")).toBe(original);
  });

  test("preserves the file's existing indentation", () => {
    const dir = tmpProject();
    fs.writeFileSync(
      path.join(dir, ".apsorc"),
      JSON.stringify({ version: 1, entities: [] }, null, 4)
    );

    stampApsorcLanguage(dir, "go", noop);

    const raw = fs.readFileSync(path.join(dir, ".apsorc"), "utf-8");
    expect(raw).toContain('    "version"');
    expect(JSON.parse(raw).language).toBe("go");
  });
});
