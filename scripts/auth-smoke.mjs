#!/usr/bin/env node
/**
 * End-to-end auth check for generated services, one language per run.
 *
 * Scaffolds a project with the CLI from this checkout, then for a service
 * with no auth block and for each sign-in provider (Auth0, Clerk, Cognito,
 * generic JWT) regenerates it, starts it on a fresh Postgres database, and
 * checks that:
 *   - the API key check built into every service follows the access rules in
 *     apsoai/cli#208 (cases are named with their rule, R0 to R17): nothing
 *     configured refuses everything; APSO_API_KEY accepts those keys and no
 *     other; the platform gateway's service token is verified; a key that
 *     fails is refused even next to a valid user token; a key caller reaches
 *     every route and every tenant's rows
 *   - a 401 says why only when APSO_LOCAL=1 and the service is not on Lambda,
 *     and always carries a request id
 *   - requests without valid credentials get 401 (missing, garbage, expired,
 *     wrong issuer, wrong audience, wrong signing key, alg "none", HS256
 *     signed with the public key, no subject)
 *   - a valid token can list, create, read and delete rows
 *   - /health stays public
 *   - scopeBy keeps each tenant to its own rows, overrides a tenant id sent in
 *     a create body, and refuses a caller with no tenant
 *   - permissions refuse a role outside the list, directly and
 *     through a loaded relation, and allow a role in it; a RolePermission row added by an
 *     owner grants a permission in that tenant only; a member cannot grant
 *     itself; a permission in the token is honored; a hand-written route that
 *     names its own permission (invoice:approve) is held to it the same ways
 *   - mcp serves only the opted-in operations as tools at /mcp,
 *     and a tool call meets the same auth, permission and scope guards as REST
 *   - a service has one MCP address per audience (apsoai/cli#232):
 *     /mcp/internal for service callers, with or without sign-in, and /mcp
 *     for signed-in users only.
 *   - with the better-auth provider, the auth entities (user, account,
 *     session, verification, membership) answer a service caller only: not a
 *     signed-in user, a join from another entity or an MCP tool
 *   - no query parameter or body field reaches another tenant's rows (the
 *     schema-driven cases in src/lib/access/cases.ts, shared with
 *     `apso test access`)
 *   - a TypeScript service accepts the PostgREST query syntax only: each
 *     nestjsx parameter is a 400, a list is a JSON array with a Content-Range
 *     header whose count covers the caller's rows only, and the MCP list tool
 *     takes the same arguments. Python and Go run both syntaxes.
 *   - `apso generate` refuses a schema it cannot enforce
 *   - apso generate writes the access marker (.apso/manifest.json) and git
 *     does not ignore it
 *   - the request log (TypeScript, @apso/logging) has one line per request
 *     with the caller, the request id and why a guard refused, from the
 *     server entry point and from the Lambda handler
 *
 * Every case is named with the rule it proves from src/lib/access/rules.json
 * (apsoai/cli#208). The run ends with a per-rule table and fails when a rule
 * has no case or a case names no rule.
 *
 * Better Auth is the exception to the next paragraph: its tokens come from a
 * real Better Auth server (scripts/better-auth-issuer.mjs; better-auth is
 * installed from npm into the work folder), and its session cookies and
 * session tokens are refused.
 *
 * Tokens are minted locally with the claim shapes each provider issues, signed
 * by a key this script serves as a JWKS. Service tokens are signed the way the
 * platform gateway signs them (ES256), with a key served as a second JWKS.
 *
 * Usage: node scripts/auth-smoke.mjs <typescript|python|go> [provider...]
 * APSO_CRUD_TARBALL, APSO_CRUD_CORE_TARBALL, APSO_CRUD_REQUEST_TARBALL,
 * APSO_CRUD_TYPEORM_TARBALL, APSO_POSTGREST_REQUEST_TARBALL, APSO_MCP_TARBALL
 * and APSO_LOGGING_TARBALL test unreleased builds of those libraries (npm
 * pack output) in the TypeScript service.
 * Needs: `npm run build` first; psql; AUTH_SMOKE_DATABASE_URL pointing at a
 * Postgres server whose user can create databases, e.g.
 * postgres://postgres:postgres@127.0.0.1:5432. Go needs go; Python needs
 * PYTHON (default python3) at 3.11 or later.
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
// The rule list, the per-rule record and the cases that follow from a schema
// are part of the CLI (src/lib/access), so `apso test access` runs the same ones.
import access from "../dist/lib/access/index.js";
import authTypes from "../dist/lib/types/auth.js";
import parser from "../dist/lib/apsorc-parser.js";
import { mutate } from "./access-mutations.mjs";

const language = process.argv[2];
const only = process.argv.slice(3);
if (!["typescript", "python", "go"].includes(language)) {
  console.error("usage: node scripts/auth-smoke.mjs <typescript|python|go> [provider...]");
  process.exit(2);
}
const PG = (process.env.AUTH_SMOKE_DATABASE_URL || "").replace(/\/+$/, "");
if (!PG) {
  console.error("Set AUTH_SMOKE_DATABASE_URL, e.g. postgres://postgres:postgres@127.0.0.1:5432");
  process.exit(2);
}
// Unreleased library builds to install into the generated TypeScript service.
const TARBALLS = {
  "@apso/crud": "APSO_CRUD_TARBALL",
  "@apso/crud-core": "APSO_CRUD_CORE_TARBALL",
  "@apso/crud-request": "APSO_CRUD_REQUEST_TARBALL",
  "@apso/crud-typeorm": "APSO_CRUD_TYPEORM_TARBALL",
  "@apso/postgrest-request": "APSO_POSTGREST_REQUEST_TARBALL",
  "@apso/mcp": "APSO_MCP_TARBALL",
  "@apso/logging": "APSO_LOGGING_TARBALL",
};
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "run");
const PYTHON = process.env.PYTHON || "python3";

// ---------- process helpers ----------

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

const psql = (db, sql) =>
  sh("psql", [`${PG}/${db}`, "-q", "-v", "ON_ERROR_STOP=1", "-Atc", sql]).trim();

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, { headers = {}, body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, text, json, requestId: res.headers.get("x-request-id") };
  } catch (e) {
    return { status: 0, text: String(e), json: undefined, requestId: null };
  }
}

// ---------- token minting ----------

const b64url = (v) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const keyPair = () => crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const signing = keyPair();
const impostor = keyPair();
const edSigning = crypto.generateKeyPairSync("ed25519");
const edImpostor = crypto.generateKeyPairSync("ed25519");
const JWKS = {
  keys: [
    { ...signing.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" },
    { ...edSigning.publicKey.export({ format: "jwk" }), kid: "k2", alg: "EdDSA", use: "sig" },
  ],
};

// The platform gateway's signing key for service tokens, and one it does not hold.
const gateway = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const notGateway = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const GATEWAY_JWKS = {
  keys: [{ ...gateway.publicKey.export({ format: "jwk" }), kid: "gw1", alg: "ES256", use: "sig" }],
};

function mint(payload, { key = signing.privateKey, alg = "RS256", kid = "k1" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + 600, ...payload };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  const head = `${b64url({ alg, typ: "JWT", kid })}.${b64url(body)}`;
  let sig = "";
  if (alg === "RS256") sig = crypto.sign("sha256", Buffer.from(head), key).toString("base64url");
  if (alg === "HS256") sig = crypto.createHmac("sha256", key).update(head).digest("base64url");
  if (alg === "EdDSA") sig = crypto.sign(null, Buffer.from(head), key).toString("base64url");
  if (alg === "ES256") sig = crypto.sign("sha256", Buffer.from(head), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${sig}`;
}

// ---------- provider cases ----------

function providers(base) {
  return {
    auth0: {
      auth: {
        provider: "auth0",
        jwt: { issuer: `${base}/`, audience: "https://api.apso.test", jwksUri: `${base}/.well-known/jwks.json` },
        claims: { workspaceId: "https://apso.test/org_id", roles: "https://apso.test/roles" },
      },
      claims: (org) => ({
        iss: `${base}/`,
        aud: ["https://api.apso.test", `${base}/userinfo`],
        sub: "auth0|6650a1",
        azp: "spa-client",
        scope: "openid profile email",
        "https://apso.test/org_id": org,
        "https://apso.test/roles": ["member"],
      }),
      wrongAudience: { aud: "https://other.example" },
    },
    clerk: {
      // Clerk session tokens: no aud, the active org nested under "o".
      auth: { provider: "clerk", jwt: { issuer: base, authorizedParties: ["http://localhost:3000"] } },
      unauthorizedParty: { azp: "https://evil.example" },
      claims: (org) => ({
        iss: base,
        sub: "user_2abc",
        azp: "http://localhost:3000",
        sid: "sess_1",
        v: 2,
        o: org === undefined ? undefined : { id: org, rol: "admin", slg: "acme" },
      }),
    },
    cognito: {
      // Cognito access token: client_id instead of aud, groups in cognito:groups.
      auth: {
        provider: "cognito",
        jwt: { issuer: `${base}/us-east-1_Test`, audience: "client123", jwksUri: `${base}/us-east-1_Test/.well-known/jwks.json` },
        claims: { workspaceId: "custom:org_id" },
      },
      claims: (org) => ({
        iss: `${base}/us-east-1_Test`,
        sub: "6f1c2d7e-0000-4000-8000-000000000001",
        client_id: "client123",
        token_use: "access",
        username: "ana",
        "cognito:groups": ["admins"],
        "custom:org_id": org,
      }),
      wrongAudience: { client_id: "someone-else" },
    },
    jwt: {
      // Supabase Auth shape through the generic provider.
      auth: {
        provider: "jwt",
        jwt: { issuer: `${base}/auth/v1`, audience: "authenticated", jwksUri: `${base}/auth/v1/.well-known/jwks.json` },
        claims: { workspaceId: "app_metadata.org_id", roles: "app_metadata.roles" },
      },
      claims: (org) => ({
        iss: `${base}/auth/v1`,
        aud: "authenticated",
        sub: "0b8f0a2e-0000-4000-8000-000000000002",
        email: "ana@apso.test",
        role: "authenticated",
        app_metadata: org === undefined ? {} : { org_id: org, roles: ["owner"] },
      }),
      wrongAudience: { aud: "anon" },
    },
    "better-auth-jwt": {
      // Better Auth's JWT plugin: EdDSA keys at /api/auth/jwks, iss and aud = BASE_URL.
      auth: {
        provider: "jwt",
        jwt: { issuer: `${base}/ba`, audience: `${base}/ba`, jwksUri: `${base}/ba/api/auth/jwks`, algorithms: ["EdDSA"] },
        claims: { workspaceId: "activeOrganizationId", roles: "role" },
      },
      signWith: { alg: "EdDSA", key: edSigning.privateKey, kid: "k2" },
      impostor: { alg: "EdDSA", key: edImpostor.privateKey, kid: "k2" },
      claims: (org) => ({
        iss: `${base}/ba`,
        aud: `${base}/ba`,
        sub: "usr_8f2k",
        email: "ana@apso.test",
        name: "Ana",
        role: "admin",
        activeOrganizationId: org,
      }),
      wrongAudience: { aud: "https://other.example" },
    },
  };
}

// ---------- project ----------

// One MCP address per audience (rule R29). Python and Go still serve /mcp
// alone, to a key or a user: apsoai/cli#232 moves them too.
const TWO_ADDRESSES = true;
const INTERNAL = TWO_ADDRESSES ? "/mcp/internal" : "/mcp";

// Permissions need sign-in. MCP tools do not where the service has an internal address.
const entities = (auth) => {
  const full = Boolean(auth);
  const mcp = (ops) => (full || TWO_ADDRESSES ? { mcp: ops } : {});
  return [
    // Organizations are readable as MCP tools: an embed of their tenant-scoped relations is refused there as in REST.
    { name: "Organization", created_at: true, updated_at: true, ...mcp(["read"]), fields: [{ name: "name", type: "text" }] },
    // Projects are readable as MCP tools.
    { name: "Project", created_at: true, updated_at: true, scopeBy: "organizationId", ...mcp(["read"]), fields: [{ name: "title", type: "text" }] },
    // A tenant field that is not named workspaceId/organizationId (imported schemas).
    { name: "Note", created_at: true, updated_at: true, scopeBy: "orgId", fields: [{ name: "body", type: "text" }, { name: "orgId", type: "integer", nullable: true }] },
    // Scoped through its parent (TypeScript only; generate refuses the path for Python and Go).
    { name: "Task", created_at: true, updated_at: true, ...(language === "typescript" ? { scopeBy: "project.organizationId" } : {}), fields: [{ name: "title", type: "text" }] },
    // A "support" role reads every tenant's tickets (scopeOptions.bypassRoles). Readable as MCP tools, for the
    // cases on a stored foreign key to another tenant's project.
    { name: "Ticket", created_at: true, updated_at: true, scopeBy: "organizationId", scopeOptions: { bypassRoles: ["support"] }, ...mcp(["read"]), fields: [{ name: "title", type: "text" }] },
    // Only owners read or delete invoices.
    {
      name: "Invoice",
      created_at: true,
      updated_at: true,
      ...(full ? { permissions: { read: ["owner"], delete: ["owner"] } } : {}),
      ...mcp(true),
      fields: [{ name: "total", type: "integer" }],
    },
    // Runtime grants: an owner gives a role a permission in its own tenant.
    ...(full
      ? [{
          name: "RolePermission",
          created_at: true,
          updated_at: true,
          scopeBy: "organizationId",
          permissions: { create: ["owner"], update: ["owner"], delete: ["owner"] },
          fields: [{ name: "role", type: "text" }, { name: "permission", type: "text" }],
        }]
      : []),
  ];
};
const relationships = (auth) => [
  { from: "Organization", to: "Project", type: "OneToMany" },
  { from: "Project", to: "Task", type: "OneToMany" },
  { from: "Organization", to: "Ticket", type: "OneToMany" },
  // A foreign key between two tenant-scoped entities that is not the scope column.
  { from: "Project", to: "Ticket", type: "OneToMany", nullable: true },
  { from: "Organization", to: "Invoice", type: "OneToMany" },
  ...(auth ? [{ from: "Organization", to: "RolePermission", type: "OneToMany" }] : []),
];

// Go routes are kebab-case (/api/role-permissions).
const route = (plural) =>
  language === "typescript"
    ? `/${plural}`
    : `/api/${(language === "go" ? plural.replace(/(?<=[a-z])(?=[A-Z])/g, "-") : plural).toLowerCase()}`;
const ORGS = route("Organizations");
const PROJECTS = route("Projects");
const rows = (json) => (Array.isArray(json) ? json : json?.data ?? json?.items ?? []);
// How a request loads a relation. A TypeScript service accepts the PostgREST
// query syntax only, so it is a select embed there; Python and Go take both.
const NESTJSX = language !== "typescript";
const VIA = NESTJSX ? "a join" : "a select embed";
const load = (relation) => (NESTJSX ? `join=${relation}` : `select=*,${relation}(*)`);

function scaffold(dir) {
  sh(CLI, ["init", "--name", "authapp", "--language", language, "--skip-platform"], { cwd: dir });
  const project = path.join(dir, "authapp");
  if (language === "typescript") {
    // Register the hand-written controller that generate() writes for each leg.
    const modulePath = path.join(project, "src", "app.module.rest.ts");
    const mod = fs.readFileSync(modulePath, "utf8");
    if (!mod.includes("controllers: [HealthCheckController]")) throw new Error("app.module.rest.ts: controllers list not found");
    fs.writeFileSync(
      modulePath,
      "import { InvoiceActionsController } from './controllers/invoice-actions.controller';\n" +
        mod.replace("controllers: [HealthCheckController]", "controllers: [HealthCheckController, InvoiceActionsController]")
    );
  }
  return project;
}

/**
 * A hand-written route that names its own permission and is an MCP tool. The
 * permission decorator is generated only when an entity has permissions, so a
 * leg without them gets an empty controller.
 */
const INVOICE_ACTIONS = `import { Controller, Param, Post } from '@nestjs/common';
import { McpTool } from '@apso/mcp';
import { Permission } from '../autogen/guards';

@Controller('Invoices')
export class InvoiceActionsController {
  @Post(':id/approve')
  @Permission('invoice:approve', 'owner')
  @McpTool({ name: 'approve_invoice', description: 'Approve one Invoice by id.' })
  approve(@Param('id') id: string) {
    return { id: Number(id), approved: true };
  }
}
`;
const NO_INVOICE_ACTIONS = `import { Controller } from '@nestjs/common';

@Controller('invoice-actions')
export class InvoiceActionsController {}
`;

function generate(project, auth, schema = { entities: entities(auth), relationships: relationships(auth) }) {
  const rcPath = path.join(project, ".apsorc");
  const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
  Object.assign(rc, { version: 2, ...schema, auth });
  fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2));
  sh(CLI, ["generate", "--language", language], { cwd: project });
  mutate(project, language); // the break-each-rule job only (AUTH_SMOKE_MUTATION)
  if (language === "typescript") {
    const guarded = schema.entities.some((e) => e.name === "Invoice" && e.permissions && e.mcp);
    fs.writeFileSync(path.join(project, "src", "controllers", "invoice-actions.controller.ts"), guarded ? INVOICE_ACTIONS : NO_INVOICE_ACTIONS);
    // APSO_*_TARBALL test unreleased builds of the libraries (npm pack output).
    // Each is also an override, so a copy another package depends on is the same build.
    const tarballs = Object.entries(TARBALLS).filter(([, env]) => process.env[env]);
    const pkgPath = path.join(project, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (tarballs.some(([name, env]) => pkg.dependencies[name] !== `file:${path.resolve(process.env[env])}`)) {
      pkg.overrides = { ...pkg.overrides };
      for (const [name, env] of tarballs) {
        const spec = `file:${path.resolve(process.env[env])}`;
        pkg.dependencies[name] = spec;
        pkg.overrides[name] = spec;
      }
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      // The template's lockfile pins the published builds of these packages.
      const lockPath = path.join(project, "package-lock.json");
      if (fs.existsSync(lockPath)) {
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        for (const key of Object.keys(lock.packages ?? {})) if (key.includes("node_modules/@apso/")) delete lock.packages[key];
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
      }
      fs.rmSync(path.join(project, "node_modules", "@apso"), { recursive: true, force: true });
    }
    sh("npm", ["install", "--no-audit", "--no-fund"], { cwd: project });
    sh("npm", ["run", "build"], { cwd: project });
  } else if (language === "go") {
    sh("go", ["mod", "tidy"], { cwd: project });
    const swag = path.join(sh("go", ["env", "GOPATH"]).trim(), "bin", "swag");
    if (!fs.existsSync(swag)) sh("go", ["install", "github.com/swaggo/swag/cmd/swag@latest"]);
    sh(swag, ["init", "-g", "cmd/main.go", "-o", "docs"], { cwd: project });
    sh("go", ["build", "-o", "bin/server", "./cmd"], { cwd: project });
  } else {
    const py = path.join(project, ".venv", "bin", "python");
    if (!fs.existsSync(py)) sh(PYTHON, ["-m", "venv", ".venv"], { cwd: project });
    sh(py, ["-m", "pip", "install", "--quiet", "-e", "."], { cwd: project });
  }
}

/** Start the service with `extra` as its only APSO_* settings. */
async function start(project, db, extra = {}, entry = "dist/main") {
  const port = await freePort();
  const u = new URL(`${PG}/${db}`);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("APSO_") && k !== "AWS_LAMBDA_FUNCTION_NAME")
  );
  let cmd;
  let args;
  if (language === "typescript") {
    Object.assign(env, {
      DATABASE_TYPE: "postgres",
      DATABASE_HOST: u.hostname,
      DATABASE_PORT: u.port || "5432",
      DATABASE_USERNAME: decodeURIComponent(u.username),
      DATABASE_PASSWORD: decodeURIComponent(u.password),
      DATABASE_NAME: db,
      DATABASE_SCHEMA: "public",
      DATABASE_SYNC: "true",
      DATABASE_LOGGING: "false",
      APP_PORT: String(port),
      // The public URL of the MCP endpoint; tokens issued for it are accepted.
      MCP_RESOURCE_URL: `http://127.0.0.1:${port}/mcp`,
    });
    [cmd, args] = [process.execPath, [entry]];
  } else if (language === "go") {
    Object.assign(env, { DATABASE_URL: `${PG}/${db}?sslmode=disable`, DATABASE_SYNC: "true", PORT: String(port), GIN_MODE: "release", MCP_RESOURCE_URL: `http://127.0.0.1:${port}/mcp` });
    [cmd, args] = [path.join(project, "bin", "server"), []];
  } else {
    Object.assign(env, { DATABASE_URL: `${PG.replace(/^postgres(ql)?:/, "postgresql+asyncpg:")}/${db}`, DATABASE_SYNC: "true", PORT: String(port), MCP_RESOURCE_URL: `http://127.0.0.1:${port}/mcp` });
    [cmd, args] = [path.join(project, ".venv", "bin", "python"), ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)]];
  }
  const child = spawn(cmd, args, { cwd: project, env: { ...env, ...extra } });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i += 1) {
    if ((await call("GET", `${base}/health`)).status === 200) return { base, child, log: () => log };
    if (child.exitCode !== null) break;
    await sleep(500);
  }
  child.kill();
  throw new Error(`service did not start:\n${log.slice(-3000)}`);
}

// ---------- checks ----------

// Every case label starts with the rule it proves, "[R6] ...". The record
// behind checker() reports per rule and fails the run for a rule with no case.
const report = access.createReport(language);
// Answers that are not leaks but are still wrong (a 500 for a query the service should refuse).
const warnings = new Set();
const checker = (name) => report.checker(name);

/** CRUD with valid credentials, plus tenant isolation where scopeBy is enforced. */
async function crudAndScope(base, t, auth, auth2, noTenant, support) {
  const org1 = await call("POST", base + ORGS, { headers: auth(undefined), body: { name: "Acme" } });
  const org2 = await call("POST", base + ORGS, { headers: auth(undefined), body: { name: "Beta" } });
  if (!t.expect("[R2] create organization", org1, 200, 201) || !t.expect("[R2] create second organization", org2, 200, 201)) return;
  const [id1, id2] = [org1.json.id, org2.json.id];
  const as1 = auth(String(id1));
  const as2 = auth2 ? auth2(String(id2)) : undefined;

  t.expect("[R2] list organizations", await call("GET", base + ORGS, { headers: as1 }), 200);
  // scopeBy forces the caller's tenant whatever the body says.
  const created = await call("POST", base + PROJECTS, {
    headers: as1,
    body: { title: "Roadmap", organizationId: id2 },
  });
  if (!t.expect("[R8] create project", created, 200, 201)) return;
  const pid = created.json.id;
  const read = await call("GET", `${base}${PROJECTS}/${pid}`, { headers: as1 });
  t.expect("[R6] read project", read, 200);

  if (as2) {
    t.assert("[R8] create body cannot pick another tenant", String(read.json?.organizationId) === String(id1), `organizationId=${read.json?.organizationId}`);
    t.expect("[R6] other tenant cannot read the project", await call("GET", `${base}${PROJECTS}/${pid}`, { headers: as2 }), 403, 404);
    const theirs = await call("GET", base + PROJECTS, { headers: as2 });
    t.expect("[R6] other tenant lists projects", theirs, 200);
    t.assert("[R6] other tenant's list excludes the project", !rows(theirs.json).some((p) => p.id === pid));
    const mine = await call("GET", base + PROJECTS, { headers: as1 });
    t.assert("[R6] own list includes the project", rows(mine.json).some((p) => p.id === pid));
    t.expect("[R6] other tenant cannot update the project", await call("PATCH", `${base}${PROJECTS}/${pid}`, { headers: as2, body: { title: "Taken" } }), 403, 404);
    t.expect("[R6] other tenant cannot delete the project", await call("DELETE", `${base}${PROJECTS}/${pid}`, { headers: as2 }), 403, 404);
    const moved = await call("PATCH", `${base}${PROJECTS}/${pid}`, { headers: as1, body: { title: "Roadmap 2", organizationId: id2 } });
    t.expect("[R8] owner updates the project", moved, 200);
    const after = await call("GET", `${base}${PROJECTS}/${pid}`, { headers: as1 });
    t.assert("[R8] update cannot move the project to another tenant", after.status === 200 && String(after.json?.organizationId) === String(id1) && after.json?.title === "Roadmap 2", `${after.status} ${after.text.slice(0, 200)}`);
    if (noTenant) t.expect("[R9,R27] caller with no tenant cannot list scoped rows", await call("GET", base + PROJECTS, { headers: noTenant }), 403);
    // scopeBy "orgId" takes the caller's tenant too.
    const NOTES = route("Notes");
    const note = await call("POST", base + NOTES, { headers: as1, body: { body: "hi", orgId: id2 } });
    if (t.expect("[R8] create note (scopeBy orgId)", note, 200, 201)) {
      t.assert("[R8] note stores the caller's tenant", String(note.json?.orgId) === String(id1), `orgId=${note.json?.orgId}`);
      t.expect("[R6] other tenant cannot read the note", await call("GET", `${base}${NOTES}/${note.json.id}`, { headers: as2 }), 403, 404);
      const theirNotes = await call("GET", base + NOTES, { headers: as2 });
      t.assert("[R6] other tenant's notes exclude it", theirNotes.status === 200 && !rows(theirNotes.json).some((n) => n.id === note.json.id), `${theirNotes.status}`);
    }
    if (language === "typescript") await nestedScope(base, t, as1, as2, pid);
    if (support) await bypassScope(base, t, as1, as2, support(String(id2)));
  }
  t.expect("[R6] delete project", await call("DELETE", `${base}${PROJECTS}/${pid}`, { headers: as1 }), 200, 204);
}

/** scopeOptions.bypassRoles: a support caller sees other tenants' tickets; a member does not. */
async function bypassScope(base, t, as1, as2, asSupport) {
  const TICKETS = route("Tickets");
  const ticket = await call("POST", base + TICKETS, { headers: as1, body: { title: "Login broken" } });
  if (!t.expect("[R10] create ticket", ticket, 200, 201)) return;
  const tid = ticket.json.id;
  const member = await call("GET", base + TICKETS, { headers: as2 });
  t.assert("[R6] member of another tenant does not list the ticket", member.status === 200 && !rows(member.json).some((x) => x.id === tid), `${member.status} ${member.text.slice(0, 200)}`);
  const support = await call("GET", base + TICKETS, { headers: asSupport });
  t.assert("[R10] support role lists another tenant's ticket", support.status === 200 && rows(support.json).some((x) => x.id === tid), `${support.status} ${support.text.slice(0, 200)}`);
  t.expect("[R10] support role reads another tenant's ticket", await call("GET", `${base}${TICKETS}/${tid}`, { headers: asSupport }), 200);
  t.expect("[R10] delete ticket", await call("DELETE", `${base}${TICKETS}/${tid}`, { headers: as1 }), 200, 204);
}

/** scopeBy "project.organizationId": a Task belongs to its project's tenant. */
async function nestedScope(base, t, as1, as2, pid) {
  const TASKS = route("Tasks");
  const theirProject = await call("POST", base + PROJECTS, { headers: as2, body: { title: "Theirs" } });
  if (!t.expect("[R6] other tenant creates a project", theirProject, 200, 201)) return;
  const pid2 = theirProject.json.id;
  const task = await call("POST", base + TASKS, { headers: as1, body: { title: "Ship it", projectId: pid } });
  if (t.expect("[R6] create task under own project", task, 200, 201)) {
    const tid = task.json.id;
    const mine = await call("GET", base + TASKS, { headers: as1 });
    t.assert("[R6] own task list includes the task", mine.status === 200 && rows(mine.json).some((x) => x.id === tid), `${mine.status} ${mine.text.slice(0, 200)}`);
    const theirs = await call("GET", base + TASKS, { headers: as2 });
    t.assert("[R6] other tenant's task list excludes the task", theirs.status === 200 && !rows(theirs.json).some((x) => x.id === tid), `${theirs.status} ${theirs.text.slice(0, 200)}`);
    t.expect("[R6] other tenant cannot read the task", await call("GET", `${base}${TASKS}/${tid}`, { headers: as2 }), 403, 404);
    t.expect("[R8] task cannot move to another tenant's project", await call("PATCH", `${base}${TASKS}/${tid}`, { headers: as1, body: { projectId: pid2 } }), 403);
    t.expect("[R6] delete task", await call("DELETE", `${base}${TASKS}/${tid}`, { headers: as1 }), 200, 204);
  }
  t.expect("[R8] cannot create a task under another tenant's project", await call("POST", base + TASKS, { headers: as2, body: { title: "Sneak", projectId: pid } }), 403);
  const empty = await call("GET", base + TASKS, { headers: as2 });
  t.assert("[R6] tenant with no tasks lists none", empty.status === 200 && rows(empty.json).length === 0, `${empty.status} ${empty.text.slice(0, 200)}`);
  t.expect("[R6] delete other tenant's project", await call("DELETE", `${base}${PROJECTS}/${pid2}`, { headers: as2 }), 200, 204);
}

async function jwtCase(name, p, boot) {
  const t = checker(name);
  // The Supabase-shaped case also runs with an API key set; the others run with keys off.
  const s = await boot(name === "jwt" ? { APSO_API_KEY: KEY } : {});
  const { base } = s;
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const sign = (claims, opts = {}) => mint(claims, { ...p.signWith, ...opts });
  const valid = (org) => bearer(sign(p.claims(org ?? "1")));
  const reject = async (label, headers) =>
    t.expect(label, await call("GET", base + ORGS, { headers }), 401);

  t.expect("[R1] /health is public", await call("GET", `${base}/health`), 200);
  await reject("[R1] no credentials", {});
  await reject("[R2] garbage token", bearer("not.a.jwt"));
  await reject("[R2] expired token", bearer(sign({ ...p.claims("1"), exp: Math.floor(Date.now() / 1000) - 60 })));
  await reject("[R2] wrong issuer", bearer(sign({ ...p.claims("1"), iss: "https://evil.example/" })));
  if (p.wrongAudience) await reject("[R2] wrong audience", bearer(sign({ ...p.claims("1"), ...p.wrongAudience })));
  if (p.unauthorizedParty) await reject("[R2] azp not an authorized party", bearer(sign({ ...p.claims("1"), ...p.unauthorizedParty })));
  await reject("[R2] signed by another key", bearer(sign(p.claims("1"), p.impostor ?? { key: impostor.privateKey })));
  await reject('[R2] alg "none"', bearer(mint(p.claims("1"), { alg: "none" })));
  await reject("[R2] HS256 signed with the public key", bearer(mint(p.claims("1"), { alg: "HS256", key: signing.publicKey.export({ type: "spki", format: "pem" }) })));
  await reject("[R2] no subject", bearer(sign({ ...p.claims("1"), sub: undefined })));

  // Only the Supabase-shaped case maps a roles array we can set per token.
  const support = name === "jwt" ? (org) => bearer(sign({ ...p.claims(org), app_metadata: { org_id: org, roles: ["support"] } })) : undefined;
  await crudAndScope(base, t, valid, valid, bearer(sign(p.claims(undefined))), support);
  if (name === "jwt") {
    const as = (roles, org = "1", extra = {}) => bearer(sign({ ...p.claims(org), app_metadata: { org_id: org, roles }, ...extra }));
    await rolePermissions(base, t, as(["owner"]), as(["member"]), as(["member"], "2"), as(["member"], "1", { permissions: ["invoice:delete", "invoice:approve"] }), (permissions) => as(["member"], "1", { permissions }));
    await mcpTools(base, t, as(["owner"]), as(["member"]), as(["owner"], "2"), as(["owner"], "1", { aud: `${base}/mcp` }));
  }
  if (language === "typescript") {
    const user = { type: "user", userId: p.claims("1").sub, tenantId: "1" };
    requestLine(t, "a signed-in user is a user caller with its tenant", await logged(s, "GET", ORGS, { headers: valid("1") }), 200, user, undefined);
    requestLine(t, "an expired token is refused by the auth guard", await logged(s, "GET", ORGS, { headers: bearer(sign({ ...p.claims("1"), exp: Math.floor(Date.now() / 1000) - 60 })) }), 401, ANONYMOUS, "invalid token");
    requestLine(t, "no token is refused by the auth guard", await logged(s, "GET", ORGS), 401, ANONYMOUS, "no bearer token provided");
    requestLine(t, "a caller with no tenant is refused by the scope guard", await logged(s, "GET", PROJECTS, { headers: bearer(sign(p.claims(undefined))) }), 403, { type: "user", userId: p.claims("1").sub }, "no tenant");
    requestLine(t, "a row outside the tenant is refused by the scope guard", await logged(s, "GET", `${PROJECTS}/999999`, { headers: valid("1") }), 403, user, "outside the tenant scope");
    requestLine(t, "a relation outside the tenant is refused by the relation check", await logged(s, "GET", `${ORGS}?${load("projects")}`, { headers: valid("1") }), 403, user, "relation outside the tenant scope");
  }
  if (name === "jwt" && language === "typescript") {
    const member = bearer(sign({ ...p.claims("1"), app_metadata: { org_id: "1", roles: ["member"] } }));
    requestLine(t, "a role outside the list is refused by the permission guard", await logged(s, "GET", route("Invoices"), { headers: member }), 403, { type: "user", userId: p.claims("1").sub, tenantId: "1" }, "missing permission invoice:read");
    requestLine(t, "a role outside the list is refused through a select embed by the relation check", await logged(s, "GET", `${ORGS}?${load("invoices")}`, { headers: member }), 403, { type: "user", userId: p.claims("1").sub, tenantId: "1" }, "missing permission invoice:read");
    requestLine(t, "a role outside a hand-written route's own permission is refused by the permission guard", await logged(s, "POST", `${route("Invoices")}/1/approve`, { headers: member }), 403, { type: "user", userId: p.claims("1").sub, tenantId: "1" }, "missing permission invoice:approve");
  }
  if (name === "jwt") {
    await keyNextToSignIn(base, t, valid("1"), bearer(sign({ ...p.claims("1"), app_metadata: { org_id: "1", roles: ["member"] } })));
    const platform = await boot({ ...PLATFORM, ...(TWO_ADDRESSES ? { APSO_INTERNAL_AUTH_ISSUER: APSO_ISSUER } : {}) });
    await gatewayNextToSignIn(platform.base, t, bearer(sign(p.claims("1"))));
  } else {
    t.expect("[R14] keys off: a request that sends x-api-key is refused, valid user token or not", await call("GET", base + ORGS, { headers: { ...valid("1"), "x-api-key": KEY } }), 401);
  }
  await schemaCases(p, boot, t, sign);
  return t.failures;
}

/**
 * The cases that follow from the schema (src/lib/access/cases.ts): two seeded
 * tenants, then every scoped entity against each way a query or a body could
 * reach the other tenant, plus permissions and MCP tools where the schema has
 * them. Runs on a fresh database with an API key set, which seeds the rows.
 */
async function schemaCases(p, boot, t, sign) {
  const { base } = await boot({ APSO_API_KEY: KEY });
  const rolesClaim = authTypes.resolveJwtAuth(p.auth).claims.roles;
  const user = ({ tenant, roles = [] } = {}) => {
    const claims = p.claims(tenant);
    // Clerk's role claim (o.rol) is one role, not a list.
    if (roles.length > 0) access.setClaim(claims, rolesClaim, p.auth.provider === "clerk" ? roles[0] : roles);
    return { authorization: `Bearer ${sign(claims)}` };
  };
  const { entities: parsed, relationshipMap } = parser.parseApsorcV2({ version: 2, rootFolder: "src", entities: entities(p.auth), relationships: relationships(p.auth) });
  await access.runAccessCases({
    base,
    model: access.buildModel(parsed, relationshipMap, language, p.auth),
    t,
    key: key(KEY),
    user,
    roles: Boolean(rolesClaim),
    mcp: (headers) => access.connectMcp(base, headers),
    log: console.log,
    warn: (line) => warnings.add(line),
  });
}

// ---------- build time (R26, R27) ----------

/** The generate tool inside `apso mcp serve` is a second way to generate; it writes the access marker too. */
async function serveToolMarker(project) {
  const t = checker("generate");
  const rcPath = path.join(project, ".apsorc");
  const rc = { ...JSON.parse(fs.readFileSync(rcPath, "utf8")), version: 2, language, entities: entities(), relationships: relationships(), auth: undefined };
  fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2));
  const marker = path.join(project, ".apso", "manifest.json");
  fs.rmSync(marker, { force: true });
  const client = new Client({ name: "auth-smoke-serve", version: "1" });
  await client.connect(new StdioClientTransport({ command: CLI, args: ["mcp", "serve"], cwd: project, env: process.env, stderr: "ignore" }));
  const result = await client.callTool({ name: "scaffold_api", arguments: { language } }).finally(() => client.close());
  const manifest = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : {};
  t.assert("[R20] the generate tool of apso mcp serve writes the access marker", !result.isError && manifest.accessContract === 1, `${JSON.stringify(manifest)} ${JSON.stringify(result.content).slice(0, 300)}`);
  return t.failures;
}

/** `apso generate` must fail for a schema it cannot enforce, and say why. */
function buildTimeCases(project) {
  const t = checker("generate");
  const jwtAuth = { provider: "jwt", jwt: { issuer: "https://issuer.apso.test" }, claims: { workspaceId: "org_id" } };
  const org = { name: "Organization", fields: [{ name: "name", type: "text" }] };
  const doc = (extra) => ({ name: "Doc", fields: [{ name: "title", type: "text" }], ...extra });
  const rcPath = path.join(project, ".apsorc");
  const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
  const refuses = (label, schema, pattern) => {
    fs.writeFileSync(rcPath, JSON.stringify({ ...rc, version: 2, language, relationships: [], auth: undefined, ...schema }, null, 2));
    const r = spawnSync(CLI, ["generate", "--language", language], { cwd: project, encoding: "utf8" });
    const out = `${r.stdout}${r.stderr}`.replace(/\s+/g, " ");
    t.assert(label, r.status !== 0 && pattern.test(out), `exit ${r.status}: ${out.slice(-400)}`);
    // apso schema validate runs the same checks, so it refuses the same schema for the same reason.
    const v = spawnSync(CLI, ["schema", "validate", "--local"], { cwd: project, encoding: "utf8" });
    // oclif wraps a long error over several lines, each starting with "›".
    const said = `${v.stdout}${v.stderr}`.replace(/[\s›]+/g, " ");
    t.assert(`${label}, and apso schema validate agrees`, v.status !== 0 && pattern.test(said), `exit ${v.status}: ${said.slice(-400)}`);
  };
  {
    // A tenant scope with no tenant claim is a warning: generate and validate succeed and say which provider.
    fs.writeFileSync(rcPath, JSON.stringify({ ...rc, version: 2, language, auth: { provider: "auth0", jwt: { issuer: "https://issuer.apso.test/", audience: "api" } }, entities: [org, doc({ scopeBy: "organizationId" })], relationships: [{ from: "Organization", to: "Doc", type: "OneToMany" }] }, null, 2));
    for (const [what, args] of [["generate", ["generate", "--language", language]], ["schema validate", ["schema", "validate", "--local"]]]) {
      const r = spawnSync(CLI, args, { cwd: project, encoding: "utf8" });
      const out = `${r.stdout}${r.stderr}`.replace(/[\s›]+/g, " ");
      t.assert(`[R27] apso ${what} succeeds and warns when a provider has no tenant claim for a tenant scope`, r.status === 0 && /auth provider "auth0" \(https:\/\/issuer\.apso\.test\/\) has no tenant claim, but Doc is tenant-scoped/.test(out), `exit ${r.status}: ${out.slice(-400)}`);
    }
  }
  // Permissions and MCP tools are generated in every language, so their schema checks run in each.
  refuses("[R27] generate refuses permissions without sign-in", { entities: [doc({ permissions: { read: ["owner"] } })] }, /permissions.*auth block/);
  refuses("[R27] generate refuses a grants entity anyone can write", { auth: jwtAuth, entities: [doc({ permissions: { read: ["owner"] } }), { name: "RolePermission", fields: [{ name: "role", type: "text" }, { name: "permission", type: "text" }] }] }, /grant themselves any permission/);
  refuses("[R27] generate refuses a grants entity with no tenant in a tenant-scoped schema", { auth: jwtAuth, entities: [org, doc({ scopeBy: "organizationId", permissions: { read: ["owner"] } }), { name: "RolePermission", permissions: { create: ["owner"], update: ["owner"], delete: ["owner"] }, fields: [{ name: "role", type: "text" }, { name: "permission", type: "text" }] }], relationships: [{ from: "Organization", to: "Doc", type: "OneToMany" }] }, /every tenant/);
  // The tenant on a create always comes from the caller, so the option that kept the body's tenant is gone.
  refuses("[R6,R8] generate refuses scopeOptions.enforceOn", { auth: jwtAuth, entities: [org, doc({ scopeBy: "organizationId", scopeOptions: { enforceOn: ["find", "get"] } })], relationships: [{ from: "Organization", to: "Doc", type: "OneToMany" }] }, /enforceOn is no longer an option.*on[\s›]+every[\s›]+operation.*service[\s›]+caller/);
  for (const value of [false, true])
    refuses(`[R8] generate refuses scopeOptions.injectOnCreate (${value})`, { auth: jwtAuth, entities: [org, doc({ scopeBy: "organizationId", scopeOptions: { injectOnCreate: value } })], relationships: [{ from: "Organization", to: "Doc", type: "OneToMany" }] }, /injectOnCreate is no longer an option.*always[\s›]+comes[\s›]+from[\s›]+the[\s›]+caller.*can[\s›]+set[\s›]+any[\s›]+tenant/);
  if (language !== "typescript") {
    // What this language cannot enforce it refuses, so the rule is never silently missing.
    refuses("[R26,R6] generate refuses a scopeBy path through a parent for this language", { auth: jwtAuth, entities: [org, { name: "Project", scopeBy: "organizationId", fields: [{ name: "title", type: "text" }] }, doc({ scopeBy: "project.organizationId" })], relationships: [{ from: "Organization", to: "Project", type: "OneToMany" }, { from: "Project", to: "Doc", type: "OneToMany" }] }, /path through a parent/);
  }
  // Every sign-in provider is a JWT provider in every language; the removed ones and an incomplete one fail.
  refuses("[R27] generate refuses the removed custom-db-session provider", { auth: { provider: "custom-db-session" }, entities: [doc({})] }, /"custom-db-session" was removed/);
  refuses("[R27] generate refuses the removed api-key provider", { auth: { provider: "api-key" }, entities: [doc({})] }, /"api-key" was removed/);
  refuses("[R27] generate refuses better-auth without its url", { auth: { provider: "better-auth" }, entities: [doc({})] }, /auth\.url/);
  return t.failures;
}

/**
 * mcp: true on Invoice and mcp: ["read"] on Project. Tools are the API's own
 * routes, so every call below has to pass the same guards a REST call does.
 */
async function mcpTools(base, t, owner, member, otherOwner, ownerForMcp) {
  const connect = async (headers) => {
    const client = new Client({ name: "auth-smoke", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
    return client;
  };
  const text = (result) => result.content?.[0]?.text ?? "";
  const rowsOf = (result) => (result.isError ? undefined : rows(JSON.parse(text(result))));
  const [asOwner, asMember, asOther] = await Promise.all([connect(owner), connect(member), connect(otherOwner)]);

  // OAuth sign-in discovery: no token gets the 401 that points a client at
  // the metadata, and the metadata names the identity provider.
  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const anonymous = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(rpc),
  });
  const challenge = anonymous.headers.get("www-authenticate") ?? "";
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  t.assert("[R22] mcp without credentials is a 401 that names the sign-in metadata", anonymous.status === 401 && Boolean(metadataUrl), `${anonymous.status} ${challenge}`);
  const metadata = metadataUrl ? await call("GET", metadataUrl) : { json: undefined, text: "" };
  t.assert(
    "[R22] mcp sign-in metadata names the token issuer and this endpoint",
    metadata.json?.resource === `${base}/mcp` && Array.isArray(metadata.json?.authorization_servers) && metadata.json.authorization_servers.length === 1,
    metadata.text
  );
  const badToken = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer not.a.jwt" },
    body: JSON.stringify(rpc),
  });
  t.assert("[R22] mcp with a bad token is a 401 invalid_token", badToken.status === 401 && (badToken.headers.get("www-authenticate") ?? "").includes("invalid_token"));
  // An MCP client asks the identity provider for a token for the MCP URL.
  const issuedForMcp = await (await connect(ownerForMcp)).listTools().then((r) => r.tools.length, () => 0);
  t.assert("[R22] mcp accepts a token issued for the MCP endpoint's URL", issuedForMcp > 0);

  const listed = (await asOwner.listTools()).tools;
  const names = listed.map((tool) => tool.name).sort();
  // approve_invoice is the hand-written route the TypeScript project adds.
  const expected = [...(language === "typescript" ? ["approve_invoice"] : []), "create_invoice", "delete_invoice", "get_invoice", "get_organization", "get_project", "get_ticket", "list_invoices", "list_organizations", "list_projects", "list_tickets", "update_invoice"];
  t.assert("[R21] mcp lists only the opted-in operations", JSON.stringify(names) === JSON.stringify(expected), names.join(","));
  if (language !== "typescript") {
    // Python reads these from its OpenAPI document; Go has none, so the CLI writes them from .apsorc.
    const schema = (name) => listed.find((tool) => tool.name === name)?.inputSchema?.properties ?? {};
    t.assert("[R21] mcp create tool's schema has the entity's fields under body", schema("create_invoice").body?.properties?.total?.type === "integer", JSON.stringify(schema("create_invoice")).slice(0, 300));
    t.assert("[R21] mcp list tool's schema has limit, filter and join", ["limit", "filter", "join"].every((k) => k in schema("list_invoices")), Object.keys(schema("list_invoices")).join(","));
    t.assert("[R21] mcp get tool's schema has id", "id" in schema("get_invoice"));
  }

  const denied = await asMember.callTool({ name: "list_invoices", arguments: {} });
  t.assert("[R23] mcp call by a member lacks invoice:read", denied.isError === true && text(denied).includes("invoice:read"), text(denied));

  // Invoice carries the permissions; Project carries the tenant scope.
  const created = await asOwner.callTool({ name: "create_invoice", arguments: { body: { total: 7, organizationId: 1 } } });
  const invoice = created.isError ? {} : JSON.parse(text(created));
  t.assert("[R23] mcp create by the owner works", !created.isError && invoice.total === 7, text(created));
  const mine = rowsOf(await asOwner.callTool({ name: "list_invoices", arguments: { limit: 100 } }));
  t.assert("[R23] mcp list shows the owner its invoice", mine?.some((row) => row.id === invoice.id) === true);

  const project = await call("POST", base + PROJECTS, { headers: owner, body: { title: "mcp scoped", organizationId: 2 } });
  if (!t.expect("[R23] create a project over REST for the mcp scope checks", project, 200, 201)) return;
  const own = rowsOf(await asOwner.callTool({ name: "list_projects", arguments: { limit: 100 } }));
  t.assert("[R23] mcp list shows the owner its project", own?.some((row) => row.id === project.json.id) === true);
  const theirs = rowsOf(await asOther.callTool({ name: "list_projects", arguments: { limit: 100 } }));
  t.assert("[R23] mcp list hides it from another tenant", theirs !== undefined && !theirs.some((row) => row.id === project.json.id));
  const crossGet = await asOther.callTool({ name: "get_project", arguments: { id: project.json.id } });
  t.assert("[R23] mcp get by id is refused across tenants", crossGet.isError === true, text(crossGet));
  if (!NESTJSX) await postgrestTools(base, t, { owner, otherOwner, asOwner, asOther, listed, project: project.json, rowsOf, text });
  if (language === "typescript") {
    // The hand-written route is checked by the permission it names.
    const memberApprove = await asMember.callTool({ name: "approve_invoice", arguments: { id: invoice.id } });
    t.assert("[R23] mcp approve by a member lacks invoice:approve", memberApprove.isError === true && text(memberApprove).includes("invoice:approve"), text(memberApprove));
    const approved = await asOwner.callTool({ name: "approve_invoice", arguments: { id: invoice.id } });
    t.assert("[R23] mcp approve by the owner works", !approved.isError && text(approved).includes('"approved":true'), text(approved));
  }
  const memberDelete = await asMember.callTool({ name: "delete_invoice", arguments: { id: invoice.id } });
  t.assert("[R23] mcp delete by a member lacks invoice:delete", memberDelete.isError === true && text(memberDelete).includes("invoice:delete"), text(memberDelete));
  const removed = await asOwner.callTool({ name: "delete_invoice", arguments: { id: invoice.id } });
  t.assert("[R23] mcp delete by the owner works", !removed.isError, text(removed));
}

/**
 * A PostgREST-only service (TypeScript): the list tool takes the same
 * arguments as the REST route's query, and a tool call or a count tells a
 * caller about its own tenant's rows only.
 */
async function postgrestTools(base, t, { owner, otherOwner, asOwner, asOther, listed, project, rowsOf, text }) {
  const schema = listed.find((tool) => tool.name === "list_projects")?.inputSchema?.properties ?? {};
  t.assert(
    "[R21] mcp list tool's schema has select, order, limit, offset, or, and, a filter per column and embedded, and no nestjsx parameter",
    ["select", "order", "limit", "offset", "or", "and", "id", "title", "organizationId", "embedded"].every((k) => k in schema) && !["filter", "join", "sort", "s", "fields", "page", "per_page", "cache"].some((k) => k in schema),
    Object.keys(schema).join(",")
  );
  const description = listed.find((tool) => tool.name === "list_projects")?.description ?? "";
  t.assert("[R21] mcp list tool's description is in PostgREST terms", /op\.value/.test(description) && !/filter, sort, join/.test(description), description);

  // 26 more projects and a task for tenant 1, so it has more than the default page of 25. One project for tenant 2.
  const ids = [project.id];
  for (let i = 0; i < 26; i += 1) ids.push((await call("POST", base + PROJECTS, { headers: owner, body: { title: `mcp page ${i}` } })).json?.id);
  const theirs = await call("POST", base + PROJECTS, { headers: otherOwner, body: { title: "mcp scoped" } });
  const task = await call("POST", base + route("Tasks"), { headers: owner, body: { title: "mcp task", projectId: project.id } });
  const theirTask = await call("POST", base + route("Tasks"), { headers: otherOwner, body: { title: "mcp task", projectId: theirs.json?.id } });
  if (!t.assert("[R23] create rows over REST for the PostgREST tool checks", ids.every((id) => id !== undefined) && [theirs, task, theirTask].every((r) => [200, 201].includes(r.status)), `${theirs.status} ${task.status} ${theirTask.status} ${theirTask.text.slice(0, 200)}`)) return;
  const idsOf = (result) => rowsOf(result)?.map((row) => row.id).sort((a, b) => a - b);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // A column filter. Both tenants have a project with this title.
  const byTitle = { title: "eq.mcp scoped", select: "id,title,organizationId" };
  const mine = await asOwner.callTool({ name: "list_projects", arguments: byTitle });
  t.assert("[R7,R23] mcp list with a column filter returns the caller's matching row", same(idsOf(mine), [project.id]), text(mine));
  const other = await asOther.callTool({ name: "list_projects", arguments: byTitle });
  t.assert("[R7,R23] mcp list with a column filter returns another tenant only its own matching row", same(idsOf(other), [theirs.json.id]), text(other));
  const rest = await call("GET", `${base}${PROJECTS}?title=${encodeURIComponent("eq.mcp scoped")}&select=id,title,organizationId`, { headers: owner });
  t.assert("[R23] mcp list with a column filter gets the REST answer", rest.status === 200 && text(mine) === rest.text, `${rest.status} ${rest.text.slice(0, 200)} / ${text(mine).slice(0, 200)}`);

  // A filter on embedded rows. Both tenants have a task with this title.
  const byTask = { select: "id,tasks!inner(id,title)", embedded: { "tasks.title": "eq.mcp task" } };
  const withTask = await asOwner.callTool({ name: "list_projects", arguments: byTask });
  t.assert("[R7,R23] mcp list with an embedded filter returns the caller's matching row", same(idsOf(withTask), [project.id]) && same(rowsOf(withTask)?.[0]?.tasks?.map((row) => row.id), [task.json.id]), text(withTask));
  const otherWithTask = await asOther.callTool({ name: "list_projects", arguments: byTask });
  t.assert("[R7,R23] mcp list with an embedded filter returns another tenant only its own matching row", same(idsOf(otherWithTask), [theirs.json.id]), text(otherWithTask));

  // An embed the caller may not load is refused, by the tool as by the route.
  const refusedRest = await call("GET", `${base}${ORGS}?select=*,projects(*)`, { headers: owner });
  t.assert("[R7] a select embed of a relation outside the tenant scope is a 403 that names the relation", refusedRest.status === 403 && refusedRest.text.includes('The relation \\"projects\\" cannot be loaded'), `${refusedRest.status} ${refusedRest.text.slice(0, 200)}`);

  // The default page: 25 rows, and a count of the caller's rows only.
  // What the service caller sees of tenant 1 is the expected answer.
  const stored = await call("GET", `${base}${PROJECTS}?organizationId=eq.1&select=id&order=id.asc&limit=100`, { headers: key(KEY) });
  const own = rows(stored.json).map((row) => row.id);
  const total = own.length;
  t.assert("[R13] the service caller lists tenant 1's projects for the checks below", stored.status === 200 && ids.every((id) => own.includes(id)) && !own.includes(theirs.json.id), stored.text.slice(0, 200));
  const page = await fetch(`${base}${PROJECTS}`, { headers: owner });
  t.assert("[R6] a full default page is a 206 whose Content-Range total is the caller's rows only", page.status === 206 && page.headers.get("content-range") === `0-24/${total}` && (await page.json()).length === 25, `${page.status} Content-Range ${page.headers.get("content-range")}`);
  const exact = await fetch(`${base}${PROJECTS}?limit=2&select=id`, { headers: { ...owner, prefer: "count=exact" } });
  t.assert("[R6] Prefer: count=exact counts the caller's rows only", exact.status === 206 && exact.headers.get("content-range") === `0-1/${total}` && exact.headers.get("preference-applied") === "count=exact", `${exact.status} Content-Range ${exact.headers.get("content-range")}`);
  const partial = await asOwner.callTool({ name: "list_projects", arguments: { select: "id" } });
  t.assert("[R6,R23] mcp list with no limit says the result is partial and counts the caller's rows only", rowsOf(partial)?.length === 25 && partial.content?.[1]?.text === `Partial result: rows 0-24 of ${total}. Send limit and offset for the rest.`, JSON.stringify(partial.content).slice(0, 300));
  const all = await asOwner.callTool({ name: "list_projects", arguments: { select: "id", limit: 100 } });
  t.assert("[R6,R23] mcp list with a limit returns every row of the caller's tenant and no other", same(idsOf(all), own) && all.content?.length === 1, text(all));

  // A nestjsx argument is not a tool argument: it never reaches the route.
  const legacy = await asOwner.callTool({ name: "list_projects", arguments: { filter: [`organizationId||$eq||2`], join: ["organization"], limit: 100 } });
  t.assert("[R7,R23] mcp list given nestjsx arguments returns the caller's rows only", same(idsOf(legacy), own), text(legacy));
}

/**
 * permissions: { read: ["owner"], delete: ["owner"] } on Invoice; create is open.
 * Then runtime grants (RolePermission rows, scoped to the tenant) and a
 * permission carried in the token extend that, and nothing else does.
 */
async function rolePermissions(base, t, owner, member, otherMember, memberWithDelete, memberWith) {
  const INVOICES = route("Invoices");
  const GRANTS = route("RolePermissions");
  const org = await call("POST", base + ORGS, { headers: owner, body: { name: "Billing Co" } });
  if (!t.expect("[R11] create organization for invoices", org, 200, 201)) return;
  const created = await call("POST", base + INVOICES, { headers: member, body: { total: 100, organizationId: org.json.id } });
  if (!t.expect("[R11] member creates an invoice (create not restricted)", created, 200, 201)) return;
  const iid = created.json.id;
  t.expect("[R11] member cannot list invoices", await call("GET", base + INVOICES, { headers: member }), 403);
  t.expect("[R11] member cannot read an invoice", await call("GET", `${base}${INVOICES}/${iid}`, { headers: member }), 403);
  t.expect(`[R11] member cannot read invoices through ${VIA}`, await call("GET", `${base}${ORGS}?${load("invoices")}`, { headers: member }), 403);
  t.expect(`[R11] member lists organizations without ${VIA}`, await call("GET", base + ORGS, { headers: member }), 200);
  if (language !== "typescript") {
    // Python and Go load relations two more ways; both meet the same rule.
    t.expect("[R11] member cannot read invoices through a PostgREST embed", await call("GET", `${base}${ORGS}?select=invoices(*)`, { headers: member }), 403);
    t.expect("[R11] owner reads invoices through a PostgREST embed", await call("GET", `${base}${ORGS}?select=invoices(*)`, { headers: owner }), 200);
  }
  if (language === "go") t.expect("[R11] member cannot read invoices through a join spelled Invoices", await call("GET", `${base}${ORGS}?join=Invoices`, { headers: member }), 403);
  t.expect("[R11] member cannot delete an invoice", await call("DELETE", `${base}${INVOICES}/${iid}`, { headers: member }), 403);
  t.expect("[R11] owner lists invoices", await call("GET", base + INVOICES, { headers: owner }), 200);
  t.expect(`[R11] owner reads invoices through ${VIA}`, await call("GET", `${base}${ORGS}?${load("invoices")}`, { headers: owner }), 200);

  // A hand-written route that names its own permission: POST would otherwise
  // be checked as invoice:create, which members have.
  if (language === "typescript") {
    const APPROVE = `${base}${INVOICES}/${iid}/approve`;
    const refused = await call("POST", APPROVE, { headers: member });
    t.assert("[R11] member cannot approve an invoice (invoice:approve)", refused.status === 403 && refused.text.includes("invoice:approve"), `${refused.status} ${refused.text.slice(0, 200)}`);
    t.expect("[R11] owner approves an invoice", await call("POST", APPROVE, { headers: owner }), 200, 201);
    t.expect("[R11] member with invoice:approve in its token approves", await call("POST", APPROVE, { headers: memberWithDelete }), 200, 201);
    const approveGrant = await call("POST", base + GRANTS, { headers: owner, body: { role: "member", permission: "invoice:approve" } });
    if (t.expect("[R12] owner grants members invoice:approve", approveGrant, 200, 201)) {
      t.expect("[R12] member approves after the grant", await call("POST", APPROVE, { headers: member }), 200, 201);
      t.expect("[R12] member of another tenant still cannot approve", await call("POST", APPROVE, { headers: otherMember }), 403);
      t.expect("[R12] owner revokes the approve grant", await call("DELETE", `${base}${GRANTS}/${approveGrant.json.id}`, { headers: owner }), 200, 204);
      t.expect("[R12] member cannot approve after the revoke", await call("POST", APPROVE, { headers: member }), 403);
    }
    // The named permission is for that route only: it does not open the
    // entity's rows, directly or through a relation.
    const approver = memberWith(["invoice:approve"]);
    t.expect("[R11] a caller with only invoice:approve cannot list invoices", await call("GET", base + INVOICES, { headers: approver }), 403);
    t.expect("[R11] a caller with only invoice:approve cannot read invoices through a select embed", await call("GET", `${base}${ORGS}?${load("invoices")}`, { headers: approver }), 403);
  }

  // Runtime grants.
  t.expect("[R12] member cannot grant itself a permission", await call("POST", base + GRANTS, { headers: member, body: { role: "member", permission: "invoice:read" } }), 403);
  const grant = await call("POST", base + GRANTS, { headers: owner, body: { role: "member", permission: "invoice:read", organizationId: 2 } });
  if (t.expect("[R12] owner grants members invoice:read", grant, 200, 201)) {
    t.assert("[R12] grant is stored in the owner's tenant", String(grant.json?.organizationId) === "1", `organizationId=${grant.json?.organizationId}`);
    t.expect("[R12] member lists invoices after the grant", await call("GET", base + INVOICES, { headers: member }), 200);
    t.expect(`[R12] member reads invoices through ${VIA} after the grant`, await call("GET", `${base}${ORGS}?${load("invoices")}`, { headers: member }), 200);
    t.expect("[R12] member of another tenant still cannot list invoices", await call("GET", base + INVOICES, { headers: otherMember }), 403);
    t.expect("[R12] the grant does not include delete", await call("DELETE", `${base}${INVOICES}/${iid}`, { headers: member }), 403);
    t.expect("[R12] owner revokes the grant", await call("DELETE", `${base}${GRANTS}/${grant.json.id}`, { headers: owner }), 200, 204);
    t.expect("[R12] member cannot list invoices after the revoke", await call("GET", base + INVOICES, { headers: member }), 403);
  }

  // A permission in the token (Auth0 RBAC style). The claim is a list, or one
  // permission as a string; a string is never split on spaces.
  t.expect("[R11] a permissions claim that is one string grants that permission", await call("GET", base + INVOICES, { headers: memberWith("invoice:read") }), 200);
  t.expect("[R11] a space-separated permissions string is one name, not a list", await call("GET", base + INVOICES, { headers: memberWith("invoice:read invoice:delete") }), 403);
  t.expect("[R11] member with invoice:delete in its token deletes the invoice", await call("DELETE", `${base}${INVOICES}/${iid}`, { headers: memberWithDelete }), 200, 204);
}

// ---------- request log (@apso/logging, TypeScript) ----------

let logSeq = 0;
/** Make a request and find the request line the service wrote for it. */
async function logged(s, method, url, opts = {}) {
  const id = `smoke-log-${(logSeq += 1)}`;
  const res = await call(method, s.base + url, { ...opts, headers: { ...opts.headers, "x-request-id": id } });
  // The line is written when the response finishes, which can be just after the client has it.
  for (let i = 0; i < 20; i += 1) {
    for (const text of s.log().split("\n")) {
      if (!text.includes(`"requestId":"${id}"`)) continue;
      try {
        const line = JSON.parse(text);
        if (line.type === "request") return { res, line };
      } catch {
        // not a JSON line
      }
    }
    await sleep(100);
  }
  return { res, line: undefined };
}

/** The request line has this status, caller and refusal reason, and the id the response carries. */
function requestLine(t, label, { res, line }, status, caller, denied) {
  const ok = res.status === status && line?.status === status && line.requestId === res.requestId && JSON.stringify(line.caller) === JSON.stringify(caller) && line.denied === denied;
  t.assert(`[R24] log, ${label}`, ok, `${res.status} ${JSON.stringify(line)}`);
}

const ANONYMOUS = { type: "anonymous" };

/** The Lambda handler behind a local HTTP server, so the same requests reach it. */
const LAMBDA_ENTRY = "dist/lambda-smoke.js";
const LAMBDA_SERVER = `
const http = require('http');
const { handler } = require('./lambda');
http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c)).on('end', async () => {
    const [rawPath, rawQueryString = ''] = req.url.split('?');
    const out = await handler({
      version: '2.0', routeKey: '$default', rawPath, rawQueryString, headers: req.headers,
      body: Buffer.concat(chunks).toString() || undefined, isBase64Encoded: false,
      requestContext: { http: { method: req.method, path: rawPath, sourceIp: '127.0.0.1' } },
    }, {});
    res.writeHead(out.statusCode, out.headers);
    res.end(out.body);
  });
}).listen(process.env.APP_PORT, '127.0.0.1');
`;

/** Key callers and refusals in the request log, from main.ts and from lambda.ts. */
async function keyRequestLog(project, db, t, s) {
  const keyId = crypto.createHash("sha256").update(KEY).digest("hex").slice(0, 8);
  const lines = async (via, server) => {
    requestLine(t, `${via}: /health is anonymous`, await logged(server, "GET", "/health"), 200, ANONYMOUS, undefined);
    requestLine(t, `${via}: no credential is refused by the key guard`, await logged(server, "GET", ORGS), 401, ANONYMOUS, "no credential");
    requestLine(t, `${via}: a wrong key is refused by the key guard`, await logged(server, "GET", ORGS, { headers: key("sk_smoke_nope") }), 401, ANONYMOUS, "api key not recognised");
    requestLine(t, `${via}: a key caller is a service with the key's id`, await logged(server, "GET", ORGS, { headers: key(KEY) }), 200, { type: "service", keyId }, undefined);
    t.assert(`[R25] log, ${via}: no key is written to the log`, !server.log().includes(KEY) && !server.log().includes("sk_smoke_nope"));
    t.assert(`[R24] log, ${via}: Nest's own lines are JSON too`, !/\[Nest\]/.test(server.log()), server.log().slice(0, 300));
  };
  await lines("server", s);
  fs.writeFileSync(path.join(project, LAMBDA_ENTRY), LAMBDA_SERVER);
  const lambda = await start(project, db, { APSO_API_KEY: KEY }, LAMBDA_ENTRY);
  try {
    await lines("lambda", lambda);
  } finally {
    lambda.child.kill();
  }
}

// ---------- API keys (apsoai/cli#207; rules from apsoai/cli#208) ----------

const KEY = "sk_smoke_current";
const OLD_KEY = "sk_smoke_previous";
const SERVICE_ID = "svc_smoke";
let PLATFORM; // the environment the platform's provisioner sets; filled in once the JWKS server is up

const key = (k) => ({ "x-api-key": k });
const message = (res) => res.json?.message ?? res.json?.error ?? res.json?.detail?.message ?? "";
const bodyRequestId = (res) => res.json?.requestId ?? res.json?.detail?.requestId;
/** A token as the gateway signs it for a checked key. */
const serviceToken = (claims = {}, opts = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return { "x-apso-service-token": mint({ iss: PLATFORM.APSO_SERVICE_TOKEN_ISSUER, aud: SERVICE_ID, sub: "apikey:key_123", exp: now + 60, ...claims }, { key: gateway.privateKey, alg: "ES256", kid: "gw1", ...opts }) };
};

/** A 401 that explains nothing: the reason is in the service log under the request id. */
function plain401(t, label, res, log) {
  const id = bodyRequestId(res);
  t.assert(`${label}: plain 401 with a request id`, res.status === 401 && message(res) === "Unauthorized" && Boolean(id) && res.requestId === id, `${res.status} ${res.text.slice(0, 200)}`);
  t.assert(`${label}: the log line carries the request id`, Boolean(id) && log().includes(`request=${id}`));
}

/** A service caller: any route, every tenant's rows, its own tenant on create. */
async function serviceCaller(base, t, headers) {
  const org1 = await call("POST", base + ORGS, { headers, body: { name: "Acme" } });
  const org2 = await call("POST", base + ORGS, { headers, body: { name: "Beta" } });
  if (!t.expect("[R13] key caller creates an organization", org1, 200, 201) || !t.expect("[R13] key caller creates a second organization", org2, 200, 201)) return;
  const made = [];
  for (const org of [org1, org2]) {
    const p = await call("POST", base + PROJECTS, { headers, body: { title: `For ${org.json.name}`, organizationId: org.json.id } });
    if (!t.expect("[R13] key caller creates a project for a tenant it names", p, 200, 201)) return;
    t.assert("[R13] the project keeps the tenant the key caller sent", String(p.json?.organizationId) === String(org.json.id), `organizationId=${p.json?.organizationId}`);
    made.push(p.json.id);
  }
  // Earlier cases may have left more rows than the default page holds.
  const list = await call("GET", `${base}${PROJECTS}?limit=100`, { headers });
  t.assert("[R10] key caller lists every tenant's projects", list.status === 200 && made.every((id) => rows(list.json).some((p) => p.id === id)), `${list.status} ${list.text.slice(0, 200)}`);
  t.expect("[R10] key caller reads a project by id", await call("GET", `${base}${PROJECTS}/${made[1]}`, { headers }), 200);
  t.expect("[R13] key caller updates a project", await call("PATCH", `${base}${PROJECTS}/${made[1]}`, { headers, body: { title: "Renamed" } }), 200);
  for (const id of made) t.expect("[R13] key caller deletes a project", await call("DELETE", `${base}${PROJECTS}/${id}`, { headers }), 200, 204);
}

/** A service with no auth block: nothing configured, then each key source. */
async function keyCase(name, boot, project, db) {
  const t = checker(name);
  const everyRoute = async (label, headers, base) => {
    for (const [method, url] of [["GET", ORGS], ["POST", ORGS], ["GET", `${ORGS}/1`], ["PATCH", `${ORGS}/1`], ["DELETE", `${ORGS}/1`], ["GET", PROJECTS]])
      t.expect(`${label}: ${method} ${url}`, await call(method, base + url, { headers, body: method === "GET" || method === "DELETE" ? undefined : { name: "x" } }), 401);
  };

  // Nothing configured.
  let s = await boot();
  t.assert("[R14] start-up line: API keys are off", s.log().includes("[apso] API keys: off"), s.log().slice(-500));
  t.assert("[R0] start-up warning: the service will refuse every request, and the fix", /WARNING: .*refuses every request.*APSO_API_KEY/.test(s.log()));
  t.expect("[R1] /health is public", await call("GET", `${s.base}/health`), 200);
  await everyRoute("[R0] nothing configured, no credential", {}, s.base);
  await everyRoute("[R0] nothing configured, a key is sent", key(KEY), s.base);
  plain401(t, "[R0] no local flag", await call("GET", s.base + ORGS), s.log);
  if (language === "typescript") requestLine(t, "nothing configured: refused by the key guard", await logged(s, "GET", ORGS), 401, ANONYMOUS, "no key source");
  const kept = await call("GET", s.base + ORGS, { headers: { "x-request-id": "req-from-caller-1" } });
  t.assert("[R24] a request id the caller sent is kept and echoed", kept.requestId === "req-from-caller-1" && bodyRequestId(kept) === "req-from-caller-1", `${kept.requestId} ${kept.text.slice(0, 200)}`);

  // The same service on a developer's machine, then with a copied .env on Lambda.
  s = await boot({ APSO_LOCAL: "1" });
  const noSource = await call("GET", s.base + ORGS);
  t.assert("[R0] local: the 401 says no key source is configured and names APSO_API_KEY", noSource.status === 401 && /no API key source/.test(message(noSource)) && message(noSource).includes("APSO_API_KEY") && Boolean(bodyRequestId(noSource)), noSource.text.slice(0, 300));
  s = await boot({ APSO_LOCAL: "1", AWS_LAMBDA_FUNCTION_NAME: "copied-env" });
  plain401(t, "[R0] local flag on Lambda is ignored", await call("GET", s.base + ORGS), s.log);

  // A key in the environment (self-hosted). Two keys, so one can be rotated out.
  // The platform's variables are set too: the first match wins and they are not used.
  s = await boot({ APSO_API_KEY: `${OLD_KEY}, ${KEY}`, APSO_LOCAL: "1", ...PLATFORM });
  t.assert("[R14] start-up line: keys are checked against APSO_API_KEY", s.log().includes("[apso] API keys: checked against APSO_API_KEY (2 set)"), s.log().slice(-500));
  t.assert("[R25] the start-up log does not contain a key", !s.log().includes(KEY) && !s.log().includes(OLD_KEY));
  t.expect("[R1] /health is public", await call("GET", `${s.base}/health`), 200);
  const none = await call("GET", s.base + ORGS);
  t.assert("[R1] local: no credential is a 401 that names the x-api-key header", none.status === 401 && /No credential/.test(message(none)) && message(none).includes("x-api-key"), none.text.slice(0, 300));
  const wrong = await call("GET", s.base + ORGS, { headers: key("sk_smoke_nope") });
  t.assert("[R5] local: a wrong key is a 401 that says the key does not match APSO_API_KEY", wrong.status === 401 && /does not match/.test(message(wrong)) && message(wrong).includes("APSO_API_KEY"), wrong.text.slice(0, 300));
  t.assert("[R25] a refused key is not written to the log or the response", !s.log().includes("sk_smoke_nope") && !wrong.text.includes("sk_smoke_nope"));
  t.expect("[R5] a key that only shares a prefix is refused", await call("GET", s.base + ORGS, { headers: key(KEY.slice(0, -1)) }), 401);
  t.expect("[R5] the whole APSO_API_KEY value is not a key", await call("GET", s.base + ORGS, { headers: key(`${OLD_KEY}, ${KEY}`) }), 401);
  t.expect("[R14] a service token is not tried when APSO_API_KEY is the source", await call("GET", s.base + ORGS, { headers: serviceToken() }), 401);
  t.expect("[R14] the current key is accepted", await call("GET", s.base + ORGS, { headers: key(KEY) }), 200);
  t.expect("[R14] the previous key is accepted until it is removed", await call("GET", s.base + ORGS, { headers: key(OLD_KEY) }), 200);
  await serviceCaller(s.base, t, key(KEY));
  if (language === "typescript") await keyRequestLog(project, db, t, s);
  s = await boot({ APSO_API_KEY: KEY });
  plain401(t, "[R5] wrong key, no local flag", await call("GET", s.base + ORGS, { headers: key("sk_smoke_nope") }), s.log);
  t.expect("[R14] a key removed from APSO_API_KEY is refused after a restart", await call("GET", s.base + ORGS, { headers: key(OLD_KEY) }), 401);
  if (TWO_ADDRESSES) await internalOnly(s.base, t);

  // The platform's gateway token (hosted).
  s = await boot({ ...PLATFORM, APSO_LOCAL: "1" });
  await gateway401s(s, t);
  t.expect("[R0] platform mode, no credential and no sign-in", await call("GET", s.base + ORGS), 401);
  await serviceCaller(s.base, t, serviceToken());
  if (language === "typescript") {
    requestLine(t, "platform mode: a service token caller is a service with the platform's key id", await logged(s, "GET", ORGS, { headers: serviceToken() }), 200, { type: "service", keyId: "key_123" }, undefined);
    requestLine(t, "platform mode: x-api-key with no service token is refused by the key guard", await logged(s, "GET", ORGS, { headers: key(KEY) }), 401, ANONYMOUS, "no valid service token");
  }
  if (TWO_ADDRESSES) await internalSignIn(await boot({ ...PLATFORM, APSO_INTERNAL_AUTH_ISSUER: APSO_ISSUER }), t);
  return t.failures;
}

// ---------- MCP addresses (apsoai/cli#232; rule R29) ----------

const APSO_ISSUER = "https://app.apso.test";
const PRM = "/.well-known/oauth-protected-resource";
const mcpList = (url, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
const mcpClient = async (url, headers) => {
  const client = new Client({ name: "auth-smoke-addresses", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
};
/** The tools a caller lists at an MCP address and whether list_invoices answers; an error when it cannot connect. */
const mcpUse = (url, headers) =>
  mcpClient(url, headers).then(
    async (client) => ({ tools: (await client.listTools()).tools.length, listed: !(await client.callTool({ name: "list_invoices", arguments: {} })).isError }),
    (error) => ({ tools: 0, listed: false, error: String(error) })
  );

/** mcp with no auth block and APSO_API_KEY set: the internal address alone. */
async function internalOnly(base, t) {
  const none = await mcpList(`${base}/mcp/internal`);
  t.assert("[R29] no sign-in: /mcp/internal with no credential is a 401 that names no sign-in", none.status === 401 && !none.headers.get("www-authenticate"), `${none.status} ${none.headers.get("www-authenticate")}`);
  t.assert("[R29] no sign-in: /mcp/internal with a wrong key is a 401", (await mcpList(`${base}/mcp/internal`, key("sk_smoke_nope"))).status === 401);
  const used = await mcpUse(`${base}/mcp/internal`, key(KEY));
  t.assert("[R29] no sign-in: /mcp/internal lists tools and answers a tool call for a key caller", used.tools > 0 && used.listed, JSON.stringify(used));
  for (const [who, headers] of [["no credential", {}], ["a valid key", key(KEY)]])
    t.assert(`[R29] no sign-in: /mcp is not served (${who})`, (await mcpList(`${base}/mcp`, headers)).status === 404);
  for (const form of ["", "/mcp", "/mcp/internal"])
    t.expect(`[R29] no sign-in and no Apso issuer: no sign-in metadata at ${PRM}${form}`, await call("GET", `${base}${PRM}${form}`), 404);
}

/** Platform mode with APSO_INTERNAL_AUTH_ISSUER: the internal address points a client at Apso sign-in. */
async function internalSignIn(s, t) {
  const { base } = s;
  const metadataUrl = `${base}${PRM}/mcp/internal`;
  const none = await mcpList(`${base}/mcp/internal`);
  t.assert("[R29] Apso sign-in: /mcp/internal with no credential is a 401 that names its metadata", none.status === 401 && none.headers.get("www-authenticate") === `Bearer resource_metadata="${metadataUrl}"`, `${none.status} ${none.headers.get("www-authenticate")}`);
  // What the gateway forwards for a token it could not vouch for: the bearer and no service token.
  const stale = await mcpList(`${base}/mcp/internal`, { authorization: "Bearer opaque-apso-token" });
  t.assert("[R29] Apso sign-in: a bearer token with no service token is a 401 invalid_token", stale.status === 401 && (stale.headers.get("www-authenticate") ?? "").includes('error="invalid_token"'), `${stale.status} ${stale.headers.get("www-authenticate")}`);
  const metadata = await call("GET", metadataUrl);
  t.assert(
    "[R29] Apso sign-in: the internal metadata names the Apso issuer and the internal address",
    JSON.stringify(metadata.json) === JSON.stringify({ resource: `${base}/mcp/internal`, authorization_servers: [APSO_ISSUER], bearer_methods_supported: ["header"] }),
    metadata.text
  );
  t.expect("[R29] no sign-in: the root metadata form does not describe the internal address", await call("GET", `${base}${PRM}`), 404);
  for (const [who, sub] of [["an API key", "apikey:key_123"], ["an Apso user", "user:usr_42"]]) {
    const used = await mcpUse(`${base}/mcp/internal`, serviceToken({ sub }));
    t.assert(`[R29] /mcp/internal answers a service token for ${who}`, used.tools > 0 && used.listed, JSON.stringify(used));
  }
  t.expect("[R15,R29] a service token for an Apso user is a service caller on REST too", await call("GET", base + ORGS, { headers: serviceToken({ sub: "user:usr_42" }) }), 200);
  if (language === "typescript") requestLine(t, "platform mode: a service token for an Apso user is a service caller logged by user id", await logged(s, "GET", ORGS, { headers: serviceToken({ sub: "user:usr_42" }) }), 200, { type: "service", userId: "usr_42" }, undefined);
  t.assert("[R16,R29] /mcp/internal refuses a service token whose subject is neither a key nor a user", (await mcpList(`${base}/mcp/internal`, serviceToken({ sub: "user_1" }))).status === 401);
}

/** Sign-in and APSO_API_KEY: each address takes its own credential and no other. */
async function twoAddresses(base, t, member) {
  const refused = await mcpList(`${base}/mcp`, key(KEY));
  t.assert("[R29] /mcp refuses a valid key, with the sign-in challenge", refused.status === 401 && (refused.headers.get("www-authenticate") ?? "").includes(`resource_metadata="${base}${PRM}/mcp"`), `${refused.status} ${refused.headers.get("www-authenticate")}`);
  t.assert("[R29] /mcp/internal refuses a valid user token", (await mcpList(`${base}/mcp/internal`, member)).status === 401);
  // Invoices are for owners. A key sent next to a member's token must not turn the tool call into a key caller's.
  const both = await mcpUse(`${base}/mcp`, { ...member, ...key(KEY) });
  t.assert("[R29] /mcp: a key next to a member's token does not reach the route a tool calls", both.tools > 0 && !both.listed, JSON.stringify(both));
  const external = await call("GET", `${base}${PRM}/mcp`);
  const root = await call("GET", `${base}${PRM}`);
  t.assert("[R29] the external metadata is the same at its path and root forms and names /mcp", external.json?.resource === `${base}/mcp` && external.text === root.text, `${external.text} ${root.text}`);
  t.expect("[R29] no Apso issuer: no sign-in metadata for /mcp/internal", await call("GET", `${base}${PRM}/mcp/internal`), 404);
}

/** Platform mode: only a token the gateway signed for this service is accepted. */
async function gateway401s(s, t) {
  const now = Math.floor(Date.now() / 1000);
  const get = (headers) => call("GET", s.base + ORGS, { headers });
  t.assert("[R14] start-up line: keys are checked by the platform gateway", s.log().includes("[apso] API keys: checked by the platform gateway"), s.log().slice(-500));
  t.expect("[R15] a valid service token is accepted", await get(serviceToken()), 200);
  const bare = await get(key(KEY));
  t.assert("[R14] x-api-key with no service token is a 401 that names the gateway", bare.status === 401 && message(bare).includes("x-apso-service-token"), bare.text.slice(0, 300));
  t.expect("[R16] expired service token", await get(serviceToken({ exp: now - 5 })), 401);
  t.expect("[R16] service token issued for another service", await get(serviceToken({ aud: "svc_other" })), 401);
  t.expect("[R16] service token from another issuer", await get(serviceToken({ iss: "https://evil.example" })), 401);
  t.expect("[R16] service token with no expiry", await get(serviceToken({ exp: undefined, iat: undefined })), 401);
  t.expect("[R16] service token whose subject is not an API key", await get(serviceToken({ sub: "user_1" })), 401);
  const [h, p, sig] = serviceToken()["x-apso-service-token"].split(".");
  const changed = `${h}.${b64url({ ...JSON.parse(Buffer.from(p, "base64url")), aud: SERVICE_ID, sub: "apikey:other" })}.${sig}`;
  t.expect("[R16] service token changed after signing", await get({ "x-apso-service-token": changed }), 401);
  t.expect("[R17] service token signed by a key the gateway does not hold", await get(serviceToken({}, { key: notGateway.privateKey })), 401);
  t.expect("[R17] service token signed with the user sign-in key (RS256)", await get(serviceToken({}, { key: signing.privateKey, alg: "RS256", kid: "k1" })), 401);
  t.expect('[R17] service token with alg "none"', await get(serviceToken({}, { alg: "none" })), 401);
  t.expect("[R17] a garbage service token next to a key", await get({ ...key(KEY), "x-apso-service-token": "not.a.jwt" }), 401);
}

/** APSO_API_KEY set on a service that also has sign-in. */
async function keyNextToSignIn(base, t, user, member) {
  t.expect("[R14] a wrong key is refused even with a valid user token", await call("GET", base + ORGS, { headers: { ...user, ...key("sk_smoke_nope") } }), 401);
  t.expect("[R4] a valid user token with no key still signs in", await call("GET", base + ORGS, { headers: user }), 200);
  t.expect("[R1] no key and no token", await call("GET", base + ORGS), 401);
  await serviceCaller(base, t, key(KEY));

  // Invoices are limited to owners; a key caller has no role and is not limited.
  const INVOICES = route("Invoices");
  const invoice = await call("POST", base + INVOICES, { headers: key(KEY), body: { total: 5, organizationId: 1 } });
  if (t.expect("[R13] key caller creates an invoice", invoice, 200, 201)) {
    t.expect("[R13] key caller lists invoices without a role", await call("GET", base + INVOICES, { headers: key(KEY) }), 200);
    t.expect(`[R13] key caller reads invoices through ${VIA}`, await call("GET", `${base}${ORGS}?${load("invoices")}`, { headers: key(KEY) }), 200);
    t.expect("[R13] key caller deletes an invoice without a role", await call("DELETE", `${base}${INVOICES}/${invoice.json.id}`, { headers: key(KEY) }), 200, 204);
  }

  // The address a key caller uses follows the same rules.
  if (TWO_ADDRESSES) await twoAddresses(base, t, member);
  const rpc = (headers) =>
    fetch(`${base}${INTERNAL}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  t.assert("[R22] mcp with a wrong key is a 401", (await rpc(key("sk_smoke_nope"))).status === 401);
  t.assert("[R14] mcp with a wrong key and a valid user token is a 401", (await rpc({ ...user, ...key("sk_smoke_nope") })).status === 401);
  const client = new Client({ name: "auth-smoke-key", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${INTERNAL}`), { requestInit: { headers: key(KEY) } }));
    t.assert("[R22] mcp lists tools for a key caller", (await client.listTools()).tools.length > 0);
    const listed = await client.callTool({ name: "list_invoices", arguments: {} });
    t.assert("[R23] mcp tool call by a key caller gets the REST answer (no role needed)", !listed.isError, listed.content?.[0]?.text);
  } catch (e) {
    t.assert("[R22] mcp accepts a key caller", false, String(e));
  }
}

/** The platform's gateway token on a service that also has sign-in. */
async function gatewayNextToSignIn(base, t, user) {
  t.expect("[R18] platform mode, no key: a valid user token signs in", await call("GET", base + ORGS, { headers: user }), 200);
  t.expect("[R14] platform mode: x-api-key with no service token is refused even with a valid user token", await call("GET", base + ORGS, { headers: { ...user, ...key(KEY) } }), 401);
  t.expect("[R16] platform mode: a bad service token is refused even with a valid user token", await call("GET", base + ORGS, { headers: { ...user, ...serviceToken({ aud: "svc_other" }) } }), 401);
  t.expect("[R15] platform mode: a valid service token is a service caller", await call("GET", base + PROJECTS, { headers: serviceToken() }), 200);
  t.expect("[R1] platform mode: no credential", await call("GET", base + ORGS), 401);
  if (TWO_ADDRESSES) {
    t.assert("[R29] platform mode: /mcp refuses a valid service token", (await mcpList(`${base}/mcp`, serviceToken())).status === 401);
    const used = await mcpUse(`${base}/mcp/internal`, serviceToken());
    t.assert("[R29] platform mode: /mcp/internal answers a valid service token", used.tools > 0 && used.listed, JSON.stringify(used));
    const [external, internal] = [await call("GET", `${base}${PRM}/mcp`), await call("GET", `${base}${PRM}/mcp/internal`)];
    t.assert(
      "[R29] sign-in and an Apso issuer: each address has its own metadata, with its own issuer",
      external.json?.resource === `${base}/mcp` && external.json.authorization_servers?.length === 1 && !external.json.authorization_servers.includes(APSO_ISSUER) &&
        JSON.stringify(internal.json) === JSON.stringify({ resource: `${base}/mcp/internal`, authorization_servers: [APSO_ISSUER], bearer_methods_supported: ["header"] }),
      `${external.text} ${internal.text}`
    );
  }
}

// ---------- auth entities (rule R28 in apsoai/cli#208) ----------

// Better Auth's tables as its adapter expects them, plus the membership
// entity. Users sign in with Better Auth's JWT (see the Better Auth section
// below); the stored sessions are rows only.
const uuid = { created_at: true, updated_at: true, primaryKeyType: "uuid" };
// Go's generator needs capitalised entity names; the tables are recognised in any case.
const T = Object.fromEntries(["account", "session", "verification"].map((n) => [n, language === "go" ? n[0].toUpperCase() + n.slice(1) : n]));
const SESSION_AUTH = {
  schema: {
    entities: [
      { name: "User", ...uuid, fields: [{ name: "email", type: "text", length: 255, is_email: true }, { name: "name", type: "text", nullable: true }] },
      { name: T.account, ...uuid, fields: [{ name: "providerId", type: "text", length: 50 }, { name: "accountId", type: "text", length: 255 }, { name: "password", type: "text", nullable: true }] },
      { name: T.session, ...uuid, fields: [{ name: "token", type: "text", length: 255, unique: true }, { name: "expiresAt", type: "timestamptz" }] },
      { name: T.verification, ...uuid, fields: [{ name: "identifier", type: "text", length: 255 }, { name: "value", type: "text", length: 255 }, { name: "expiresAt", type: "timestamptz" }] },
      { name: "Organization", ...uuid, fields: [{ name: "name", type: "text" }] },
      { name: "AccountUser", ...uuid, fields: [{ name: "role", type: "text" }] },
      { name: "Project", ...uuid, scopeBy: "organizationId", fields: [{ name: "title", type: "text" }] },
    ],
    relationships: [
      { from: T.account, to: "User", type: "ManyToOne" },
      { from: T.session, to: "User", type: "ManyToOne" },
      { from: "AccountUser", to: "User", type: "ManyToOne" },
      { from: "AccountUser", to: "Organization", type: "ManyToOne" },
      { from: "Organization", to: "Project", type: "OneToMany" },
      { from: "Project", to: "User", type: "ManyToOne" },
    ],
  },
  run: authEntitiesCase,
};

/** [R28] The auth entities answer a service caller only: not a signed-in user, a join or an MCP tool. */
async function authEntitiesCase(name, _p, boot, project) {
  const t = checker(name);
  const server = await boot({ APSO_API_KEY: KEY });
  // Routes are written the TypeScript way below; Python and Go serve them
  // under /api, and Go names the membership route account-users.
  const base = server.base + (language === "typescript" ? "" : "/api");
  const MEMBERSHIPS = language === "go" ? "/account-users" : "/accountusers";
  const expiresAt = new Date(Date.now() + 3600e3).toISOString();
  const seeded = {};
  for (const who of ["ana", "ben"]) {
    const made = {};
    const add = async (label, url, body) => {
      const res = await call("POST", base + url, { headers: key(KEY), body });
      t.expect(`[R28] key caller creates ${label} for ${who}`, res, 200, 201);
      made[url] = res.json?.id;
      return res.json?.id;
    };
    const userId = await add("a user", "/users", { email: `${who}@apso.test`, name: who });
    const organizationId = await add("an organization", "/organizations", { name: `${who} org` });
    await add("a membership", MEMBERSHIPS, { role: "member", userId, organizationId });
    await add("an account", "/accounts", { providerId: "credential", accountId: String(userId), password: `hash-of-${who}`, userId });
    await add("a session", "/sessions", { token: `session-of-${who}`, expiresAt, userId });
    await add("a verification", "/verifications", { identifier: `reset-password:${who}`, value: `reset-of-${who}`, expiresAt });
    await add("a project", "/projects", { title: `${who} project`, organizationId, userId });
    seeded[who] = { ...made, userId, organizationId };
  }
  const issuer = await betterAuthIssuer();
  const anaUser = await issuer.user("ana@apso.test", seeded.ana.organizationId);
  const ana = { authorization: `Bearer ${anaUser.token}` };
  const ben = { authorization: `Bearer ${(await issuer.user("ben@apso.test", seeded.ben.organizationId)).token}` };
  const SECRETS = ["session-of-", "hash-of-", "reset-of-", "@apso.test"];
  const clean = (label, res) => t.assert(label, res.status === 200 && !SECRETS.some((secret) => res.text.includes(secret)), `${res.status} ${res.text.slice(0, 300)}`);

  const own = await call("GET", `${base}/projects`, { headers: ana });
  t.assert("[R6] Better Auth's token signs the user in to its own tenant", own.status === 200 && rows(own.json).length === 1 && rows(own.json)[0].title === "ana project", `${own.status} ${own.text.slice(0, 200)}`);

  const bodies = {
    "/users": { email: "eve@apso.test" },
    "/accounts": { providerId: "credential", accountId: "x", password: "chosen", userId: seeded.ben.userId },
    "/sessions": { token: "forged", expiresAt, userId: seeded.ben.userId },
    "/verifications": { identifier: "reset-password:ben", value: "known", expiresAt },
    [MEMBERSHIPS]: { role: "owner", userId: seeded.ana.userId, organizationId: seeded.ben.organizationId },
  };
  for (const [url, body] of Object.entries(bodies)) {
    const theirs = `${base}${url}/${seeded.ben[url]}`;
    const mine = `${base}${url}/${seeded.ana[url]}`;
    t.expect(`[R28] user cannot list ${url}`, await call("GET", base + url, { headers: ana }), 403);
    t.expect(`[R28] user cannot read another user's row in ${url}`, await call("GET", theirs, { headers: ana }), 403);
    t.expect(`[R28] user cannot read its own row in ${url}`, await call("GET", mine, { headers: ana }), 403);
    t.expect(`[R28] user cannot create in ${url}`, await call("POST", base + url, { headers: ana, body }), 403);
    // Go services have no bulk route.
    if (language !== "go") t.expect(`[R28] user cannot create in bulk in ${url}`, await call("POST", `${base}${url}/bulk`, { headers: ana, body: language === "python" ? [body] : { bulk: [body] } }), 403);
    t.expect(`[R28] user cannot update its own row in ${url}`, await call("PATCH", mine, { headers: ana, body }), 403);
    t.expect(`[R28] user cannot replace another user's row in ${url}`, await call("PUT", theirs, { headers: ana, body }), 403);
    t.expect(`[R28] user cannot delete another user's row in ${url}`, await call("DELETE", theirs, { headers: ana }), 403);
    t.expect(`[R28] no credential on ${url}`, await call("GET", base + url), 401);
  }
  if (language === "typescript") requestLine(t, "a signed-in user on an auth entity's route is refused by the key guard", await logged(server, "GET", "/users", { headers: ana }), 403, { type: "user", userId: anaUser.id, tenantId: String(seeded.ana.organizationId) }, "auth entity, service callers only");
  t.expect("[R28] a refused request changed nothing: the other user still signs in", await call("GET", `${base}/projects`, { headers: ben }), 200);
  const still = await call("GET", `${base}/projects`, { headers: ana });
  t.assert("[R28] a refused request changed nothing: the user is still in its own tenant", rows(still.json).length === 1 && rows(still.json)[0].title === "ana project", still.text.slice(0, 200));

  // No route of another entity loads an auth entity, in either query dialect.
  // (Python answers 500 to a select that names columns next to an embed, with
  // or without auth entities, so its embed case selects every column.)
  const postgrest = { ...ana, "x-crud-dialect": "postgrest" };
  // A TypeScript service refuses an embed of a relation that is not embeddable; Python and Go leave it out of the answer.
  const embed = (label, res) =>
    NESTJSX ? clean(label, res) : t.assert(label, res.status === 400 && res.text.includes("cannot be embedded here") && !SECRETS.some((secret) => res.text.includes(secret)), `${res.status} ${res.text.slice(0, 300)}`);
  if (NESTJSX) {
    clean("[R28] user: ?join=user on projects loads no user row", await call("GET", `${base}/projects?join=user`, { headers: ana }));
    clean("[R28] user: nested joins through user load no account or session", await call("GET", `${base}/projects?join=user&join=user.accounts&join=user.sessions`, { headers: ana }));
    clean("[R28] user: nested joins from organizations load no membership, user or account", await call("GET", `${base}/organizations?join=accountUsers&join=accountUsers.user&join=accountUsers.user.accounts`, { headers: ana }));
  }
  embed("[R28] user: a select embed from organizations loads no membership, user, account or session", await call("GET", `${base}/organizations?select=${language === "python" ? "*" : "name"},accountUsers(role,user(email,accounts(password),sessions(token)))`, { headers: postgrest }));
  embed("[R28] user: a select embed from projects loads no user", await call("GET", `${base}/projects?select=${language === "python" ? "*" : "title"},user(email,accounts(password))`, { headers: postgrest }));
  // Organization has no tenant scope and Project has one, so the relation rule
  // refuses the load before either entity's rows are read.
  if (NESTJSX) t.expect("[R7,R28] user: a join from organizations through projects to a user is refused", await call("GET", `${base}/organizations?join=projects&join=projects.user&join=projects.user.accounts`, { headers: ana }), 403);
  t.expect("[R7,R28] user: a select embed from organizations through projects to a user is refused", await call("GET", `${base}/organizations?select=*,projects(*,user(*))`, { headers: postgrest }), 403);
  // Either the filter is refused or matches nothing, or it is ignored: then the
  // answer is the same whether or not a user has that email.
  const byEmail = (email) => call("GET", `${base}/projects?${NESTJSX ? `join=user&filter=user.email||$eq||${email}` : `select=*,user!inner(*)&user.email=eq.${email}`}`, { headers: ana });
  const [oracle, control] = [await byEmail("ana@apso.test"), await byEmail("nobody@apso.test")];
  t.assert("[R28] user: a filter on an auth entity's column through a relation tells nothing", oracle.status !== 200 || rows(oracle.json).length === 0 || oracle.text === control.text, `${oracle.status} ${oracle.text.slice(0, 200)}`);

  // The service caller (the Better Auth adapter on the app's server) is not limited.
  for (const url of Object.keys(bodies)) {
    const list = await call("GET", `${base}${url}?limit=100`, { headers: key(KEY) });
    t.assert(`[R28] key caller lists ${url}`, list.status === 200 && rows(list.json).length === 2, `${list.status} ${list.text.slice(0, 200)}`);
  }
  const joined = await call("GET", `${base}/sessions?${load("user")}&limit=100`, { headers: key(KEY) });
  t.assert("[R28] key caller joins one auth entity to another", joined.status === 200 && rows(joined.json).every((row) => row.user?.email), `${joined.status} ${joined.text.slice(0, 200)}`);
  t.expect("[R28] key caller updates an account", await call("PATCH", `${base}/accounts/${seeded.ben["/accounts"]}`, { headers: key(KEY), body: { password: "hash-of-ben-2" } }), 200);
  t.expect("[R28] key caller deletes a session", await call("DELETE", `${base}/sessions/${seeded.ben["/sessions"]}`, { headers: key(KEY) }), 200, 204);
  t.expect("[R1] a stored session's token is not a credential", await call("GET", `${base}/projects`, { headers: { authorization: "Bearer session-of-ana" } }), 401);

  // MCP: generate refuses to make an auth entity's routes tools. Last, because
  // it leaves the project half generated; the next case generates it again.
  for (const entity of ["User", T.account, T.session, T.verification, "AccountUser"]) {
    const rcPath = path.join(project, ".apsorc");
    const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
    fs.writeFileSync(rcPath, JSON.stringify({ ...rc, entities: rc.entities.map((e) => (e.name === entity ? { ...e, mcp: ["read"] } : e)) }, null, 2));
    const out = spawnSync(CLI, ["generate", "--language", language], { cwd: project, encoding: "utf8" });
    fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2));
    t.assert(`[R28] generate refuses mcp on ${entity}`, out.status !== 0 && /auth entity/.test(out.stdout + out.stderr), `exit ${out.status} ${(out.stdout + out.stderr).slice(-300)}`);
  }
  return t.failures;
}

// ---------- main ----------

const jwks = http.createServer((req, res) => {
  if (req.url === "/platform/jwks.json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(GATEWAY_JWKS));
  } else if (req.url.endsWith("/.well-known/jwks.json") || req.url.endsWith("/api/auth/jwks")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(JWKS));
  } else {
    res.writeHead(404).end();
  }
});
const jwksPort = await freePort();
await new Promise((r) => jwks.listen(jwksPort, "127.0.0.1", r));
PLATFORM = {
  APSO_SERVICE_TOKEN_JWKS_URL: `http://127.0.0.1:${jwksPort}/platform/jwks.json`,
  APSO_SERVICE_TOKEN_ISSUER: "https://gateway.apso.test",
  APSO_SERVICE_ID: SERVICE_ID,
};
// "no-auth" is a service generated with no auth block at all.
const cases = { "no-auth": {}, ...providers(`http://127.0.0.1:${jwksPort}`) };

// ---------- two issuers (apsoai/cli#206; rule R3) ----------
// A service that trusts two issuers: staff (generic "jwt") and customers
// ("auth0"). Each has its own key, audience and claim names. The customer
// realm publishes its key at its own JWKS URL under the same kid as the staff
// key, so the only way to the right key is through the token's issuer.
{
  const customerKey = keyPair();
  const customerJwks = http
    .createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [{ ...customerKey.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] }));
    })
    .unref();
  await new Promise((r) => customerJwks.listen(0, "127.0.0.1", r));
  const STAFF = `http://127.0.0.1:${jwksPort}/staff`;
  const CUSTOMERS = `http://127.0.0.1:${customerJwks.address().port}/`;
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  // Staff tokens: tenant in "org", roles in "roles", permissions in "permissions".
  const staffClaims = (org, extra = {}) => ({ iss: STAFF, aud: "staff-api", sub: "staff_1", org, roles: ["member"], ...extra });
  // Customer tokens: tenant in "tenant.id", roles in "groups", permissions in "perms".
  const customerClaims = (tenant, extra = {}) => ({ iss: CUSTOMERS, aud: "customer-api", sub: "auth0|cust_1", tenant: tenant === undefined ? undefined : { id: tenant }, groups: ["member"], ...extra });
  const staff = (org, extra) => bearer(mint(staffClaims(org, extra)));
  const customer = (tenant, extra) => bearer(mint(customerClaims(tenant, extra), { key: customerKey.privateKey }));

  cases["two-issuers"] = {
    auth: [
      { provider: "jwt", jwt: { issuer: STAFF, audience: "staff-api" }, claims: { workspaceId: "org" } },
      { provider: "auth0", jwt: { issuer: CUSTOMERS, audience: "customer-api", jwksUri: `${CUSTOMERS}jwks` }, claims: { workspaceId: "tenant.id", roles: "groups", permissions: "perms" } },
    ],
    run: async (name, _p, boot) => {
      const t = checker(name);
      const { base } = await boot();
      const get = (headers, url = ORGS) => call("GET", base + url, { headers });

      t.expect("[R3] a token from the first issuer is accepted", await get(staff("1")), 200);
      t.expect("[R3] a token from the second issuer is accepted", await get(customer("1")), 200);
      t.expect("[R3] an issuer that is not listed is refused (signed with the first issuer's key)", await get(bearer(mint(staffClaims("1", { iss: "https://evil.example/" })))), 401);
      t.expect("[R3] an issuer that is not listed is refused (signed with the second issuer's key)", await get(bearer(mint(customerClaims("1", { iss: "https://evil.example/" }), { key: customerKey.privateKey }))), 401);
      t.expect("[R3] a token with no issuer is refused", await get(staff("1", { iss: undefined })), 401);
      t.expect("[R3] the second issuer's name without its trailing slash is another issuer", await get(customer("1", { iss: CUSTOMERS.slice(0, -1) })), 401);
      t.expect("[R3] a first-issuer token with the second issuer's audience is refused", await get(staff("1", { aud: "customer-api" })), 401);
      t.expect("[R3] a second-issuer token with the first issuer's audience is refused", await get(customer("1", { aud: "staff-api" })), 401);
      t.expect("[R3] signed by the first issuer's key but claiming the second issuer is refused", await get(bearer(mint(customerClaims("1")))), 401);
      t.expect("[R3] signed by the second issuer's key but claiming the first issuer is refused", await get(bearer(mint(staffClaims("1"), { key: customerKey.privateKey }))), 401);

      // Each issuer's own claim names end up as the one tenant the scope uses.
      const org1 = await call("POST", base + ORGS, { headers: staff("1"), body: { name: "Acme" } });
      const org2 = await call("POST", base + ORGS, { headers: customer("1"), body: { name: "Beta" } });
      if (!t.expect("[R3] create organization (first issuer)", org1, 200, 201) || !t.expect("[R3] create organization (second issuer)", org2, 200, 201)) return t.failures;
      const [id1, id2] = [String(org1.json.id), String(org2.json.id)];
      const project = await call("POST", base + PROJECTS, { headers: staff(id1), body: { title: "Staff made", organizationId: Number(id2) } });
      if (!t.expect("[R6] first issuer's user creates a project", project, 200, 201)) return t.failures;
      const pid = project.json.id;
      const has = (res, id) => res.status === 200 && rows(res.json).some((row) => row.id === id);
      const lacks = (res, id) => res.status === 200 && !rows(res.json).some((row) => row.id === id);
      t.assert("[R8] the project is stored under the tenant in the first issuer's claim (org)", String(project.json?.organizationId) === id1, `organizationId=${project.json?.organizationId}`);
      t.assert("[R6] second issuer's user of the same tenant (tenant.id) lists the project", has(await get(customer(id1), PROJECTS), pid));
      t.assert("[R6] second issuer's user of another tenant does not list it", lacks(await get(customer(id2), PROJECTS), pid));
      t.expect("[R6] second issuer's user of another tenant cannot read it", await get(customer(id2), `${PROJECTS}/${pid}`), 403, 404);
      const theirs = await call("POST", base + PROJECTS, { headers: customer(id2), body: { title: "Customer made", organizationId: Number(id1) } });
      if (t.expect("[R6] second issuer's user creates a project", theirs, 200, 201)) {
        t.assert("[R8] it is stored under the tenant in the second issuer's claim (tenant.id)", String(theirs.json?.organizationId) === id2, `organizationId=${theirs.json?.organizationId}`);
        t.assert("[R6] first issuer's user of another tenant does not list it", lacks(await get(staff(id1), PROJECTS), theirs.json.id));
      }
      t.expect("[R9] a second-issuer token that names its tenant the first issuer's way (org) has no tenant", await get(customer(undefined, { org: id1 }), PROJECTS), 403);
      t.expect("[R9] a first-issuer token that names its tenant the second issuer's way (tenant.id) has no tenant", await get(staff(undefined, { tenant: { id: id1 } }), PROJECTS), 403);

      // Roles come from each issuer's own claim too: "support" skips the scope on tickets.
      const TICKETS = route("Tickets");
      const ticket = await call("POST", base + TICKETS, { headers: staff(id1), body: { title: "Login broken" } });
      if (t.expect("[R10] create ticket", ticket, 200, 201)) {
        const tid = ticket.json.id;
        t.assert("[R10] support role in the first issuer's claim (roles) lists another tenant's ticket", has(await get(staff(id2, { roles: ["support"] }), TICKETS), tid));
        t.assert("[R10] support role in the second issuer's claim (groups) lists another tenant's ticket", has(await get(customer(id2, { groups: ["support"] }), TICKETS), tid));
        t.assert("[R10] a second-issuer token with the role under the first issuer's claim name is not support", lacks(await get(customer(id2, { roles: ["support"] }), TICKETS), tid));
      }

      // Permissions: Invoice read is for owners, or a permission in the token.
      const INVOICES = route("Invoices");
      t.expect("[R11] owner role in the second issuer's claim (groups) lists invoices", await get(customer(id2, { groups: ["owner"] }), INVOICES), 200);
      t.expect("[R11] a second-issuer token with owner under the first issuer's claim name is refused", await get(customer(id2, { roles: ["owner"] }), INVOICES), 403);
      t.expect("[R11] invoice:read in the second issuer's permissions claim (perms) lists invoices", await get(customer(id2, { perms: ["invoice:read"] }), INVOICES), 200);
      t.expect("[R11] a second-issuer token with invoice:read under the first issuer's claim name is refused", await get(customer(id2, { permissions: ["invoice:read"] }), INVOICES), 403);
      t.expect("[R11] invoice:read in the first issuer's permissions claim (permissions) lists invoices", await get(staff(id1, { permissions: ["invoice:read"] }), INVOICES), 200);

      // MCP sign-in discovery names both issuers, and a token from either works.
      const rpc = (headers = {}) =>
        fetch(`${base}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
      const metadataUrl = /resource_metadata="([^"]+)"/.exec((await rpc()).headers.get("www-authenticate") ?? "")?.[1];
      const metadata = metadataUrl ? await call("GET", metadataUrl) : { json: undefined, text: "no metadata URL in the 401" };
      t.assert("[R22] mcp sign-in metadata lists every issuer as an authorization server", JSON.stringify(metadata.json?.authorization_servers) === JSON.stringify([STAFF, CUSTOMERS]), metadata.text);
      for (const [who, claims, opts] of [["first", staffClaims(id1, { aud: `${base}/mcp` }), {}], ["second", customerClaims(id2, { aud: `${base}/mcp` }), { key: customerKey.privateKey }]]) {
        const client = new Client({ name: "auth-smoke-two-issuers", version: "1" });
        const tools = await client
          .connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: bearer(mint(claims, opts)) } }))
          .then(() => client.listTools())
          .then((r) => r.tools.length, () => 0);
        t.assert(`[R22] mcp accepts a token the ${who} issuer issued for the MCP endpoint`, tools > 0);
      }
      t.assert("[R22] mcp refuses a token from an issuer that is not listed", (await rpc(bearer(mint(staffClaims(id1, { iss: "https://evil.example/", aud: `${base}/mcp` }))))).status === 401);
      return t.failures;
    },
  };
}

// ---------- Better Auth (apsoai/cli#204) ----------
// The better-auth provider verifies the JWTs a Better Auth server issues. The
// tokens here come from a real one (scripts/better-auth-issuer.mjs, with
// better-auth installed into the work folder): users sign up, get an active
// organization and fetch the JWT plugin's token over HTTP, and an MCP client's
// access token comes from the OAuth provider's authorization code flow. Only
// the tokens Better Auth will not issue (expired, another issuer or audience,
// an access token without azp) are signed here, with that server's own key.
const BETTER_AUTH_VERSION = "1.7.21";
const BETTER_AUTH_ORIGIN = `http://127.0.0.1:${await freePort()}`;
const BETTER_AUTH = { provider: "better-auth", url: `${BETTER_AUTH_ORIGIN}/api/auth` };
// Fixed, so the Better Auth server can register it before the service has a port.
const MCP_RESOURCE = "https://api.smoke.test/mcp";
const OTHER_RESOURCE = "https://other.smoke.test/mcp";
// A resource every language's service accepts: the provider's default audience.
const API_RESOURCE = BETTER_AUTH_ORIGIN;
let betterAuthServer;

/** Start the Better Auth server once per run; returns what the cases need from it. */
async function betterAuthIssuer() {
  const api = BETTER_AUTH.url;
  const json = { "content-type": "application/json", origin: BETTER_AUTH_ORIGIN };
  const post = async (url, body, headers = {}) => {
    const res = await fetch(url, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Better Auth: POST ${url} answered ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  };
  if (!betterAuthServer) {
    const dir = path.join(work, "better-auth");
    // With AUTH_SMOKE_PROJECT the work folder is reused, and Better Auth is already installed in it.
    const installed = fs.existsSync(path.join(dir, "node_modules"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }));
    fs.copyFileSync(path.join(path.dirname(CLI), "..", "scripts", "better-auth-issuer.mjs"), path.join(dir, "issuer.mjs"));
    if (!installed) sh("npm", ["install", "--no-audit", "--no-fund", `better-auth@${BETTER_AUTH_VERSION}`, `@better-auth/oauth-provider@${BETTER_AUTH_VERSION}`], { cwd: dir });
    betterAuthServer = spawn(process.execPath, ["issuer.mjs"], {
      cwd: dir,
      env: { ...process.env, PORT: new URL(BETTER_AUTH_ORIGIN).port, RESOURCES: `${MCP_RESOURCE},${OTHER_RESOURCE},${API_RESOURCE}` },
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise((resolve, reject) => {
      betterAuthServer.stdout.once("data", resolve);
      betterAuthServer.once("exit", (code) => reject(new Error(`the Better Auth server exited with ${code}`)));
    });
  }
  const member = (userId, org, role = "member") => post(`${BETTER_AUTH_ORIGIN}/smoke/member`, { userId, organizationId: String(org), role });
  const removeMember = (userId, org) => post(`${BETTER_AUTH_ORIGIN}/smoke/remove-member`, { userId, organizationId: String(org) });
  /** organization.setActive as the user; answers the status (403 for an organization they are not in). */
  const setActive = async (cookie, org) =>
    (await fetch(`${api}/organization/set-active`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ organizationId: String(org) }) })).status;
  /** Sign a user up; with `org`, make them a member of it and (unless `active` is false) set it active. */
  const user = async (name, org, role = "member", active = true) => {
    const email = `${crypto.randomUUID()}-${name}`;
    const signUp = await post(`${api}/sign-up/email`, { email, password: "smoke-password-1", name: email.split("@")[0] });
    const cookie = signUp.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const { token: sessionToken, user: row } = await signUp.json();
    if (org !== undefined) {
      await member(row.id, org, role);
      if (active) await post(`${api}/organization/set-active`, { organizationId: String(org) }, { cookie });
    }
    // What the app's front end does: GET /api/auth/token with the session.
    const res = await fetch(`${api}/token`, { headers: { cookie } });
    return { id: row.id, cookie, sessionToken, token: (await res.json()).token };
  };
  const redirect_uri = "https://client.smoke.test/callback";
  const tokenEndpoint = async (params) =>
    (await fetch(`${api}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) })).json();
  /**
   * An OAuth client's grant for `resource` as the signed-in user: authorization
   * code with PKCE, no browser. Better Auth answers each step with the next
   * URL: its organization page (answered with `choose`: an organization to set
   * active, or null to continue without choosing), its consent page (`consent`:
   * extra fields to submit with the acceptance), or the client's callback with
   * the code. `extra` adds parameters to the authorization request. Returns the
   * pages passed in `steps`, and the tokens when a code was issued.
   */
  const grant = async (cookie, resource, { extra = {}, choose, consent } = {}) => {
    const client = await (await post(`${BETTER_AUTH_ORIGIN}/smoke/client`, { cookie, resources: [resource], skip_consent: !consent })).json();
    const verifier = crypto.randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri,
      scope: "openid offline_access",
      state: "smoke",
      code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource,
      ...extra,
    });
    // A browser gets a 302; a fetch client gets the same URL in a JSON body.
    const next = async (res) => res.headers.get("location") ?? (await res.json().catch(() => ({}))).url ?? "";
    const signedQuery = (location) => location.slice(location.indexOf("?") + 1);
    const steps = [];
    let location = await next(await fetch(`${api}/oauth2/authorize?${query}`, { headers: { cookie }, redirect: "manual" }));
    if (location.startsWith("/select-organization")) {
      steps.push("select-organization");
      if (choose === undefined) return { steps };
      if (choose !== null) await post(`${api}/organization/set-active`, { organizationId: String(choose) }, { cookie });
      location = await next(await post(`${api}/oauth2/continue`, { postLogin: true, oauth_query: signedQuery(location) }, { cookie }));
      if (location.startsWith("/select-organization")) return { steps: [...steps, "select-organization"] };
    }
    if (location.startsWith("/consent")) {
      steps.push("consent");
      location = await next(await post(`${api}/oauth2/consent`, { accept: true, oauth_query: signedQuery(location), ...consent }, { cookie }));
    }
    const code = new URL(location, BETTER_AUTH_ORIGIN).searchParams.get("code");
    if (!code) throw new Error(`Better Auth: no authorization code: ${location}`);
    const tokens = await tokenEndpoint({ grant_type: "authorization_code", code, redirect_uri, client_id: client.client_id, code_verifier: verifier, resource });
    if (!tokens.access_token) throw new Error(`Better Auth: no access token: ${JSON.stringify(tokens).slice(0, 300)}`);
    return { steps, client_id: client.client_id, resource, ...tokens };
  };
  /** A new access token from the grant's refresh token. */
  const refresh = async (g) => {
    const tokens = await tokenEndpoint({ grant_type: "refresh_token", refresh_token: g.refresh_token, client_id: g.client_id, resource: g.resource });
    if (!tokens.access_token) throw new Error(`Better Auth: refresh failed: ${JSON.stringify(tokens).slice(0, 300)}`);
    g.refresh_token = tokens.refresh_token ?? g.refresh_token;
    return tokens.access_token;
  };
  const accessToken = async (cookie, resource) => (await grant(cookie, resource)).access_token;
  /** POST /oauth2/consent with the signed query changed; answers the status. */
  const consentWithAlteredQuery = async (cookie, resource) => {
    const client = await (await post(`${BETTER_AUTH_ORIGIN}/smoke/client`, { cookie, resources: [resource], skip_consent: false })).json();
    const query = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri, scope: "openid", state: "smoke", code_challenge: "x".repeat(43), code_challenge_method: "S256", resource });
    const res = await fetch(`${api}/oauth2/authorize?${query}`, { headers: { cookie }, redirect: "manual" });
    const location = res.headers.get("location") ?? (await res.json().catch(() => ({}))).url ?? "";
    const altered = location.slice(location.indexOf("?") + 1).replace("state=smoke", "state=smoke&reference_id=3");
    return (await fetch(`${api}/oauth2/consent`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ accept: true, oauth_query: altered }) })).status;
  };
  /** Any payload, signed with the Better Auth server's own key. */
  const sign = async (payload, header) => (await (await post(`${BETTER_AUTH_ORIGIN}/smoke/sign`, { payload, header })).json()).token;
  return { user, member, removeMember, setActive, grant, refresh, accessToken, consentWithAlteredQuery, sign };
}

const decode = (token) => token.split(".").slice(0, 2).map((part) => JSON.parse(Buffer.from(part, "base64url")));

/**
 * The tenant in an OAuth access token. The Better Auth server binds the user's
 * organization to the grant (postLogin.consentReferenceId) and writes it, with
 * that membership's roles, into every access token after reading the
 * membership again (customAccessTokenClaims). The tokens are for a resource
 * every language's service accepts, so the service's scope is checked too.
 */
async function accessTokenTenant(base, t, issuer, asOrg1) {
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const tenant = (token) => decode(token)[1].activeOrganizationId;
  const roles = (token) => JSON.stringify(decode(token)[1].roles);
  // Organization 3 exists and mia is not in it.
  await issuer.user("zed@apso.test", "3", "owner");
  // mia: owner in organization 1, member in organization 2, none active.
  const mia = await issuer.user("mia@apso.test", "1", "owner", false);
  await issuer.member(mia.id, "2", "member");

  const undecided = await issuer.grant(mia.cookie, API_RESOURCE);
  t.assert("[R6] access token: a user with several organizations is sent to choose one, and no code is issued", JSON.stringify(undecided.steps) === '["select-organization"]' && !undecided.access_token, JSON.stringify(undecided.steps));
  const skipped = await issuer.grant(mia.cookie, API_RESOURCE, { choose: null });
  t.assert("[R6] access token: continuing without choosing issues no code", !skipped.access_token && skipped.steps.length === 2, JSON.stringify(skipped.steps));
  t.assert("[R6] access token: the user cannot choose an organization they are not a member of", (await issuer.setActive(mia.cookie, "3")) === 403);

  const chosen = await issuer.grant(mia.cookie, API_RESOURCE, { choose: "2" });
  t.assert("[R6] access token: carries the chosen organization as the tenant", tenant(chosen.access_token) === "2", JSON.stringify(decode(chosen.access_token)[1]));
  t.assert("[R6] access token: roles are that organization's membership, not another's", roles(chosen.access_token) === '["member"]', roles(chosen.access_token));

  // The service scopes by it exactly as for the front end's token.
  const theirs = await call("POST", base + PROJECTS, { headers: asOrg1, body: { title: "Org 1 only" } });
  const mine = await call("POST", base + PROJECTS, { headers: bearer(chosen.access_token), body: { title: "From an OAuth client", organizationId: 1 } });
  if (t.expect("[R6] access token: creates a project", mine, 200, 201) && t.expect("[R6] front end token: creates a project in organization 1", theirs, 200, 201)) {
    t.assert("[R8] access token: the project is stored under the token's tenant, whatever the body says", String(mine.json?.organizationId) === "2", `organizationId=${mine.json?.organizationId}`);
    const list = await call("GET", base + PROJECTS, { headers: bearer(chosen.access_token) });
    const ids = rows(list.json).map((row) => row.id);
    t.assert("[R6] access token: lists its tenant's rows and not another tenant's", list.status === 200 && ids.includes(mine.json.id) && !ids.includes(theirs.json.id), list.text.slice(0, 200));
    t.expect("[R6] access token: cannot read another tenant's row", await call("GET", `${base}${PROJECTS}/${theirs.json.id}`, { headers: bearer(chosen.access_token) }), 403, 404);
  }

  // The client cannot name the organization: not in the authorization request, not in the consent submission.
  const named = { reference_id: "3", referenceId: "3", organizationId: "3", organization_id: "3", activeOrganizationId: "3", consent_reference_id: "3" };
  const tampered = await issuer.grant(mia.cookie, API_RESOURCE, { extra: named, choose: "2" });
  t.assert("[R6] access token: organization parameters added to the authorization request are ignored", tenant(tampered.access_token) === "2", String(tenant(tampered.access_token)));
  const consented = await issuer.grant(mia.cookie, API_RESOURCE, { choose: "2", consent: named });
  t.assert("[R6] access token: organization fields added to the consent submission are ignored", consented.steps.includes("consent") && tenant(consented.access_token) === "2", `${consented.steps} ${tenant(consented.access_token)}`);
  t.assert("[R6] access token: a consent submission with the signed request changed is refused", (await issuer.consentWithAlteredQuery(mia.cookie, API_RESOURCE)) === 400);

  // Refresh keeps the organization while the user is a member, and loses it when they are removed.
  const refreshed = await issuer.refresh(chosen);
  t.assert("[R6] access token: a refreshed token carries the same tenant and roles", tenant(refreshed) === "2" && roles(refreshed) === '["member"]', JSON.stringify(decode(refreshed)[1]));
  await issuer.removeMember(mia.id, "2");
  const after = await issuer.refresh(chosen);
  t.assert("[R9] access token: after the user is removed from the organization, a refreshed token has no tenant and no roles", !("activeOrganizationId" in decode(after)[1]) && !("roles" in decode(after)[1]), JSON.stringify(decode(after)[1]));
  t.expect("[R9] access token: with no tenant claim the service answers the no-tenant 403", await call("GET", base + PROJECTS, { headers: bearer(after) }), 403);
  // Her session still names organization 2 as active; a new grant does not get it.
  const stale = await issuer.grant(mia.cookie, API_RESOURCE);
  t.assert("[R6] access token: a new grant after removal falls back to the one organization left, not the removed one", tenant(stale.access_token) === "1" && roles(stale.access_token) === '["owner"]', JSON.stringify(decode(stale.access_token)[1]));

  // One membership and nothing chosen: that organization. No membership: no tenant.
  const uno = await issuer.user("uno@apso.test", "2", "member", false);
  const only = await issuer.grant(uno.cookie, API_RESOURCE);
  t.assert("[R6] access token: a user with exactly one organization gets it without choosing", only.steps.length === 0 && tenant(only.access_token) === "2", `${only.steps} ${tenant(only.access_token)}`);
  const nobody = await issuer.user("ora@apso.test");
  const none = await issuer.grant(nobody.cookie, API_RESOURCE);
  t.assert("[R9] access token: a user with no organization gets a token with no tenant claim", !("activeOrganizationId" in decode(none.access_token)[1]));
  t.expect("[R9] access token: and the service answers the no-tenant 403", await call("GET", base + PROJECTS, { headers: bearer(none.access_token) }), 403);
}

cases["better-auth"] = {
  auth: BETTER_AUTH,
  run: async (name, _p, boot) => {
    const t = checker(name);
    const issuer = await betterAuthIssuer();
    const { base } = await boot({ MCP_RESOURCE_URL: MCP_RESOURCE });
    const bearer = (token) => ({ authorization: `Bearer ${token}` });
    const get = (headers, url = ORGS) => call("GET", base + url, { headers });
    // The fresh database numbers the two organizations the checks create 1 and 2.
    const users = {
      1: await issuer.user("ana@apso.test", "1", "owner"),
      2: await issuer.user("ben@apso.test", "2"),
      none: await issuer.user("nat@apso.test"),
      support: await issuer.user("sam@apso.test", "2", "support"),
    };
    const ana = users[1];
    const [header, claims] = decode(ana.token);
    t.assert(
      "[R2] Better Auth's JWT plugin token: EdDSA, iss and aud are its origin, tenant and roles under the default claim names",
      header.alg === "EdDSA" && claims.iss === BETTER_AUTH_ORIGIN && claims.aud === BETTER_AUTH_ORIGIN && claims.sub === ana.id && claims.activeOrganizationId === "1" && JSON.stringify(claims.roles) === '["owner"]',
      JSON.stringify({ header, claims })
    );
    t.assert("[R9] a user with no active organization gets a token with no tenant claim", !("activeOrganizationId" in decode(users.none.token)[1]));

    t.expect("[R2] the JWT plugin's token is accepted", await get(bearer(ana.token)), 200);
    t.expect("[R1] a session cookie is refused", await get({ cookie: ana.cookie }), 401);
    t.expect("[R1] a session token as the bearer token is refused", await get(bearer(ana.sessionToken)), 401);
    t.expect("[R1] the signed session cookie value as the bearer token is refused", await get(bearer(decodeURIComponent(ana.cookie.split("=")[1]))), 401);
    const now = Math.floor(Date.now() / 1000);
    t.expect("[R2] expired (signed with Better Auth's key)", await get(bearer(await issuer.sign({ ...claims, iat: now - 1000, exp: now - 60 }))), 401);
    t.expect("[R2] wrong issuer (signed with Better Auth's key)", await get(bearer(await issuer.sign({ ...claims, exp: now + 600, iss: "https://evil.example" }))), 401);
    t.expect("[R2] wrong audience (signed with Better Auth's key)", await get(bearer(await issuer.sign({ ...claims, exp: now + 600, aud: "https://other.example" }))), 401);
    t.expect("[R2] Better Auth's claims and key id, signed by another key", await get(bearer(mint({ ...claims, exp: now + 600 }, { alg: "EdDSA", key: edImpostor.privateKey, kid: header.kid }))), 401);
    t.expect("[R2] the same payload re-signed with Better Auth's key is accepted, so the refusals above are for their reason", await get(bearer(await issuer.sign({ ...claims, exp: now + 600 }))), 200);

    // Tenant scope from the activeOrganizationId claim; no claim is a 403.
    const as = (org) => bearer(users[org ?? "none"].token);
    await crudAndScope(base, t, as, as, bearer(users.none.token), () => bearer(users.support.token));

    // OAuth access tokens (at+jwt), as an MCP client gets them.
    const forMcp = await issuer.accessToken(ana.cookie, MCP_RESOURCE);
    const [atHeader, atClaims] = decode(forMcp);
    t.assert(
      "[R2] Better Auth's OAuth access token: at+jwt, iss is the base URL, aud holds the resource, azp and the tenant are set",
      atHeader.typ === "at+jwt" && atClaims.iss === BETTER_AUTH.url && [atClaims.aud].flat().includes(MCP_RESOURCE) && typeof atClaims.azp === "string" && atClaims.sub === ana.id && atClaims.activeOrganizationId === "1",
      JSON.stringify({ atHeader, atClaims })
    );
    await accessTokenTenant(base, t, issuer, bearer(ana.token));

    t.expect("[R2] an access token issued for the MCP URL is accepted", await get(bearer(forMcp)), 200);
    const mine = await call("POST", base + PROJECTS, { headers: bearer(forMcp), body: { title: "From an MCP client", organizationId: 2 } });
    t.assert("[R8] it is scoped to the tenant in its claim", String(mine.json?.organizationId) === "1", mine.text.slice(0, 200));
    t.expect("[R2] an access token issued for another resource is refused", await get(bearer(await issuer.accessToken(ana.cookie, OTHER_RESOURCE))), 401);
    const at = { typ: "at+jwt" };
    t.expect("[R2] an access token without azp is refused (signed with Better Auth's key)", await get(bearer(await issuer.sign({ ...atClaims, azp: undefined }, at))), 401);
    t.expect("[R2] the same access token payload with azp is accepted", await get(bearer(await issuer.sign(atClaims, at))), 200);
    t.expect("[R2] a token for the MCP URL that is not an access token is refused (signed with Better Auth's key)", await get(bearer(await issuer.sign(atClaims))), 401);

    const rpc = (headers = {}) =>
      fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    const metadataUrl = /resource_metadata="([^"]+)"/.exec((await rpc()).headers.get("www-authenticate") ?? "")?.[1];
    // The metadata URL is on the public host in MCP_RESOURCE_URL; ask this server for its path.
    const metadata = metadataUrl ? await call("GET", base + new URL(metadataUrl).pathname) : { json: undefined, text: "no metadata URL in the 401" };
    t.assert("[R22] mcp sign-in metadata lists Better Auth's base URL as the authorization server", JSON.stringify(metadata.json?.authorization_servers) === JSON.stringify([BETTER_AUTH.url]), metadata.text);
    const client = new Client({ name: "auth-smoke-better-auth", version: "1" });
    const tools = await client
      .connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: bearer(forMcp) } }))
      .then(() => client.listTools())
      .then((r) => r.tools.length, () => 0);
    t.assert("[R22] mcp lists tools for the access token", tools > 0);
    t.assert("[R22] mcp refuses a session token", (await rpc(bearer(ana.sessionToken))).status === 401);
    return t.failures;
  },
};
// The auth entities case above, on the same provider.
cases["auth-entities"] = { ...SESSION_AUTH, auth: BETTER_AUTH };

// AUTH_SMOKE_PROJECT: a directory to scaffold into once and reuse, so the
// break-each-rule job does not install dependencies for every run.
const reuse = process.env.AUTH_SMOKE_PROJECT;
const work = reuse || fs.mkdtempSync(path.join(os.tmpdir(), "apso-auth-smoke-"));
const failures = [];
try {
  const fresh = !fs.existsSync(path.join(work, "authapp"));
  if (fresh) console.log(`==> Scaffolding a ${language} project in ${work}`);
  if (reuse) fs.mkdirSync(work, { recursive: true });
  const project = fresh ? scaffold(work) : path.join(work, "authapp");
  if (fresh) {
    // A new project gets a development key in .env, which git ignores. The
    // cases below set the service's key source themselves, so take it out
    // (the TypeScript service reads .env).
    const t = checker("init");
    const envPath = path.join(project, ".env");
    const env = fs.readFileSync(envPath, "utf8");
    t.assert("[R14] apso init writes a development key and the local flag to .env", /^APSO_API_KEY=apso_dev_\w{32,}$/m.test(env) && /^APSO_LOCAL=1$/m.test(env));
    t.assert("[R14] .env is git-ignored in the scaffold", spawnSync("git", ["check-ignore", "-q", ".env"], { cwd: project }).status === 0);
    fs.writeFileSync(envPath, env.replace(/^APSO_.*\n/gm, ""));
    failures.push(...t.failures);
  }
  if (only.length === 0 || only.includes("generate")) {
    console.log(`==> ${language} / generate`);
    failures.push(...(await serveToolMarker(project)), ...buildTimeCases(project));
  }
  for (const [name, p] of Object.entries(cases)) {
    if (only.length > 0 && !only.includes(name)) continue;
    console.log(`==> ${language} / ${name}`);
    // The process id keeps two runs on one Postgres server off each other's databases.
    const db = `auth_smoke_${language}_${name.replace(/\W/g, "_")}_${process.pid}`;
    let server;
    // (Re)start the service on an empty database with these APSO_* settings.
    const boot = async (env = {}) => {
      if (server) {
        server.child.kill();
        await sleep(300);
      }
      psql("postgres", `drop database if exists ${db} with (force)`);
      psql("postgres", `create database ${db}`);
      server = await start(project, db, env);
      return server;
    };
    try {
      generate(project, p.auth, p.schema);
      {
        // The marker the hosted platform reads from the pushed source.
        const t = checker(name);
        const manifest = JSON.parse(fs.readFileSync(path.join(project, ".apso", "manifest.json"), "utf8"));
        t.assert("[R20] apso generate writes the access marker", manifest.accessContract === 1 && /^\d+\.\d+\.\d+/.test(manifest.cliVersion), JSON.stringify(manifest));
        t.assert("[R20] the access marker is not git-ignored", spawnSync("git", ["check-ignore", "-q", ".apso/manifest.json"], { cwd: project }).status === 1);
        failures.push(...t.failures);
      }
      const f = p.run ? await p.run(name, p, boot, project) : p.auth ? await jwtCase(name, p, boot) : await keyCase(name, boot, project, db);
      if (f.length > 0) console.log(server.log().slice(-2000));
      failures.push(...f);
    } catch (e) {
      console.log(`  FAIL ${e.message}`);
      failures.push(`${name}: ${e.message.slice(0, 2000)}`);
    } finally {
      server?.child.kill();
      try {
        await sleep(300);
        psql("postgres", `drop database if exists ${db} with (force)`);
      } catch {
        // best effort
      }
    }
  }
} finally {
  jwks.close();
  betterAuthServer?.kill();
  if (!process.env.AUTH_SMOKE_KEEP && !reuse) fs.rmSync(work, { recursive: true, force: true });
}

// The per-rule result. A case that names no rule or an unknown one, and (on a
// full run) a rule marked enforced or refused for this language with no case,
// fail the run: the rule list and the suite cannot drift apart.
if (warnings.size > 0) console.log(`\nWarnings (not rule failures):\n${[...warnings].map((w) => `- ${w}`).join("\n")}`);
console.log(`\n${report.table()}`);
const drift = [...report.problems(), ...(only.length === 0 ? report.uncovered().map((id) => `${id} is marked ${access.RULES.find((r) => r.id === id).status[language]} for ${language} in src/lib/access/rules.json but no case ran for it`) : [])];
for (const d of drift) failures.push(`rules: ${d}`);
if (process.env.AUTH_SMOKE_RESULTS)
  fs.writeFileSync(process.env.AUTH_SMOKE_RESULTS, JSON.stringify({ language, rows: report.rows(), results: report.results, failures }, null, 2));

if (failures.length > 0) {
  console.log(`\nFAIL (${language}): ${failures.length} check(s) failed`);
  for (const f of failures) console.log(`- ${f}`);
  process.exit(1);
}
console.log(`\nPASS (${language}): every auth check passed`);
