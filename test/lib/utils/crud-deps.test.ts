import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { APSO_CRUD_DEPS, ensureCrudDeps } from "../../../src/lib/utils/crud-deps";
import { TypeScriptGenerator } from "../../../src/lib/generators/typescript";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";

function projectWith(pkg: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-crud-deps-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  return dir;
}
const readPkg = (dir: string) =>
  // eslint-disable-next-line unicorn/prefer-json-parse-buffer -- JSON.parse's TS type requires a string
  JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));

describe("ensureCrudDeps", () => {
  test("adds @apso/crud* to a v1 (@nestjsx/crud) project and keeps @nestjsx", () => {
    const dir = projectWith({
      dependencies: { "@nestjs/core": "^10.0.0", "@nestjsx/crud": "4.5.0" },
    });

    expect(ensureCrudDeps(dir)).toEqual(Object.keys(APSO_CRUD_DEPS));

    const deps = readPkg(dir).dependencies;
    for (const [name, version] of Object.entries(APSO_CRUD_DEPS)) {
      expect(deps[name]).toBe(version);
    }
    expect(deps["@nestjsx/crud"]).toBe("4.5.0");
    expect(fs.readFileSync(path.join(dir, "package.json"), "utf8").endsWith("\n")).toBe(true);
  });

  test("leaves a v2 project untouched", () => {
    const dir = projectWith({ dependencies: { ...APSO_CRUD_DEPS, "@apso/crud": "^1.2.0" } });
    const before = fs.readFileSync(path.join(dir, "package.json"), "utf8");

    expect(ensureCrudDeps(dir)).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "package.json"), "utf8")).toBe(before);
  });

  test("is a no-op without a package.json", () => {
    expect(ensureCrudDeps(fs.mkdtempSync(path.join(os.tmpdir(), "apso-crud-deps-")))).toEqual([]);
  });
});

// Drift guard: every @apso/* package the generated code imports must be one
// ensureCrudDeps declares. Uses the prod "Inventory Management" schema that
// failed the in-browser build (9 entities, 13 relationships, 5 FKs on one
// entity) so the import surface is broad.
describe("generated TypeScript imports", () => {
  test("only import @apso packages listed in APSO_CRUD_DEPS", async () => {
    const rc = JSON.parse(
      // eslint-disable-next-line unicorn/prefer-json-parse-buffer -- JSON.parse's TS type requires a string
      fs.readFileSync(path.join(__dirname, "../../fixtures/inventory-multi-fk.apsorc"), "utf8")
    );
    const { entities, relationshipMap } = parseApsorcV2(rc);
    const generator = new TypeScriptGenerator({
      rootFolder: "src",
      entities,
      relationshipMap,
      apiType: "rest",
      language: "typescript",
    });

    const files = [];
    /* eslint-disable no-await-in-loop -- generated in order, like generate.ts */
    for (const entity of entities) {
      const args = {
        entity,
        relationships: relationshipMap[entity.name] || [],
        allEntities: entities,
        apiType: "rest",
        relationshipMap,
      };
      files.push(
        ...(await generator.generateEntity(args)),
        ...(await generator.generateDto(args)),
        ...(await generator.generateService(args)),
        ...(await generator.generateController(args)),
        ...(await generator.generateModule({ ...args, includeController: true }))
      );
    }
    /* eslint-enable no-await-in-loop */
    files.push(...(await generator.generateGuards(entities)));

    const imported = new Set<string>();
    for (const f of files) {
      for (const m of f.content.matchAll(/from ["'](@apso\/[\w-]+)/g)) imported.add(m[1]);
    }
    expect(imported.size).toBeGreaterThan(0);
    for (const name of imported) expect(Object.keys(APSO_CRUD_DEPS)).toContain(name);
  });
});
