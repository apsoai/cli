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
  assertSignInProvider,
  resolveJwtAuth,
} from "../../../src/lib/types";
import { addMissingPythonDep } from "../../../src/lib/utils/crud-deps";
import { ensureDevKey } from "../../../src/lib/utils/template";

const entities: Entity[] = [
  { name: "Organization", fields: [{ name: "name", type: "text" }] },
  { name: "Member", fields: [{ name: "name", type: "text" }] },
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

/** The file holding the API key check (TypeScript keeps it apart from user sign-in). */
const keyFile = async (language: TargetLanguage, auth?: AuthConfig) => {
  const files = await generators[language].generateGuards(entities, auth);
  const name = { typescript: "guards/key.guard.ts", go: "middleware/auth.go", python: "auth.py" }[language];
  return files.find((f) => f.path === name)?.content ?? "";
};

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
  test("TypeScript lists GuardsModule so its global guards run, with or without auth", async () => {
    const [index] = await generators.typescript.generateIndexModule(entities, "rest", { auth: jwt("jwt") });
    expect(index.content).toContain("GuardsModule");
    const [noAuth] = await generators.typescript.generateIndexModule([entities[0]], "rest", {});
    expect(noAuth.content).toContain("GuardsModule");
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

  test("TypeScript @CrudAuth honors bypassRoles, enforceOn and injectOnCreate", async () => {
    const scoped: Entity = {
      ...entities[2],
      scopeOptions: { bypassRoles: ["support"], enforceOn: ["find", "get"], injectOnCreate: false },
    };
    const opts = { entity: scoped, relationships: [], allEntities: entities, apiType: "rest", relationshipMap: {} };
    const files = await generators.typescript.generateController({ ...opts, auth: jwt("jwt") });
    const ctrl = files.find((f) => f.path.endsWith(".controller.ts"))!.content;
    expect(ctrl).toContain("const ENFORCE_ON = ['find', 'get'];");
    expect(ctrl).toContain("const BYPASS_ROLES: string[] = ['support'];");
    expect(ctrl).toContain("filter: (req: any) => skipScope(req) ? {} : ({");
    expect(ctrl).toContain("persist: (req: any) => skipScope(req) || scopeOperation(req) === 'create' ? {} : ({");

    // A service caller (API key) skips the tenant filter on every scoped controller.
    const plain = await generators.typescript.generateController({ ...opts, entity: entities[2], auth: jwt("jwt") });
    expect(plain.find((f) => f.path.endsWith(".controller.ts"))!.content).toContain("if (req.auth?.serviceId) return true;");
  });

  test("Go create DTO does not require a scopeBy foreign key the service sets", async () => {
    const rels = [{ name: "Organization", type: "ManyToOne" as const }];
    const dto = async (auth?: AuthConfig) => {
      const [file] = await generators.go.generateDto({ entity: entities[2], relationships: rels, allEntities: entities, apiType: "rest", auth });
      return file.content;
    };
    expect(await dto(jwt("jwt"))).toContain('OrganizationID uint `json:"organizationId"`');
    expect(await dto()).toContain('`json:"organizationId" validate:"required"`');
  });

  test("ScopeGuard reads roles from the auth context", async () => {
    const files = await generators.typescript.generateGuards(entities, jwt("jwt"));
    const guard = files.find((f) => f.path === "guards/scope.guard.ts")!.content;
    expect(guard).toContain("request.auth?.roles ?? request.user?.roles");
  });

  test("Go registers the middleware on the /api group", async () => {
    const [routes] = await generators.go.generateIndexModule(entities, "rest", { auth: jwt("jwt") });
    expect(routes.content).toContain("r.Use(middleware.AuthMiddleware(db))");
    const [noAuth] = await generators.go.generateIndexModule(entities, "rest", {});
    expect(noAuth.content).toContain("r.Use(middleware.AuthMiddleware(db))");
  });

  test("Python makes the generated router depend on require_auth", async () => {
    const [index] = await generators.python.generateIndexModule(entities, "rest", { auth: jwt("jwt") });
    expect(index.content).toContain("dependencies=[Depends(require_auth)]");
    const [noAuth] = await generators.python.generateIndexModule(entities, "rest", {});
    expect(noAuth.content).toContain("dependencies=[Depends(require_auth)]");
  });
});

describe("the API key check built into every service", () => {
  test("is generated in every language, with and without an auth block", async () => {
    for (const language of ["typescript", "go", "python"] as TargetLanguage[]) {
      for (const auth of [undefined, jwt("jwt")]) {
        const code = await keyFile(language, auth);
        for (const name of [
          "APSO_API_KEY",
          "APSO_SERVICE_TOKEN_JWKS_URL",
          "APSO_SERVICE_TOKEN_ISSUER",
          "APSO_SERVICE_ID",
          "APSO_LOCAL",
          "AWS_LAMBDA_FUNCTION_NAME",
          "x-api-key",
          "x-apso-service-token",
          "x-request-id",
          "ES256",
        ])
          expect(code).toContain(name);
      }
    }
  });

  test("TypeScript runs it as the first global guard and records the caller for logging", async () => {
    const files = await generators.typescript.generateGuards([entities[0]]);
    const module = files.find((f) => f.path === "guards/guards.module.ts")!.content;
    expect(module).toContain("useExisting: ApiKeyGuard");
    const guard = files.find((f) => f.path === "guards/key.guard.ts")!.content;
    expect(guard).toContain("caller: { type: 'service', keyId: caller.serviceId }");
    expect(guard).toContain("request.apso = { ...request.apso, denied }");
    expect(guard).toContain("export const Public");
  });

  test('the removed "api-key" provider fails with what replaced it', () => {
    expect(() => assertSignInProvider({ provider: "api-key" })).toThrow(/was removed.*APSO_API_KEY.*x-api-key/);
    expect(() => assertSignInProvider(jwt("jwt"))).not.toThrow();
    expect(() => assertSignInProvider()).not.toThrow();
  });

  test("ensureDevKey writes a key and the local flag to .env once", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-devkey-"));
    fs.writeFileSync(path.join(dir, ".env"), "PORT=3000");
    const key = ensureDevKey(dir);
    const env = fs.readFileSync(path.join(dir, ".env"), "utf8");
    expect(key).toMatch(/^apso_dev_[\da-f]{48}$/);
    expect(env).toContain(`PORT=3000\n`);
    expect(env).toContain(`APSO_API_KEY=${key}\n`);
    expect(env).toContain("APSO_LOCAL=1\n");
    expect(ensureDevKey(dir)).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toBe(env);
    fs.rmSync(dir, { recursive: true, force: true });
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

describe("scopeBy in Go and Python services", () => {
  const project = entities[2];
  const opts = (auth?: AuthConfig) => ({
    entity: project,
    relationships: [],
    allEntities: entities,
    apiType: "rest",
    relationshipMap: {},
    auth,
  });

  test("Go filters every query by the caller's tenant only when auth is set", async () => {
    const [scoped] = await generators.go.generateService(opts(jwt("jwt")));
    expect(scoped.content).toContain('s.scoped(ctx, query, "find")');
    // The column keeps its .apsorc name, as the DDL writer creates it.
    expect(scoped.content).toContain('"organizationId": a.WorkspaceID');
    expect(scoped.content).toContain('CAST("`+table+`"."`+col+`" AS TEXT)');
    expect(scoped.content).toContain('setFromString(&item, "OrganizationID", v)');
    const [open] = await generators.go.generateService(opts());
    expect(open.content).not.toContain("scoped(");
  });

  test("Go emits the shared scope helpers when an entity is scoped", async () => {
    const files = await generators.go.generateGuards(entities, jwt("jwt"));
    expect(files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["services/scope.go", "handlers/scope.go"])
    );
  });

  test("Python scopes the query builder and the router passes the caller", async () => {
    const [service] = await generators.python.generateService(opts(jwt("jwt")));
    expect(service.content).toContain('"organizationId": a.workspace_id');
    expect(service.content).toContain('self._qb("find")');
    const [open] = await generators.python.generateService(opts());
    expect(open.content).not.toContain("_scope_values");
    const [router] = await generators.python.generateController({ ...opts(), relationshipMap: {} });
    expect(router.content).toContain('Service(db, getattr(request.state, "auth", None))');
  });
});

describe("guard regeneration (cli#129)", () => {
  test("JWT guards render the same when nothing changed", async () => {
    for (const auth of [jwt("auth0")]) {
      const first = await guardFile("typescript", auth);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      expect(first).toContain("AuthGuard");
      expect(first).not.toContain("Generated at");
      expect(await guardFile("typescript", auth)).toBe(first);
    }
  });
});
