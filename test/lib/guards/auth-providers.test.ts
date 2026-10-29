/* eslint-disable no-await-in-loop -- each language is checked in turn */
import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GoGenerator } from "../../../src/lib/generators/go";
import { PythonGenerator } from "../../../src/lib/generators/python";
import { TypeScriptGenerator } from "../../../src/lib/generators/typescript";
import {
  AuthConfig,
  Entity,
  GeneratorConfig,
  TargetLanguage,
  resolveJwtAuth,
} from "../../../src/lib/types";
import { addMissingPythonDep } from "../../../src/lib/utils/crud-deps";

const entities: Entity[] = [
  { name: "Organization", fields: [{ name: "name", type: "text" }] },
  {
    name: "ApiKey",
    fields: [
      { name: "keyHash", type: "text" },
      { name: "status", type: "enum", values: ["active", "revoked"] },
      { name: "expiresAt", type: "date", nullable: true },
    ],
  },
  {
    name: "Project",
    scopeBy: "organizationId",
    fields: [{ name: "title", type: "text" }],
  },
];

const config = (language: TargetLanguage): GeneratorConfig => ({
  rootFolder: "/tmp/auth-test",
  entities,
  relationshipMap: {},
  apiType: "rest",
  language,
});
// Each constructor points Eta at its language's templates (global state), so
// build the generator at the point of use.
const generators = {
  get typescript() {
    return new TypeScriptGenerator(config("typescript"));
  },
  get go() {
    return new GoGenerator(config("go"));
  },
  get python() {
    return new PythonGenerator(config("python"));
  },
};

const jwt = (provider: "auth0" | "clerk" | "cognito" | "jwt"): AuthConfig => ({
  provider,
  jwt: { issuer: "https://issuer.example.com/", audience: "api" },
});

const guardFile = async (language: TargetLanguage, auth: AuthConfig) => {
  const files = await generators[language].generateGuards(entities, auth);
  const name = { typescript: "guards/auth.guard.ts", go: "middleware/auth.go", python: "auth.py" }[language];
  return files.find((f) => f.path === name)?.content ?? "";
};

describe("resolveJwtAuth", () => {
  test("defaults the JWKS URL from the issuer and RS256", () => {
    const r = resolveJwtAuth({ provider: "jwt", jwt: { issuer: "https://a.example.com/" } });
    expect(r.jwksUri).toBe("https://a.example.com/.well-known/jwks.json");
    expect(r.algorithms).toEqual(["RS256"]);
    expect(r.audience).toBeUndefined();
  });

  test("fills each provider's claim names, and .apsorc claims override them", () => {
    expect(resolveJwtAuth({ provider: "clerk", jwt: { issuer: "https://c" } }).claims).toMatchObject({ workspaceId: "o.id", roles: "o.rol" });
    expect(resolveJwtAuth({ provider: "cognito", jwt: { issuer: "https://c" } }).claims.roles).toBe("cognito:groups");
    expect(
      resolveJwtAuth({ provider: "auth0", jwt: { issuer: "https://c" }, claims: { workspaceId: "https://x/org" } }).claims
    ).toMatchObject({ userId: "sub", workspaceId: "https://x/org" });
  });

  test("accepts EdDSA (Better Auth's JWT plugin) and keeps authorized parties", () => {
    const r = resolveJwtAuth({ provider: "jwt", jwt: { issuer: "https://c", algorithms: ["EdDSA"], authorizedParties: ["https://app"] } });
    expect(r.algorithms).toEqual(["EdDSA"]);
    expect(r.authorizedParties).toEqual(["https://app"]);
  });

  test("rejects a missing issuer and symmetric algorithms", () => {
    expect(() => resolveJwtAuth({ provider: "jwt", jwt: { issuer: "" } })).toThrow(/issuer is required/);
    expect(() => resolveJwtAuth({ provider: "jwt", jwt: { issuer: "https://c", algorithms: ["HS256"] } })).toThrow(/HS256 not supported/);
  });
});

describe("generated auth for JWT providers", () => {
  for (const language of ["typescript", "go", "python"] as TargetLanguage[]) {
    for (const provider of ["auth0", "clerk", "cognito", "jwt"] as const) {
      test(`${language} / ${provider} verifies against the issuer's JWKS`, async () => {
        const code = await guardFile(language, jwt(provider));
        expect(code).toContain("https://issuer.example.com/.well-known/jwks.json");
        expect(code).toContain("AUTH_JWKS_URI");
        expect(code).toContain("RS256");
      });
    }
  }

  test("Cognito checks client_id when a token has no aud", async () => {
    for (const language of ["typescript", "go", "python"] as TargetLanguage[]) {
      expect(await guardFile(language, jwt("cognito"))).toContain("client_id");
      expect(await guardFile(language, jwt("auth0"))).not.toContain("client_id");
    }
  });
});

describe("generated wiring", () => {
  test("TypeScript lists GuardsModule so its global guards run", async () => {
    const [index] = await generators.typescript.generateIndexModule(entities, "rest", { auth: jwt("jwt") });
    expect(index.content).toContain("GuardsModule");
    const [noAuth] = await generators.typescript.generateIndexModule([entities[0]], "rest", {});
    expect(noAuth.content).not.toContain("GuardsModule");
  });

  test("TypeScript adds @CrudAuth to scoped controllers only when auth is set", async () => {
    const opts = { entity: entities[2], relationships: [], allEntities: entities, apiType: "rest", relationshipMap: {} };
    const withAuth = await generators.typescript.generateController({ ...opts, auth: jwt("jwt") });
    const ctrl = withAuth.find((f) => f.path.endsWith(".controller.ts"))!.content;
    expect(ctrl).toContain("@CrudAuth");
    expect(ctrl).toContain("organizationId: req.organizationId");
    const without = await generators.typescript.generateController(opts);
    expect(without.find((f) => f.path.endsWith(".controller.ts"))!.content).not.toContain("@CrudAuth");
  });

  test("Go registers the middleware on the /api group", async () => {
    const [routes] = await generators.go.generateIndexModule(entities, "rest", { auth: jwt("jwt") });
    expect(routes.content).toContain("r.Use(middleware.AuthMiddleware(db))");
    expect(await generators.go.generateGuards(entities)).toEqual([]);
  });

  test("Python makes the generated router depend on require_auth", async () => {
    const [index] = await generators.python.generateIndexModule(entities, "rest", { auth: jwt("jwt") });
    expect(index.content).toContain("dependencies=[Depends(require_auth)]");
    const [noAuth] = await generators.python.generateIndexModule(entities, "rest", {});
    expect(noAuth.content).not.toContain("require_auth");
  });
});

describe("generated auth for API keys", () => {
  const apiKey: AuthConfig = { provider: "api-key" };

  test("every language hashes the key and enforces status and expiry", async () => {
    for (const language of ["typescript", "go", "python"] as TargetLanguage[]) {
      const code = await guardFile(language, apiKey);
      expect(code.toLowerCase()).toContain("sha256");
      expect(code).toContain("x-api-key");
      expect(code).toMatch(/not active/);
      expect(code).toMatch(/expired/);
    }
  });

  test("a missing key entity or hash field fails generation", async () => {
    await expect(generators.go.generateGuards([entities[0]], apiKey)).rejects.toThrow(/not an entity/);
    await expect(
      generators.python.generateGuards([{ name: "ApiKey", fields: [{ name: "name", type: "text" }] }], apiKey)
    ).rejects.toThrow(/keyHash/);
  });
});

describe("session providers outside TypeScript", () => {
  test("Go and Python refuse better-auth instead of generating an open API", async () => {
    for (const language of ["go", "python"] as TargetLanguage[]) {
      await expect(generators[language].generateGuards(entities, { provider: "better-auth" })).rejects.toThrow(/TypeScript services only/);
    }
  });
});

const pyProject = (deps: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-pydep-"));
  fs.writeFileSync(path.join(dir, "pyproject.toml"), `[project]\nname = "x"\n${deps}\n\n[project.optional-dependencies]\ndev = [\n    "pytest",\n]\n`);
  return dir;
};
const readPyProject = (dir: string) => fs.readFileSync(path.join(dir, "pyproject.toml"), "utf8");

describe("addMissingPythonDep", () => {
  const project = pyProject;
  const read = readPyProject;

  test("adds to a multi-line list without breaking extras like uvicorn[standard]", () => {
    const dir = project('dependencies = [\n    "fastapi>=0.109.0",\n    "uvicorn[standard]>=0.27.0",\n]');
    expect(addMissingPythonDep(dir, "PyJWT[crypto]>=2.8.0")).toBe(true);
    expect(read(dir)).toContain('    "uvicorn[standard]>=0.27.0",\n    "PyJWT[crypto]>=2.8.0",\n]');
    expect(read(dir)).toContain('dev = [\n    "pytest",\n]');
    expect(addMissingPythonDep(dir, "pyjwt>=2.9")).toBe(false);
  });

  test("adds to a one-line list", () => {
    const dir = project('dependencies = ["fastapi"]');
    expect(addMissingPythonDep(dir, "PyJWT[crypto]>=2.8.0")).toBe(true);
    expect(read(dir)).toContain('dependencies = ["fastapi",\n    "PyJWT[crypto]>=2.8.0",\n]');
    expect(read(dir)).toContain('dev = [\n    "pytest",\n]');
  });
});
