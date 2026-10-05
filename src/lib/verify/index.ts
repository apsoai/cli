/**
 * Pre-deploy checks for a generated service: generate the migration from the
 * deployed schema, run it and check for drift (TypeScript only, on PGlite),
 * and smoke test the endpoints. The CLI and the in-browser editor (which runs
 * the CLI in a WebContainer) share these steps.
 */

import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import pluralize from "pluralize";
import { Entity } from "../types/entity";
import { TargetLanguage } from "../types/generator";
import { RelationshipMap } from "../types/relationship";
import { kebabCase } from "../utils/casing";
import { planCrud } from "./crud-plan";

export interface Step {
  name: string;
  ok: boolean;
  output?: string;
}

// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\u001B\[[\d;]*m/g, "");
const tail = (s: string, n = 4000) => {
  const p = plain(s);
  return p.length > n ? p.slice(-n) : p;
};

export function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {}
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let output = "";
    p.stdout.on("data", (d) => {
      output += d;
    });
    p.stderr.on("data", (d) => {
      output += d;
    });
    p.on("error", (e) => resolve({ ok: false, output: output + e.message }));
    p.on("close", (code) => resolve({ ok: code === 0, output }));
  });
}

/** Env that points the service's orm.config at a file-backed PGlite database. */
export const pgliteEnv = (dataDir: string): NodeJS.ProcessEnv => ({
  DATABASE_TYPE: "pglite",
  DATABASE_SYNC: "false",
  DATABASE_LOGGING: "false",
  PGLITE_DATA_DIR: dataDir,
});

const typeorm = (cwd: string, args: string[], env: NodeJS.ProcessEnv) =>
  run(
    "npm",
    ["run", "typeorm", "--", ...args, "-d", "./dist/orm.config.js"],
    cwd,
    env
  );

const build = (cwd: string) => run("npm", ["run", "build"], cwd);

const step = (name: string, r: { ok: boolean; output: string }): Step => ({
  name,
  ok: r.ok,
  output: r.ok ? undefined : tail(r.output),
});

/**
 * Load the deployed schema into a fresh PGlite database at dataDir: scaffold
 * the baseline .apsorc in a copy of the project (sharing node_modules), build
 * it, and schema:sync.
 */
export async function buildBaseline(
  projectDir: string,
  baselineApsorc: string,
  dataDir: string,
  cliBin: string
): Promise<Step> {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "apso-baseline-"));
  try {
    fs.cpSync(projectDir, copy, {
      recursive: true,
      filter: (src) =>
        !["node_modules", "dist", ".git"].includes(
          path.relative(projectDir, src).split(path.sep)[0]
        ),
    });
    fs.symlinkSync(
      path.join(projectDir, "node_modules"),
      path.join(copy, "node_modules"),
      "dir"
    );
    fs.copyFileSync(baselineApsorc, path.join(copy, ".apsorc"));
    // The CLI rebuilds src/autogen from the entities present; a stale one fails the build.
    fs.rmSync(path.join(copy, "src", "autogen"), {
      recursive: true,
      force: true,
    });

    const gen = await run(
      process.execPath,
      [cliBin, "generate", "--skip-format", "--language", "typescript"],
      copy
    );
    if (!gen.ok) return step("baseline", gen);
    const built = await build(copy);
    if (!built.ok) return step("baseline", built);
    return step(
      "baseline",
      await typeorm(copy, ["schema:sync"], pgliteEnv(dataDir))
    );
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

/**
 * Why `apso migrate` can't run for this project's language, or undefined.
 * ponytail: Python (Alembic) and Go (goose) have no local scratch database to
 * build the baseline on; add when they get one like PGlite for TypeScript.
 */
export const migrateUnsupported = (
  language: TargetLanguage = "typescript"
): string | undefined => {
  if (language === "python")
    return "apso migrate supports TypeScript services only for now. This is a Python service: use Alembic directly (alembic revision --autogenerate, alembic upgrade head, alembic check).";
  if (language === "go")
    return "apso migrate supports TypeScript services only for now. This is a Go service: write goose migrations in migrations/ and run them with `go run cmd/migrate/main.go up`.";
  return undefined;
};

export interface GenerateResult {
  ok: boolean;
  needed: boolean;
  file?: string;
  steps: Step[];
}

/** Generate a migration from the deployed schema (baselineApsorc) to the project's entities. */
export async function generateMigration(
  projectDir: string,
  baselineApsorc: string,
  name: string,
  cliBin: string
): Promise<GenerateResult> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-pglite-"));
  const steps: Step[] = [];
  try {
    const baseline = await buildBaseline(
      projectDir,
      baselineApsorc,
      dataDir,
      cliBin
    );
    steps.push(baseline);
    if (!baseline.ok) return { ok: false, needed: false, steps };
    const built = await build(projectDir);
    steps.push(step("build", built));
    if (!built.ok) return { ok: false, needed: false, steps };

    const migrationsDir = path.join(projectDir, "src", "migrations");
    fs.mkdirSync(migrationsDir, { recursive: true });
    const before = new Set(fs.readdirSync(migrationsDir));
    const gen = await typeorm(
      projectDir,
      ["migration:generate", `./src/migrations/${name}-migration`],
      pgliteEnv(dataDir)
    );
    if (/No changes in database schema were found/.test(gen.output)) {
      steps.push({ name: "generate", ok: true });
      return { ok: true, needed: false, steps };
    }
    const file = fs
      .readdirSync(migrationsDir)
      .find((f) => !before.has(f) && f.endsWith(".ts"));
    const ok = gen.ok && Boolean(file);
    steps.push(step("generate", { ok, output: gen.output }));
    return {
      ok,
      needed: true,
      file: file && path.join("src", "migrations", file),
      steps,
    };
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// Runs only the given compiled migration, so migrations the deployed database
// already ran are not replayed on the baseline.
const RUN_ONE_MIGRATION = `
const path = require("path");
const mod = require(path.resolve("dist/orm.config.js"));
const ds = mod.default || mod;
ds.setOptions({ migrations: [path.resolve(process.argv[1])] });
ds.initialize()
  .then(() => ds.runMigrations({ transaction: "all" }))
  .then((ran) => { console.log("ran " + ran.map((m) => m.name).join(", ")); return ds.destroy(); })
  .catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
`;

export interface CheckResult {
  ok: boolean;
  steps: Step[];
}

/**
 * Projects from the v1 template have no PGlite support in src/orm.config.ts,
 * so the checks cannot run locally. They pass as skipped rather than block a
 * deploy they cannot judge.
 */
const NO_PGLITE: CheckResult = {
  ok: true,
  steps: [
    {
      name: "skipped",
      ok: true,
      output:
        "This project's database config (src/orm.config.ts) can't use a local PGlite database, so this check was skipped. Projects created from the current template support it.",
    },
  ],
};

export function supportsPglite(projectDir: string): boolean {
  try {
    return /typeorm-pglite|PGliteDriver/.test(
      fs.readFileSync(path.join(projectDir, "src", "orm.config.ts"), "utf8")
    );
  } catch {
    return false;
  }
}

/**
 * Run a migration on a fresh copy of the deployed schema, then check that the
 * database matches the project's entities (a second generate finds nothing).
 */
export async function verifyMigration(
  projectDir: string,
  baselineApsorc: string,
  migrationFile: string,
  cliBin: string,
  skipBuild = false
): Promise<CheckResult> {
  if (!supportsPglite(projectDir)) return NO_PGLITE;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-pglite-"));
  const steps: Step[] = [];
  const done = (s: Step) => {
    steps.push(s);
    return s.ok;
  };
  try {
    if (!done(await buildBaseline(projectDir, baselineApsorc, dataDir, cliBin)))
      return { ok: false, steps };
    const compiled = path
      .join("dist", path.relative("src", migrationFile))
      .replace(/\.ts$/, ".js");
    // --skip-build still builds when the migration isn't compiled yet.
    const needsBuild =
      !skipBuild || !fs.existsSync(path.join(projectDir, compiled));
    if (needsBuild && !done(step("build", await build(projectDir))))
      return { ok: false, steps };
    const migrate = await run(
      process.execPath,
      ["-e", RUN_ONE_MIGRATION, compiled],
      projectDir,
      pgliteEnv(dataDir)
    );
    if (!done({ ...step("migrate", migrate), output: tail(migrate.output) }))
      return { ok: false, steps };

    const drift = await typeorm(
      projectDir,
      ["migration:generate", "./src/migrations/drift", "--check"],
      pgliteEnv(dataDir)
    );
    return { ok: done(step("drift", drift)), steps };
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

type Res = { status: number; body: string };

const request = (method: string, url: string, body?: unknown) =>
  new Promise<Res>((resolve) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers: http.OutgoingHttpHeaders = data
      ? {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
        }
      : {};
    http
      .request(url, { method, headers, timeout: 15_000 }, (res) => {
        let text = "";
        res.on("data", (d) => {
          text += d;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: text })
        );
      })
      .on("timeout", function (this: http.ClientRequest) {
        this.destroy(new Error("No response within 15s"));
      })
      .on("error", (e) => resolve({ status: 0, body: e.message }))
      .end(data);
  });

const get = (url: string) => request("GET", url);

const expectStatus = (res: Res, ...ok: number[]) => ({
  ok: ok.includes(res.status),
  output: ok.includes(res.status)
    ? undefined
    : `${res.status} ${tail(res.body, 500)}`,
});

const idOf = (body: string): unknown => {
  try {
    return JSON.parse(body).id ?? undefined;
  } catch {
    return undefined;
  }
};

/** The route each language's generated controller serves an entity on. */
export const entityRoute = (language: TargetLanguage, name: string): string => {
  const plural = pluralize(name);
  if (language === "python") return `/api/${plural.toLowerCase()}`;
  if (language === "go") return `/api/${kebabCase(plural)}`;
  return `/${plural}`;
};

/* eslint-disable no-await-in-loop */
/**
 * List every entity, then create, read and delete one row of each: parents
 * before children on the way in, children before parents on the way out.
 */
async function checkEndpoints(
  base: string,
  language: TargetLanguage,
  entities: Entity[],
  relationships: RelationshipMap,
  done: (s: Step) => boolean
): Promise<void> {
  const route = (name: string) => entityRoute(language, name);
  for (const { name } of entities) {
    done({
      name: `GET ${route(name)}`,
      ...expectStatus(await get(base + route(name)), 200),
    });
  }

  const plan = planCrud(entities, relationships);
  for (const s of plan.skipped)
    done({ name: `skip ${s.name}`, ok: true, output: s.reason });
  const ids = new Map<string, unknown>();
  for (const p of plan.order) {
    const r = route(p.name);
    const failed = p.parents.find((parent) => !ids.has(parent.entity));
    if (failed) {
      done({
        name: `skip ${p.name}`,
        ok: true,
        output: `needs a ${failed.entity} row, which failed to create`,
      });
      continue;
    }
    const body = { ...p.payload };
    for (const parent of p.parents)
      body[parent.property] = ids.get(parent.entity);
    const created = await request("POST", base + r, body);
    const id = [200, 201].includes(created.status)
      ? idOf(created.body)
      : undefined;
    if (
      !done({
        name: `POST ${r}`,
        ok: id !== undefined,
        output:
          id === undefined
            ? `${created.status} ${tail(created.body, 500)}`
            : undefined,
      })
    )
      continue;
    ids.set(p.name, id);
    done({
      name: `GET ${r}/${id}`,
      ...expectStatus(await get(`${base}${r}/${id}`), 200),
    });
  }
  for (const p of [...plan.order].reverse()) {
    if (!ids.has(p.name)) continue;
    const url = `${route(p.name)}/${ids.get(p.name)}`;
    done({
      name: `DELETE ${url}`,
      ...expectStatus(await request("DELETE", base + url), 200, 204),
    });
  }
}

/** Wait for the server's /health, run check against it, and stop the server. */
async function serve(
  server: ChildProcess,
  port: number,
  timeoutMs: number,
  done: (s: Step) => boolean,
  check: (base: string) => Promise<void>
): Promise<void> {
  let log = "";
  server.stdout?.on("data", (d) => {
    log += d;
  });
  server.stderr?.on("data", (d) => {
    log += d;
  });
  // A command that can't start (e.g. no python3) has no pid; keep its error.
  server.on("error", (e) => {
    log += e.message;
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + timeoutMs;
    let health = await get(`${base}/health`);
    while (
      health.status !== 200 &&
      Date.now() < deadline &&
      server.exitCode === null &&
      server.pid !== undefined
    ) {
      await new Promise((r) => {
        setTimeout(r, 500);
      });
      health = await get(`${base}/health`);
    }
    if (
      done({
        name: "start",
        ok: health.status === 200,
        output: health.status === 200 ? undefined : tail(log),
      })
    )
      await check(base);
  } finally {
    server.kill();
  }
}
/* eslint-enable no-await-in-loop */

export interface SmokeOptions {
  skipBuild?: boolean;
  timeoutMs?: number;
  language?: TargetLanguage;
}

/**
 * Start the service and call GET /health, every entity's list endpoint, and a
 * create/read/delete of one row per entity. TypeScript services run on a
 * PGlite database synced to their entities; Python and Go services run on the
 * database in DATABASE_URL.
 */
export async function smokeTest(
  projectDir: string,
  entities: Entity[],
  relationships: RelationshipMap = {},
  {
    skipBuild = false,
    timeoutMs = 60_000,
    language = "typescript",
  }: SmokeOptions = {}
): Promise<CheckResult> {
  if (language !== "typescript")
    return smokeTestOnDatabaseUrl(
      projectDir,
      entities,
      relationships,
      language,
      timeoutMs
    );
  if (!supportsPglite(projectDir)) return NO_PGLITE;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-pglite-"));
  const steps: Step[] = [];
  const done = (s: Step) => {
    steps.push(s);
    return s.ok;
  };
  try {
    if (!skipBuild && !done(step("build", await build(projectDir))))
      return { ok: false, steps };
    if (
      !done(
        step(
          "schema",
          await typeorm(projectDir, ["schema:sync"], pgliteEnv(dataDir))
        )
      )
    )
      return { ok: false, steps };

    const port = await freePort();
    const server = spawn(process.execPath, ["dist/main"], {
      cwd: projectDir,
      env: { ...process.env, ...pgliteEnv(dataDir), APP_PORT: String(port) },
    });
    await serve(server, port, timeoutMs, done, (base) =>
      checkEndpoints(base, language, entities, relationships, done)
    );
    return { ok: steps.every((s) => s.ok), steps };
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/** KEY=value lines of the project's .env; no interpolation. */
export function readDotEnv(projectDir: string): Record<string, string> {
  let text = "";
  try {
    text = fs.readFileSync(path.join(projectDir, ".env"), "utf8");
  } catch {
    return {};
  }
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

const canConnect = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host, port, timeout: 3000 });
    const end = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.on("connect", () => end(true));
    s.on("timeout", () => end(false));
    s.on("error", () => end(false));
  });

const skipped = (output: string): CheckResult => ({
  ok: true,
  steps: [{ name: "skipped", ok: true, output }],
});

/**
 * Python and Go services have no embedded database, so they run against the
 * one in DATABASE_URL (environment first, then .env), as configured: the
 * smoke test never creates tables, and it skips when no database answers.
 */
async function smokeTestOnDatabaseUrl(
  projectDir: string,
  entities: Entity[],
  relationships: RelationshipMap,
  language: TargetLanguage,
  timeoutMs: number
): Promise<CheckResult> {
  const env = { ...readDotEnv(projectDir), ...process.env };
  if (!env.DATABASE_URL)
    return skipped(
      "No DATABASE_URL in the environment or .env, so there is no database to run the service against. Set it and rerun."
    );
  let db: URL;
  try {
    db = new URL(env.DATABASE_URL);
  } catch {
    return {
      ok: false,
      steps: [
        { name: "database", ok: false, output: "DATABASE_URL is not a URL." },
      ],
    };
  }
  const dbPort = Number(db.port) || 5432;
  if (!(await canConnect(db.hostname, dbPort)))
    return skipped(
      `No database is listening at ${db.hostname}:${dbPort} (DATABASE_URL), so the service can't start. Start the database and rerun.`
    );

  const steps: Step[] = [];
  const done = (s: Step) => {
    steps.push(s);
    return s.ok;
  };
  const port = await freePort();
  const serverEnv = { ...env, PORT: String(port) };
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-smoke-"));
  try {
    let server: ChildProcess;
    if (language === "go") {
      // A built binary, not `go run`: killing `go run` can leave the server running.
      const bin = path.join(binDir, "server");
      if (
        !done(
          step(
            "build",
            await run("go", ["build", "-o", bin, "./cmd"], projectDir)
          )
        )
      )
        return { ok: false, steps };
      server = spawn(bin, [], { cwd: projectDir, env: serverEnv });
    } else {
      const venv = path.join(projectDir, ".venv", "bin", "python");
      const python = fs.existsSync(venv) ? venv : "python3";
      server = spawn(
        python,
        [
          "-m",
          "uvicorn",
          "app.main:app",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        { cwd: projectDir, env: serverEnv }
      );
    }
    await serve(server, port, timeoutMs, done, (base) =>
      checkEndpoints(base, language, entities, relationships, done)
    );
    return { ok: steps.every((s) => s.ok), steps };
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

/** The CLI's own entry point, for running `generate` in the baseline copy. */
export const cliBinPath = (root: string): string =>
  path.join(root, "bin", "run");

/** Print a check's steps (or JSON) through the command's logger. */
export function report(
  log: (s: string) => void,
  result: CheckResult,
  json: boolean,
  summary?: string
): void {
  if (json) {
    log(JSON.stringify(result));
    return;
  }
  for (const s of result.steps) {
    log(`${s.ok ? "ok  " : "FAIL"} ${s.name}`);
    if (s.output) log(s.output.replace(/^/gm, "     "));
  }
  if (summary) log(summary);
}
