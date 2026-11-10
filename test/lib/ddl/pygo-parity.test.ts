import { expect, describe, test } from "@jest/globals";
import { ChildProcess, execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";
import { schemaDdl } from "../../../src/lib/ddl";
import { catalogDiff, readCatalog } from "../../../src/lib/ddl/catalog";
import { TEMPLATE_REFS, TEMPLATE_REPOS } from "../../../src/lib/utils/template";

// The Python and Go counterpart of project-parity.test.ts: a real generated
// service, started with DATABASE_SYNC=true the way `apso dev` runs it, must
// build the database schemaDdl builds (names included), and must change
// nothing on a database the migrations built. Needs Postgres, psql, go and
// python3, so it runs only when APSO_PYGO_PARITY_URL points at a server:
//   APSO_PYGO_PARITY_URL=postgres://postgres:pg@localhost:5432/postgres npm test -- pygo-parity
// Optional: APSO_PARITY_GO_TEMPLATE / APSO_PARITY_PY_TEMPLATE (a template
// checkout instead of a clone of the pinned ref) and APSO_PARITY_PYTHON (a
// python with the template's dependencies, instead of a fresh venv).
const server = process.env.APSO_PYGO_PARITY_URL;
process.env.NODE_ENV = "production"; // the CLI must run dist/, as in project-parity
const cliBin = path.join(__dirname, "../../../bin/run");
const fixture = path.join(__dirname, "../../fixtures/ddl/pygo-parity.apsorc");
const port = 3950;

const urlFor = (db: string) => {
  const u = new URL(server!);
  u.pathname = `/${db}`;
  return u.toString();
};
const psql = (url: string, sql: string) =>
  execFileSync("psql", [url, "-AtXq", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  });
const freshDb = (db: string) => {
  psql(server!, `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  psql(server!, `CREATE DATABASE "${db}"`);
  return urlFor(db);
};
// readCatalog's queries return one text column named line.
const catalog = (url: string) =>
  readCatalog({
    query: async <T>(sql: string) => ({
      rows: psql(url, sql)
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ line }) as unknown as T),
    }),
  });

const run = (cmd: string, args: string[], cwd: string, env = {}) =>
  execFileSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: "pipe" });

function scaffold(language: "go" | "python"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `apso-${language}-parity-`));
  const local =
    language === "go" ? process.env.APSO_PARITY_GO_TEMPLATE : process.env.APSO_PARITY_PY_TEMPLATE;
  if (local) fs.cpSync(local, dir, { recursive: true, filter: (f) => !f.includes(`${path.sep}.git`) });
  else
    run("git", ["clone", "--depth=1", `--branch=${TEMPLATE_REFS[language]}`, TEMPLATE_REPOS[language], dir], os.tmpdir());
  const template = JSON.parse(fs.readFileSync(path.join(dir, ".apsorc")).toString());
  const apsorc = JSON.parse(fs.readFileSync(fixture).toString());
  fs.writeFileSync(
    path.join(dir, ".apsorc"),
    JSON.stringify({ ...apsorc, language, rootFolder: template.rootFolder }, null, 2)
  );
  run(process.execPath, [cliBin, "generate", "-l", language], dir);
  return dir;
}

function startCommand(language: "go" | "python", dir: string): [string, string[]] {
  if (language === "go") {
    // swag writes the docs package in a real build; an empty one compiles the same.
    if (!fs.existsSync(path.join(dir, "docs"))) {
      fs.mkdirSync(path.join(dir, "docs"));
      fs.writeFileSync(path.join(dir, "docs", "docs.go"), "package docs\n");
    }
    run("go", ["mod", "tidy"], dir);
    run("go", ["build", "-o", "svc", "./cmd/main.go"], dir);
    return [path.join(dir, "svc"), []];
  }
  let python = process.env.APSO_PARITY_PYTHON;
  if (!python) {
    run("python3", ["-m", "venv", ".venv"], dir);
    python = path.join(dir, ".venv", "bin", "python");
    run(python, ["-m", "pip", "install", "-q", "."], dir);
  }
  return [python, ["-m", "uvicorn", "app.main:app", "--port", String(port)]];
}

async function syncWith(command: [string, string[]], dir: string, url: string, language: string) {
  const env = {
    ...process.env,
    DATABASE_SYNC: "true",
    PORT: String(port),
    DATABASE_URL: language === "python" ? url.replace(/^postgres(ql)?:/, "postgresql+asyncpg:") : url,
  };
  const child: ChildProcess = spawn(command[0], command[1], { cwd: dir, env });
  let output = "";
  const collect = (d: Buffer) => {
    output += d;
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  try {
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) break;
      // eslint-disable-next-line no-await-in-loop
      const up = await fetch(`http://localhost:${port}/health`).then((r) => r.ok, () => false);
      if (up) return;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => {
        setTimeout(r, 500);
      });
    }
    throw new Error(`The ${language} service did not start:\n${output.slice(-3000)}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((r) => {
        child.once("exit", r);
      });
      child.kill();
      await exited;
    }
  }
}

(server ? describe : describe.skip)(
  "a Python or Go service builds the database apso migrate builds",
  () => {
    test.each(["go", "python"] as const)(
      "%s",
      async (language) => {
        const input = parseApsorcV2(JSON.parse(fs.readFileSync(fixture).toString()));
        const ddlUrl = freshDb(`apso_parity_ddl_${language}`);
        psql(ddlUrl, schemaDdl(input).join(";\n") + ";");
        const dir = scaffold(language);
        try {
          const command = startCommand(language, dir);

          const syncUrl = freshDb(`apso_parity_sync_${language}`);
          await syncWith(command, dir, syncUrl, language);
          expect(catalogDiff(await catalog(ddlUrl), await catalog(syncUrl))).toEqual([]);

          const before = await catalog(ddlUrl);
          await syncWith(command, dir, ddlUrl, language);
          expect(catalogDiff(before, await catalog(ddlUrl))).toEqual([]);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      600_000
    );
  }
);
