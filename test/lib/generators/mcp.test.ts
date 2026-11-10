import { expect, describe, test } from "@jest/globals";
import { mcpOperations } from "../../../src/lib/guards";
import { GoGenerator } from "../../../src/lib/generators/go";
import { PythonGenerator } from "../../../src/lib/generators/python";
import { TypeScriptGenerator } from "../../../src/lib/generators/typescript";
import { AuthConfig, Entity, GeneratorConfig, TargetLanguage } from "../../../src/lib/types";

const invoice = (mcp?: unknown): Entity => ({
  name: "LineItem",
  mcp: mcp as Entity["mcp"],
  fields: [{ name: "total", type: "integer" }],
});
const jwt: AuthConfig = { provider: "jwt", jwt: { issuer: "https://issuer.example.com/", audience: "api" } };

// Each constructor points Eta at its language's templates, so build at the point of use.
const generator = (language: TargetLanguage, entities: Entity[]) => {
  const config: GeneratorConfig = { rootFolder: "/tmp/mcp-test", entities, relationshipMap: {}, apiType: "rest", language };
  if (language === "go") return new GoGenerator(config);
  if (language === "python") return new PythonGenerator(config);
  return new TypeScriptGenerator(config);
};

const controller = async (entity: Entity, auth?: AuthConfig) => {
  const files = await generator("typescript", [entity]).generateController({ entity, relationships: [], relationshipMap: {}, allEntities: [entity], apiType: "rest", auth });
  return files.find((f) => f.path.endsWith(".controller.ts"))!.content;
};

describe("mcp in .apsorc", () => {
  test("is off unless the entity opts in", async () => {
    expect(mcpOperations(invoice())).toEqual([]);
    expect(await controller(invoice(), jwt)).not.toContain("McpTool");
  });

  test("true exposes every operation; a list exposes only those", async () => {
    const all = await controller(invoice(true), jwt);
    expect(all).toContain("import { McpTool } from '@apso/mcp'");
    for (const name of ["list_line_items", "get_line_item", "create_line_item", "update_line_item", "delete_line_item"])
      expect(all).toContain(`@McpTool({ name: '${name}'`);

    const readOnly = await controller(invoice(["read"]), jwt);
    expect(readOnly).toContain("name: 'list_line_items'");
    expect(readOnly).toContain("name: 'get_line_item'");
    expect(readOnly).not.toContain("create_line_item");
    expect(readOnly).not.toContain("delete_line_item");
  });

  test("rejects an unknown operation and needs auth", async () => {
    expect(() => mcpOperations(invoice(["write"]))).toThrow("LineItem.mcp must be true or a list of");
    expect(() => mcpOperations(invoice("yes"))).toThrow("LineItem.mcp must be true or a list of");
    await expect(controller(invoice(true))).rejects.toThrow("LineItem.mcp needs an auth block");
  });

  test.each(["python", "go"] as const)("%s refuses it for now", async (language) => {
    await expect(generator(language, [invoice(true)]).generateGuards([invoice(true)], jwt)).rejects.toThrow(
      "TypeScript services only"
    );
  });
});
