import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensureMcpWiring } from "../../../src/lib/utils/crud-deps";
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

const project = (bootstrap: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-mcp-wiring-"));
  fs.mkdirSync(path.join(dir, "src/config"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
  fs.writeFileSync(path.join(dir, "src/config/nest-app.config.ts"), bootstrap);
  return dir;
};

describe("ensureMcpWiring", () => {
  const template = "const document = SwaggerModule.createDocument(app, options);\n  SwaggerModule.setup('_docs', app, document);\n";

  test("adds the package and the mount call once", () => {
    const dir = project(template);
    expect(ensureMcpWiring(dir, "src")).toEqual(["package.json", path.join("src", "config", "nest-app.config.ts")]);
    const bootstrap = fs.readFileSync(path.join(dir, "src/config/nest-app.config.ts"), "utf8");
    expect(bootstrap).toContain("import { mountMcp } from '@apso/mcp';");
    expect(bootstrap).toContain("mountMcp(app, document);");
    expect(JSON.parse(String(fs.readFileSync(path.join(dir, "package.json")))).dependencies["@apso/mcp"]).toBeDefined();
    expect(ensureMcpWiring(dir, "src")).toEqual([]);
  });

  test("a bootstrap it does not recognise is left alone, with the lines to add", () => {
    const dir = project("export async function configureNestApp() {}\n");
    expect(() => ensureMcpWiring(dir, "src")).toThrow("call mountMcp(app, document)");
    expect(fs.readFileSync(path.join(dir, "src/config/nest-app.config.ts"), "utf8")).not.toContain("mountMcp");
  });
});

describe("OAuth sign-in for MCP clients", () => {
  const guards = async (entity: Entity, auth: AuthConfig) => {
    const files = await generator("typescript", [entity]).generateGuards([entity], auth, {});
    const file = (name: string) => files.find((f) => f.path === `guards/${name}`)!.content;
    return { guard: file("auth.guard.ts"), module: file("guards.module.ts") };
  };

  test("a JWT service with MCP tools shares its token check with @apso/mcp", async () => {
    const { guard, module } = await guards(invoice(true), jwt);
    expect(guard).toContain("provide: 'APSO_MCP_AUTH'");
    expect(guard).toContain("verify: (request: any) => guard.authenticate(request)");
    expect(guard).toContain("process.env.MCP_RESOURCE_URL");
    expect(module).toContain("McpAuthProvider,");
  });

  test("no MCP tools, or no JWT issuer to sign in with, means no sign-in settings", async () => {
    const plain = await guards(invoice(), jwt);
    expect(plain.guard).not.toContain("APSO_MCP_AUTH");
    expect(plain.guard).toContain("async authenticate(request: any)");
    expect(plain.module).not.toContain("McpAuthProvider");

    const apiKey = { name: "ApiKey", fields: [{ name: "keyHash", type: "text" as const }] };
    const files = await generator("typescript", [invoice(true), apiKey]).generateGuards([invoice(true), apiKey], { provider: "api-key" }, {});
    expect(files.find((f) => f.path === "guards/guards.module.ts")!.content).not.toContain("McpAuthProvider");
  });
});
