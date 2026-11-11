import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensureAppMcpWiring, ensureMcpWiring } from "../../../src/lib/utils/crud-deps";
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

});

describe.each(["python", "go"] as const)("mcp in a %s service", (language) => {
  const names = ["list_line_items", "get_line_item", "create_line_item", "update_line_item", "delete_line_item"];
  // Python marks the routes; Go lists the tools next to the MCP endpoint.
  const tools = async (entity: Entity, auth?: AuthConfig) => {
    const g = generator(language, [entity]);
    const files =
      language === "python"
        ? await g.generateController({ entity, relationships: [], relationshipMap: {}, allEntities: [entity], apiType: "rest", auth })
        : await g.generateGuards([entity], auth, {});
    return files.find((f) => f.path === (language === "python" ? "routers/lineitem.py" : "routes/mcp.go"))?.content ?? "";
  };

  test("the tool names match TypeScript, and only opted-in operations are tools", async () => {
    const all = await tools(invoice(true), jwt);
    for (const name of names) expect(all).toContain(`"${name}"`);
    const readOnly = await tools(invoice(["read"]), jwt);
    expect(readOnly).toContain('"list_line_items"');
    expect(readOnly).toContain('"get_line_item"');
    expect(readOnly).not.toContain("create_line_item");
    expect(readOnly).not.toContain("delete_line_item");
    const off = await tools(invoice(), jwt);
    for (const name of names) expect(off).not.toContain(name);
  });

  test("the endpoint is generated only when an entity opts in, and needs sign-in", async () => {
    const file = language === "python" ? "mcp.py" : "routes/mcp.go";
    const on = await generator(language, [invoice(true)]).generateGuards([invoice(true)], jwt, {});
    const endpoint = on.find((f) => f.path === file)!.content;
    expect(endpoint).toContain("oauth-protected-resource");
    // Go names the issuer in the file; Python imports it from auth.py.
    expect(endpoint).toContain(language === "python" ? '[p["issuer"] for p in _PROVIDERS]' : "https://issuer.example.com/");
    const off = await generator(language, [invoice()]).generateGuards([invoice()], jwt, {});
    expect(off.some((f) => f.path === file)).toBe(false);
    await expect(generator(language, [invoice(true)]).generateGuards([invoice(true)], undefined, {})).rejects.toThrow(
      "LineItem.mcp needs an auth block"
    );
  });

  test("a token issued for the MCP endpoint's URL is an accepted audience", async () => {
    const files = await generator(language, [invoice(true)]).generateGuards([invoice(true)], jwt, {});
    expect(files.find((f) => /auth\.(py|go)$/.test(f.path))!.content).toContain("MCP_RESOURCE_URL");
  });
});

// A project with one entry point file and a pyproject.toml.
const app = (file: string, text: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-mcp-wiring-"));
  fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  fs.writeFileSync(path.join(dir, "pyproject.toml"), 'dependencies = [\n    "fastapi>=0.109.0",\n]\n');
  return dir;
};

describe("ensureAppMcpWiring", () => {

  test("python: adds the SDK and mounts after the generated router, once", () => {
    const dir = app("app/main.py", "app = FastAPI()\napp.include_router(autogen_router)\n");
    expect(ensureAppMcpWiring(dir, "python")).toEqual(["pyproject.toml", path.join("app", "main.py")]);
    const main = fs.readFileSync(path.join(dir, "app/main.py"), "utf8");
    expect(main.indexOf("mount_mcp(app)")).toBeGreaterThan(main.indexOf("app.include_router(autogen_router)"));
    expect(fs.readFileSync(path.join(dir, "pyproject.toml"), "utf8")).toContain('"mcp>=2.3,<3"');
    expect(ensureAppMcpWiring(dir, "python")).toEqual([]);
  });

  test("go: mounts after the generated routes, once", () => {
    const dir = app("cmd/main.go", "\tapi := r.Group(\"/api\")\n\troutes.RegisterAllRoutes(api, db)\n");
    expect(ensureAppMcpWiring(dir, "go")).toEqual([path.join("cmd", "main.go")]);
    expect(fs.readFileSync(path.join(dir, "cmd/main.go"), "utf8")).toContain("routes.MountMCP(r, api)");
    expect(ensureAppMcpWiring(dir, "go")).toEqual([]);
  });

  test("an entry point it does not recognise is left alone, with the lines to add", () => {
    const py = app("app/main.py", "app = make_app()\n");
    expect(() => ensureAppMcpWiring(py, "python")).toThrow("mount_mcp(app)");
    expect(fs.readFileSync(path.join(py, "app/main.py"), "utf8")).toBe("app = make_app()\n");
    const go = app("cmd/main.go", "package main\n");
    expect(() => ensureAppMcpWiring(go, "go")).toThrow("routes.MountMCP");
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

const guards = async (entity: Entity, auth: AuthConfig) => {
  const files = await generator("typescript", [entity]).generateGuards([entity], auth, {});
  const file = (name: string) => files.find((f) => f.path === `guards/${name}`)!.content;
  return { guard: file("auth.guard.ts"), key: file("key.guard.ts"), module: file("guards.module.ts") };
};

describe("OAuth sign-in for MCP clients", () => {
  test("a JWT service with MCP tools shares its token check with @apso/mcp", async () => {
    const { guard, key, module } = await guards(invoice(true), jwt);
    // The API key check comes first on /mcp too, then the user's token.
    expect(key).toContain("provide: 'APSO_MCP_AUTH'");
    expect(key).toContain("inject: [ApiKeyGuard]");
    expect(key).toContain("verify: (request: any) => guard.authenticate(request)");
    expect(guard).toContain("process.env.MCP_RESOURCE_URL");
    expect(module).toContain("McpAuthProvider,");
  });

  test("no MCP tools, or no JWT issuer to sign in with, means no sign-in settings", async () => {
    const plain = await guards(invoice(), jwt);
    expect(plain.key).not.toContain("APSO_MCP_AUTH");
    expect(plain.guard).toContain("async authenticate(request: any)");
    expect(plain.module).not.toContain("McpAuthProvider");
  });
});
