import { expect, describe, test, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Generate from "../../src/commands/generate";

// apsoai/cli#157: entities removed from .apsorc must lose their autogen files.
const entity = (name: string) => ({
  name,
  created_at: true,
  updated_at: true,
  primaryKeyType: "serial",
  fields: [{ name: "title", type: "text" }],
});

const writeApsorc = (dir: string, language: string, rootFolder: string, names: string[]) =>
  fs.writeFileSync(
    path.join(dir, ".apsorc"),
    JSON.stringify({
      version: 2,
      rootFolder,
      language,
      apiType: "Rest",
      entities: names.map((name) => entity(name)),
      relationships: [],
    })
  );

const listFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();

const cwd = process.cwd();
afterEach(() => process.chdir(cwd));

describe("apso generate removes stale autogen files", () => {
  test.each([
    ["typescript", "src"],
    ["python", "app"],
    ["go", "."],
  ])("%s", async (language, rootFolder) => {
    jest.spyOn(console, "log").mockReturnValue();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-generate-"));
    process.chdir(dir);
    const autogen = path.join(dir, rootFolder, "autogen");
    const extension = path.join(dir, rootFolder, "extensions", "Widget", "custom.txt");
    fs.mkdirSync(path.dirname(extension), { recursive: true });
    fs.writeFileSync(extension, "hand-written");
    // A template seed without the Apso header must survive cleanup.
    fs.mkdirSync(autogen, { recursive: true });
    fs.writeFileSync(path.join(autogen, ".gitkeep"), "");

    writeApsorc(dir, language, rootFolder, ["Gadget", "Widget"]);
    await Generate.run(["--skip-format"]);
    const before = listFiles(autogen);
    const widgetFiles = before.filter((f) => /widget/i.test(f));
    expect(widgetFiles.length).toBeGreaterThan(0);
    const gadgetFiles = before.filter((f) => /gadget/i.test(f));
    expect(gadgetFiles.length).toBeGreaterThan(0);
    const gadgetContents = gadgetFiles.map((f) => fs.readFileSync(path.join(autogen, f), "utf8"));

    writeApsorc(dir, language, rootFolder, ["Gadget"]);
    await Generate.run(["--skip-format"]);
    const after = listFiles(autogen);

    expect(after.filter((f) => /widget/i.test(f))).toEqual([]);
    expect(after.filter((f) => /gadget/i.test(f))).toEqual(gadgetFiles);
    expect(gadgetFiles.map((f) => fs.readFileSync(path.join(autogen, f), "utf8"))).toEqual(
      gadgetContents
    );
    expect(after).toContain(".gitkeep");
    expect(fs.readFileSync(extension, "utf8")).toBe("hand-written");
    // Two full generates, plus Biome formatting for TypeScript: slow on CI runners.
  }, 30_000);
});
