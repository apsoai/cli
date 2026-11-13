import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Runtime packages the generated TypeScript code imports (entities, services,
 * controllers, guards). These are the first releases with the `dialects`
 * option, Content-Range counts and PostgREST OpenAPI parameters, which the
 * generated controllers rely on. The service template declares the same
 * ranges (see TEMPLATE_REFS in ./template.ts); bump both together.
 *
 * @apso/postgrest-request is not imported by generated code. It is listed so
 * a project whose lockfile holds an older copy moves to the one @apso/crud
 * needs.
 */
export const APSO_CRUD_DEPS: Record<string, string> = {
  "@apso/crud": "^1.1.0",
  "@apso/crud-core": "^1.1.0",
  "@apso/crud-request": "^1.0.1",
  "@apso/crud-typeorm": "^1.1.0",
  "@apso/postgrest-request": "^1.1.0",
};

/**
 * Declare the @apso/crud runtime packages in the project's package.json, and
 * raise a range that starts below the version the generated code needs.
 *
 * Projects created from the v1 template (@nestjsx/crud) don't declare them, so
 * freshly generated code fails `nest build` with TS2307 "Cannot find module
 * '@apso/crud'" on every entity. Existing @nestjsx deps are left alone because
 * hand-written code may still import them.
 *
 * @param {string} projectDir - Directory holding the project's package.json.
 * @returns {string[]} Names added or raised (empty when nothing changed or no package.json).
 */
export function ensureCrudDeps(projectDir: string): string[] {
  return addMissingDeps(projectDir, APSO_CRUD_DEPS, true);
}

/** The first x.y.z in a version range, as numbers; undefined for a range with none (file:, a tag). */
const firstVersion = (range: string): number[] | undefined =>
  /^[^\d:]*(\d+)\.(\d+)\.(\d+)/.exec(range)?.slice(1).map(Number);

/** True when `declared` starts at a lower version than `wanted`. */
function startsBelow(declared: string, wanted: string): boolean {
  const [a, b] = [firstVersion(declared), firstVersion(wanted)];
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * Add the given dependencies to package.json where it doesn't declare them.
 *
 * @param {string} projectDir - Directory holding the project's package.json.
 * @param {Record<string, string>} deps - Package names and version ranges.
 * @param {boolean} [raise] - Also replace a declared range that starts below the given one.
 * @returns {string[]} Names added or raised (empty when nothing changed or no package.json).
 */
export function addMissingDeps(
  projectDir: string,
  deps: Record<string, string>,
  raise = false
): string[] {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) return [];

  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const declared = { ...pkg.devDependencies, ...pkg.dependencies };
  const missing = Object.keys(deps).filter(
    (name) => !declared[name] || (raise && startsBelow(declared[name], deps[name]))
  );
  if (missing.length === 0) return [];

  pkg.dependencies = pkg.dependencies ?? {};
  for (const name of missing) {
    // A range raised here replaces the one declared, wherever it was declared.
    if (pkg.devDependencies?.[name]) delete pkg.devDependencies[name];
    pkg.dependencies[name] = deps[name];
  }
  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b))
  );
  fs.writeFileSync(
    pkgPath,
    JSON.stringify(pkg, null, 2) + (raw.endsWith("\n") ? "\n" : "")
  );
  return missing;
}

/** MCP library the generated controllers import when an entity sets `mcp`. 0.3.0 is the first that serves /mcp/internal next to /mcp. */
export const MCP_DEP: Record<string, string> = { "@apso/mcp": "^0.3.0" };

const SWAGGER_SETUP = "SwaggerModule.setup('_docs', app, document);";

/**
 * Wire @apso/mcp into a TypeScript project: declare the package and call
 * mountMcp where the app builds its OpenAPI document. Safe to run again.
 *
 * @param {string} projectDir - Directory holding the project's package.json.
 * @param {string} rootFolder - Source folder from .apsorc (usually "src").
 * @returns {string[]} Files changed (empty when the project was already wired).
 */
export function ensureMcpWiring(projectDir: string, rootFolder: string): string[] {
  const changed =
    addMissingDeps(projectDir, MCP_DEP, true).length > 0 ? ["package.json"] : [];
  const relative = path.join(rootFolder, "config", "nest-app.config.ts");
  const file = path.join(projectDir, relative);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (text.includes("mountMcp")) return changed;
  // A bootstrap that no longer looks like the template's is the owner's to edit.
  if (!text.includes(SWAGGER_SETUP))
    throw new Error(
      `mcp in .apsorc: could not add the MCP endpoint to ${relative}. Where your app is configured, import { mountMcp } from '@apso/mcp' and call mountMcp(app, document) after SwaggerModule.createDocument. Without it no tools are served.`
    );
  fs.writeFileSync(
    file,
    "import { mountMcp } from '@apso/mcp';\n" +
      text.replace(
        SWAGGER_SETUP,
        `${SWAGGER_SETUP}\n\n  // Serve the routes marked with @McpTool as MCP tools: /mcp/internal for API keys, /mcp for signed-in users.\n  mountMcp(app, document);`
      )
  );
  return [...changed, relative];
}

/** The official MCP SDK for Python; 2.x has the constructor-handler server the generated mcp.py uses. */
export const PYTHON_MCP_DEP = "mcp>=2.3,<3";

/** The entry point of a Python or Go project and the MCP call the CLI adds to it. */
function appMcpWiring(language: "python" | "go") {
  const python = language === "python";
  const relative = python ? path.join("app", "main.py") : path.join("cmd", "main.go");
  const anchor = python
    ? "app.include_router(autogen_router)"
    : "routes.RegisterAllRoutes(api, db)";
  const call = python
    ? "\n\n# Serve the routes marked with mcp_tool as MCP tools at /mcp.\nfrom app.autogen.mcp import mount_mcp  # noqa: E402\n\nmount_mcp(app)"
    : "\n\n\t// Serve the routes .apsorc marks with mcp as MCP tools at /mcp.\n\troutes.MountMCP(r, api)";
  return { relative, anchor, call };
}

/**
 * Take the MCP call back out of a Python or Go entry point when no entity has
 * `mcp` any more: the generated file it calls is no longer written, so the
 * service would not build or start. Only the exact lines the CLI added are
 * removed.
 *
 * @param {string} projectDir - The project root.
 * @param {"python" | "go"} language - The project's language.
 * @returns {string[]} Files changed.
 */
export function removeAppMcpWiring(
  projectDir: string,
  language: "python" | "go"
): string[] {
  const { relative, call } = appMcpWiring(language);
  const file = path.join(projectDir, relative);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!text.includes(call)) return [];
  fs.writeFileSync(file, text.replace(call, ""));
  return [relative];
}

/**
 * Wire the generated MCP endpoint into a Python or Go project: one call in the
 * app's entry point, after the generated routes are registered (and the SDK in
 * pyproject.toml for Python; go mod tidy adds it for Go). Safe to run again.
 *
 * @param {string} projectDir - The project root.
 * @param {"python" | "go"} language - The project's language.
 * @returns {string[]} Files changed (empty when the project was already wired).
 */
export function ensureAppMcpWiring(
  projectDir: string,
  language: "python" | "go"
): string[] {
  const python = language === "python";
  const changed =
    python && addMissingPythonDep(projectDir, PYTHON_MCP_DEP)
      ? ["pyproject.toml"]
      : [];
  const { relative, anchor, call } = appMcpWiring(language);
  const file = path.join(projectDir, relative);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (text.includes(python ? "mount_mcp" : "MountMCP")) return changed;
  // An entry point that no longer looks like the template's is the owner's to edit.
  if (!text.includes(anchor))
    throw new Error(
      python
        ? `mcp in .apsorc: could not add the MCP endpoint to ${relative}. After your routers are included, add: from app.autogen.mcp import mount_mcp, then mount_mcp(app). Without it no tools are served.`
        : `mcp in .apsorc: could not add the MCP endpoint to ${relative}. After routes.RegisterAllRoutes, call routes.MountMCP(engine, group) with the Gin engine and the group the routes are registered on. Without it no tools are served.`
    );
  fs.writeFileSync(file, text.replace(anchor, anchor + call));
  return [...changed, relative];
}

/** Request logging library every generated TypeScript service uses. */
export const LOGGING_DEP: Record<string, string> = { "@apso/logging": "^0.1.0" };

const NEST_IMPORT = /^import {[^}]*\bNestFactory\b[^}]*} from ["']@nestjs\/core["'];?$/m;
const NEST_CREATE =
  /^([\t ]*)(?:const|let) (\w+) = await NestFactory\.create\(AppModule\);?$/m;

/**
 * Wire @apso/logging into a TypeScript project: declare the package and call
 * useApsoLogging straight after NestFactory.create in the server entry point
 * (main.ts) and the Lambda handler (lambda.ts). Safe to run again.
 *
 * @param {string} projectDir - Directory holding the project's package.json.
 * @param {string} rootFolder - Source folder from .apsorc (usually "src").
 * @returns {{ changed: string[], manual: string[] }} Files changed, and entry
 * points that no longer look like the template's and were left alone.
 */
export function ensureLoggingWiring(
  projectDir: string,
  rootFolder: string
): { changed: string[]; manual: string[] } {
  const changed =
    addMissingDeps(projectDir, LOGGING_DEP).length > 0 ? ["package.json"] : [];
  const manual: string[] = [];
  for (const name of ["main.ts", "lambda.ts"]) {
    const relative = path.join(rootFolder, name);
    const file = path.join(projectDir, relative);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (text.includes("useApsoLogging")) continue;
    // A bootstrap that no longer looks like the template's is the owner's to edit.
    if (!NEST_IMPORT.test(text) || !NEST_CREATE.test(text)) {
      manual.push(relative);
      continue;
    }
    fs.writeFileSync(
      file,
      text
        // After the NestFactory import: main.ts must import ./tracing first.
        .replace(NEST_IMPORT, "$&\nimport { useApsoLogging } from '@apso/logging';")
        .replace(
          NEST_CREATE,
          "$1const $2 = await NestFactory.create(AppModule, { bufferLogs: true });\n$1// One JSON line per request with who called, and a request id on every line.\n$1useApsoLogging($2);"
        )
    );
    changed.push(relative);
  }
  return { changed, manual };
}

/** Version of the access rules the generated code enforces. */
export const ACCESS_CONTRACT = 1;

/**
 * Record in .apso/manifest.json that the generated code has the built-in
 * access check (no valid API key or signed-in user, no access). The hosted
 * platform reads this from the pushed source before it opens a service to
 * requests it has not checked a key for. Other fields in the file are kept.
 *
 * @param {string} projectDir - The project root.
 * @param {string} cliVersion - Version of the CLI that generated the code.
 * @returns {boolean} True when git ignores the file, so it would not be pushed.
 */
export function writeAccessManifest(projectDir: string, cliVersion: string): boolean {
  const file = path.join(projectDir, ".apso", "manifest.json");
  let current = {};
  try {
    // eslint-disable-next-line unicorn/prefer-json-parse-buffer -- JSON.parse's TS type requires a string
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // no manifest yet
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ ...current, accessContract: ACCESS_CONTRACT, cliVersion }, null, 2) + "\n"
  );
  const ignored = spawnSync("git", ["check-ignore", "-q", ".apso/manifest.json"], {
    cwd: projectDir,
  });
  return ignored.status === 0;
}

/** JWT verification library the generated TypeScript JWT guard imports. */
export const JOSE_DEP: Record<string, string> = { jose: "^5.10.0" };

/** JWT verification library the generated Python auth module imports. */
export const PYJWT_DEP = "PyJWT[crypto]>=2.8.0";

/**
 * Add a requirement to pyproject.toml's [project] dependencies list unless a
 * requirement for the same package is already there.
 *
 * @param {string} projectDir - Directory holding pyproject.toml.
 * @param {string} requirement - A PEP 508 requirement, e.g. "PyJWT[crypto]>=2.8.0".
 * @returns {boolean} True when pyproject.toml was changed.
 */
export function addMissingPythonDep(
  projectDir: string,
  requirement: string
): boolean {
  const file = path.join(projectDir, "pyproject.toml");
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  const name = requirement.split(/[ !<=>[~]/)[0].toLowerCase();
  // The list's closing bracket sits on its own line, or ends a one-line list;
  // brackets inside requirements ("uvicorn[standard]") are not the end.
  const list =
    /^dependencies\s*=\s*\[(.*)][^\S\n]*$/m.exec(text) ??
    /^dependencies\s*=\s*\[([\S\s]*?)^]/m.exec(text);
  if (!list) return false;
  const declared = [...list[1].matchAll(/["']([^"']+)["']/g)].map((m) =>
    m[1].split(/[ !<=>[~]/)[0].toLowerCase()
  );
  if (declared.includes(name)) return false;
  const body = list[1].replace(/\s*$/, "");
  const sep = body.trim() === "" || body.trim().endsWith(",") ? "" : ",";
  const updated =
    text.slice(0, list.index) +
    `dependencies = [${body}${sep}\n    "${requirement}",\n]` +
    text.slice(list.index + list[0].length);
  fs.writeFileSync(file, updated);
  return true;
}
