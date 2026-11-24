import { expect, describe, test } from "@jest/globals";
import { TypeScriptGenerator } from "../../../src/lib/generators/typescript";
import { parseQuery } from "../../../src/lib/apsorc-parser";
import { Entity, QueryConfig } from "../../../src/lib/types";

const entity: Entity = { name: "Tag", fields: [{ name: "name", type: "text" }] };
const generator = new TypeScriptGenerator({
  rootFolder: "/tmp/query-settings-test",
  entities: [entity],
  relationshipMap: {},
  apiType: "rest",
  language: "typescript",
});

async function controller(query?: QueryConfig): Promise<string> {
  const files = await generator.generateController({
    entity,
    relationships: [],
    allEntities: [entity],
    apiType: "rest",
    relationshipMap: {},
    query,
  });
  return files.find((f) => f.path.endsWith("Tag.controller.ts"))!.content;
}

describe('.apsorc "query" and "guards"', () => {
  test("defaults: PostgREST only, 25 rows, no forced page object", async () => {
    const src = await controller();
    expect(src).toContain("dialects: ['postgrest']");
    expect(src).toContain("limit: 25,");
    expect(src).not.toContain("alwaysPaginate");
  });

  test("an app on nestjsx queries keeps them, with its own page size", async () => {
    const src = await controller({ dialects: ["nestjsx", "postgrest"], limit: 5, alwaysPaginate: true });
    expect(src).toContain("dialects: ['nestjsx', 'postgrest']");
    expect(src).toContain("limit: 5,");
    expect(src).toContain("alwaysPaginate: true,");
    expect(src).not.toContain("PostgREST syntax only");
  });

  test('"guards": false leaves GuardsModule out of the module list', async () => {
    const [on] = await generator.generateIndexModule([entity], "rest", {});
    const [off] = await generator.generateIndexModule([entity], "rest", { guards: false });
    expect(on.content).toContain("GuardsModule,");
    expect(off.content).not.toContain("GuardsModule");
    expect(off.content).toContain("TagModule,");
  });

  test.each([
    ["not an object", [], /must be an object/],
    ["unknown key", { page: 1 }, /unknown setting/],
    ["empty dialects", { dialects: [] }, /dialects/],
    ["bad dialect", { dialects: ["graphql"] }, /dialects/],
    ["limit 0", { limit: 0 }, /limit/],
    ["limit 101", { limit: 101 }, /limit/],
    ["limit 2.5", { limit: 2.5 }, /limit/],
    ["alwaysPaginate string", { alwaysPaginate: "yes" }, /alwaysPaginate/],
  ])("refuses a query block with %s", (_label, raw, message) => {
    expect(() => parseQuery(raw)).toThrow(message);
  });

  test("accepts a valid block and leaves an absent one undefined", () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- the absent case
    expect(parseQuery(undefined)).toBeUndefined();
    expect(parseQuery({ dialects: ["nestjsx"], limit: 100 })).toEqual({
      dialects: ["nestjsx"],
      limit: 100,
      alwaysPaginate: undefined,
    });
  });
});

describe('.apsorc "guards": false with auth', () => {
  test("is refused, since auth is enforced by those guards", async () => {
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const { parseApsorc } = await import("../../../src/lib/apsorc-parser");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guards-off-"));
    const cwd = process.cwd();
    const write = (rc: object) => fs.writeFileSync(path.join(dir, ".apsorc"), JSON.stringify(rc));
    const base = { version: 2, rootFolder: "src", apiType: "Rest", entities: [entity], relationships: [] };
    try {
      process.chdir(dir);
      write({ ...base, guards: false, auth: { provider: "clerk", jwt: { issuer: "https://clerk.example.com" } } });
      expect(() => parseApsorc()).toThrow(/"guards": false/);
      write({ ...base, guards: false, query: { dialects: ["nestjsx"] } });
      expect(parseApsorc()).toMatchObject({ guards: false, query: { dialects: ["nestjsx"] } });
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
