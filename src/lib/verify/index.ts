/**
 * Pre-deploy checks for a generated TypeScript service, run against PGlite:
 * generate the migration from the deployed schema, run it and check for drift,
 * and smoke test the endpoints. The CLI and the in-browser editor (which runs
 * the CLI in a WebContainer) share these steps.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import pluralize from "pluralize";

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
    if (!skipBuild && !done(step("build", await build(projectDir))))
      return { ok: false, steps };

    const compiled = path
      .join("dist", path.relative("src", migrationFile))
      .replace(/\.ts$/, ".js");
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

const get = (url: string) =>
  new Promise<{ status: number; body: string }>((resolve) => {
    http
      .get(url, { timeout: 15_000 }, (res) => {
        let body = "";
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("timeout", function (this: http.ClientRequest) {
        this.destroy(new Error("No response within 15s"));
      })
      .on("error", (e) => resolve({ status: 0, body: e.message }));
  });

/**
 * Start the built service on a PGlite database synced to its entities and call
 * GET /health and the list endpoint of every entity.
 * ponytail: list only, no create/read/delete; add when payloads can be built
 * from required fields and relationships.
 */
export async function smokeTest(
  projectDir: string,
  entityNames: string[],
  { skipBuild = false, timeoutMs = 60_000 } = {}
): Promise<CheckResult> {
  if (!supportsPglite(projectDir)) return NO_PGLITE;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-pglite-"));
  const steps: Step[] = [];
  const done = (s: Step) => {
    steps.push(s);
    return s.ok;
  };
  let server: ReturnType<typeof spawn> | undefined;
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
    let log = "";
    server = spawn(process.execPath, ["dist/main"], {
      cwd: projectDir,
      env: { ...process.env, ...pgliteEnv(dataDir), APP_PORT: String(port) },
    });
    server.stdout?.on("data", (d) => {
      log += d;
    });
    server.stderr?.on("data", (d) => {
      log += d;
    });
    const base = `http://127.0.0.1:${port}`;

    const deadline = Date.now() + timeoutMs;
    let health = await get(`${base}/health`);
    while (
      health.status !== 200 &&
      Date.now() < deadline &&
      server.exitCode === null
    ) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => {
        setTimeout(r, 500);
      });
      // eslint-disable-next-line no-await-in-loop
      health = await get(`${base}/health`);
    }
    if (
      !done({
        name: "start",
        ok: health.status === 200,
        output: health.status === 200 ? undefined : tail(log),
      })
    )
      return { ok: false, steps };

    for (const name of entityNames) {
      const route = `/${pluralize(name)}`;
      // eslint-disable-next-line no-await-in-loop
      const res = await get(base + route);
      done({
        name: `GET ${route}`,
        ok: res.status === 200,
        output:
          res.status === 200
            ? undefined
            : `${res.status} ${tail(res.body, 500)}`,
      });
    }
    return { ok: steps.every((s) => s.ok), steps };
  } finally {
    server?.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
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
