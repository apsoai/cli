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
 *   - permissions (TypeScript) refuse a role outside the list, directly and
 *     through ?join, and allow a role in it; a RolePermission row added by an
 *     owner grants a permission in that tenant only; a member cannot grant
 *     itself; a permission in the token is honored
 *   - mcp (TypeScript) serves only the opted-in operations as tools at /mcp,
 *     and a tool call meets the same auth, permission and scope guards as REST
 *
 * Tokens are minted locally with the claim shapes each provider issues, signed
 * by a key this script serves as a JWKS. Service tokens are signed the way the
 * platform gateway signs them (ES256), with a key served as a second JWKS.
 *
 * Usage: node scripts/auth-smoke.mjs <typescript|python|go> [provider...]
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
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

// Permissions and MCP tools need sign-in, and only TypeScript serves them.
const entities = (auth) => {
  const full = language === "typescript" && Boolean(auth);
  return [
    { name: "Organization", created_at: true, updated_at: true, fields: [{ name: "name", type: "text" }] },
    // Projects are readable as MCP tools.
    { name: "Project", created_at: true, updated_at: true, scopeBy: "organizationId", ...(full ? { mcp: ["read"] } : {}), fields: [{ name: "title", type: "text" }] },
    // A tenant field that is not named workspaceId/organizationId (imported schemas).
    { name: "Note", created_at: true, updated_at: true, scopeBy: "orgId", fields: [{ name: "body", type: "text" }, { name: "orgId", type: "integer", nullable: true }] },
    // Scoped through its parent (TypeScript only; Python and Go warn and skip it).
    { name: "Task", created_at: true, updated_at: true, scopeBy: "project.organizationId", fields: [{ name: "title", type: "text" }] },
    // A "support" role reads every tenant's tickets (scopeOptions.bypassRoles).
    { name: "Ticket", created_at: true, updated_at: true, scopeBy: "organizationId", scopeOptions: { bypassRoles: ["support"] }, fields: [{ name: "title", type: "text" }] },
    // Only owners read or delete invoices.
    {
      name: "Invoice",
      created_at: true,
      updated_at: true,
      ...(full ? { permissions: { read: ["owner"], delete: ["owner"] }, mcp: true } : {}),
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
  { from: "Organization", to: "Invoice", type: "OneToMany" },
  ...(language === "typescript" && auth ? [{ from: "Organization", to: "RolePermission", type: "OneToMany" }] : []),
];

const route = (plural) =>
  language === "typescript" ? `/${plural}` : `/api/${plural.toLowerCase()}`;
const ORGS = route("Organizations");
const PROJECTS = route("Projects");
const rows = (json) => (Array.isArray(json) ? json : json?.data ?? json?.items ?? []);

function scaffold(dir) {
  sh(CLI, ["init", "--name", "authapp", "--language", language, "--skip-platform"], { cwd: dir });
  return path.join(dir, "authapp");
}

function generate(project, auth) {
  const rcPath = path.join(project, ".apsorc");
  const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
  Object.assign(rc, { version: 2, entities: entities(auth), relationships: relationships(auth), auth });
  fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2));
  sh(CLI, ["generate", "--language", language], { cwd: project });
  if (language === "typescript") {
    // APSO_MCP_TARBALL tests an unreleased build of @apso/mcp (npm pack output).
    if (process.env.APSO_MCP_TARBALL) {
      const pkgPath = path.join(project, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      pkg.dependencies["@apso/mcp"] = `file:${path.resolve(process.env.APSO_MCP_TARBALL)}`;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
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
async function start(project, db, extra = {}) {
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
    [cmd, args] = [process.execPath, ["dist/main"]];
  } else if (language === "go") {
    Object.assign(env, { DATABASE_URL: `${PG}/${db}?sslmode=disable`, DATABASE_SYNC: "true", PORT: String(port), GIN_MODE: "release" });
    [cmd, args] = [path.join(project, "bin", "server"), []];
  } else {
    Object.assign(env, { DATABASE_URL: `${PG.replace(/^postgres(ql)?:/, "postgresql+asyncpg:")}/${db}`, DATABASE_SYNC: "true", PORT: String(port) });
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

function checker(name) {
  const failures = [];
  const expect = (label, res, ...ok) => {
    const pass = ok.includes(res.status);
    console.log(`  ${pass ? "ok  " : "FAIL"} ${label}: ${res.status}`);
    if (!pass) failures.push(`${name}: ${label}: got ${res.status} ${res.text.slice(0, 300)}`);
    return pass;
  };
  const assert = (label, cond, detail = "") => {
    console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
    if (!cond) failures.push(`${name}: ${label} ${detail}`);
    return cond;
  };
  return { expect, assert, failures };
}

/** CRUD with valid credentials, plus tenant isolation where scopeBy is enforced. */
async function crudAndScope(base, t, auth, auth2, noTenant, support) {
  const org1 = await call("POST", base + ORGS, { headers: auth(undefined), body: { name: "Acme" } });
  const org2 = await call("POST", base + ORGS, { headers: auth(undefined), body: { name: "Beta" } });
  if (!t.expect("create organization", org1, 200, 201) || !t.expect("create second organization", org2, 200, 201)) return;
  const [id1, id2] = [org1.json.id, org2.json.id];
  const as1 = auth(String(id1));
  const as2 = auth2 ? auth2(String(id2)) : undefined;

  t.expect("list organizations", await call("GET", base + ORGS, { headers: as1 }), 200);
  // scopeBy forces the caller's tenant whatever the body says.
  const created = await call("POST", base + PROJECTS, {
    headers: as1,
    body: { title: "Roadmap", organizationId: id2 },
  });
  if (!t.expect("create project", created, 200, 201)) return;
  const pid = created.json.id;
  const read = await call("GET", `${base}${PROJECTS}/${pid}`, { headers: as1 });
  t.expect("read project", read, 200);

  if (as2) {
    t.assert("create body cannot pick another tenant", String(read.json?.organizationId) === String(id1), `organizationId=${read.json?.organizationId}`);
    t.expect("other tenant cannot read the project", await call("GET", `${base}${PROJECTS}/${pid}`, { headers: as2 }), 403, 404);
    const theirs = await call("GET", base + PROJECTS, { headers: as2 });
    t.expect("other tenant lists projects", theirs, 200);
    t.assert("other tenant's list excludes the project", !rows(theirs.json).some((p) => p.id === pid));
    const mine = await call("GET", base + PROJECTS, { headers: as1 });
    t.assert("own list includes the project", rows(mine.json).some((p) => p.id === pid));
    t.expect("other tenant cannot update the project", await call("PATCH", `${base}${PROJECTS}/${pid}`, { headers: as2, body: { title: "Taken" } }), 403, 404);
    t.expect("other tenant cannot delete the project", await call("DELETE", `${base}${PROJECTS}/${pid}`, { headers: as2 }), 403, 404);
    const moved = await call("PATCH", `${base}${PROJECTS}/${pid}`, { headers: as1, body: { title: "Roadmap 2", organizationId: id2 } });
    t.expect("owner updates the project", moved, 200);
    const after = await call("GET", `${base}${PROJECTS}/${pid}`, { headers: as1 });
    t.assert("update cannot move the project to another tenant", after.status === 200 && String(after.json?.organizationId) === String(id1) && after.json?.title === "Roadmap 2", `${after.status} ${after.text.slice(0, 200)}`);
    if (noTenant) t.expect("caller with no tenant cannot list scoped rows", await call("GET", base + PROJECTS, { headers: noTenant }), 403);
    // scopeBy "orgId" takes the caller's tenant too.
    const NOTES = route("Notes");
    const note = await call("POST", base + NOTES, { headers: as1, body: { body: "hi", orgId: id2 } });
    if (t.expect("create note (scopeBy orgId)", note, 200, 201)) {
      t.assert("note stores the caller's tenant", String(note.json?.orgId) === String(id1), `orgId=${note.json?.orgId}`);
      t.expect("other tenant cannot read the note", await call("GET", `${base}${NOTES}/${note.json.id}`, { headers: as2 }), 403, 404);
      const theirNotes = await call("GET", base + NOTES, { headers: as2 });
      t.assert("other tenant's notes exclude it", theirNotes.status === 200 && !rows(theirNotes.json).some((n) => n.id === note.json.id), `${theirNotes.status}`);
    }
    if (language === "typescript") await nestedScope(base, t, as1, as2, pid);
    if (support) await bypassScope(base, t, as1, as2, support(String(id2)));
  }
  t.expect("delete project", await call("DELETE", `${base}${PROJECTS}/${pid}`, { headers: as1 }), 200, 204);
}

/** scopeOptions.bypassRoles: a support caller sees other tenants' tickets; a member does not. */
async function bypassScope(base, t, as1, as2, asSupport) {
  const TICKETS = route("Tickets");
  const ticket = await call("POST", base + TICKETS, { headers: as1, body: { title: "Login broken" } });
  if (!t.expect("create ticket", ticket, 200, 201)) return;
  const tid = ticket.json.id;
  const member = await call("GET", base + TICKETS, { headers: as2 });
  t.assert("member of another tenant does not list the ticket", member.status === 200 && !rows(member.json).some((x) => x.id === tid), `${member.status} ${member.text.slice(0, 200)}`);
  const support = await call("GET", base + TICKETS, { headers: asSupport });
  t.assert("support role lists another tenant's ticket", support.status === 200 && rows(support.json).some((x) => x.id === tid), `${support.status} ${support.text.slice(0, 200)}`);
  t.expect("support role reads another tenant's ticket", await call("GET", `${base}${TICKETS}/${tid}`, { headers: asSupport }), 200);
  t.expect("delete ticket", await call("DELETE", `${base}${TICKETS}/${tid}`, { headers: as1 }), 200, 204);
}

/** scopeBy "project.organizationId": a Task belongs to its project's tenant. */
async function nestedScope(base, t, as1, as2, pid) {
  const TASKS = route("Tasks");
  const theirProject = await call("POST", base + PROJECTS, { headers: as2, body: { title: "Theirs" } });
  if (!t.expect("other tenant creates a project", theirProject, 200, 201)) return;
  const pid2 = theirProject.json.id;
  const task = await call("POST", base + TASKS, { headers: as1, body: { title: "Ship it", projectId: pid } });
  if (t.expect("create task under own project", task, 200, 201)) {
    const tid = task.json.id;
    const mine = await call("GET", base + TASKS, { headers: as1 });
    t.assert("own task list includes the task", mine.status === 200 && rows(mine.json).some((x) => x.id === tid), `${mine.status} ${mine.text.slice(0, 200)}`);
    const theirs = await call("GET", base + TASKS, { headers: as2 });
    t.assert("other tenant's task list excludes the task", theirs.status === 200 && !rows(theirs.json).some((x) => x.id === tid), `${theirs.status} ${theirs.text.slice(0, 200)}`);
    t.expect("other tenant cannot read the task", await call("GET", `${base}${TASKS}/${tid}`, { headers: as2 }), 403, 404);
    t.expect("task cannot move to another tenant's project", await call("PATCH", `${base}${TASKS}/${tid}`, { headers: as1, body: { projectId: pid2 } }), 403);
    t.expect("delete task", await call("DELETE", `${base}${TASKS}/${tid}`, { headers: as1 }), 200, 204);
  }
  t.expect("cannot create a task under another tenant's project", await call("POST", base + TASKS, { headers: as2, body: { title: "Sneak", projectId: pid } }), 403);
  const empty = await call("GET", base + TASKS, { headers: as2 });
  t.assert("tenant with no tasks lists none", empty.status === 200 && rows(empty.json).length === 0, `${empty.status} ${empty.text.slice(0, 200)}`);
  t.expect("delete other tenant's project", await call("DELETE", `${base}${PROJECTS}/${pid2}`, { headers: as2 }), 200, 204);
}

async function jwtCase(name, p, boot) {
  const t = checker(name);
  // The Supabase-shaped case also runs with an API key set; the others run with keys off.
  const { base } = await boot(name === "jwt" ? { APSO_API_KEY: KEY } : {});
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const sign = (claims, opts = {}) => mint(claims, { ...p.signWith, ...opts });
  const valid = (org) => bearer(sign(p.claims(org ?? "1")));
  const reject = async (label, headers) =>
    t.expect(label, await call("GET", base + ORGS, { headers }), 401);

  t.expect("/health is public", await call("GET", `${base}/health`), 200);
  await reject("no credentials", {});
  await reject("garbage token", bearer("not.a.jwt"));
  await reject("expired token", bearer(sign({ ...p.claims("1"), exp: Math.floor(Date.now() / 1000) - 60 })));
  await reject("wrong issuer", bearer(sign({ ...p.claims("1"), iss: "https://evil.example/" })));
  if (p.wrongAudience) await reject("wrong audience", bearer(sign({ ...p.claims("1"), ...p.wrongAudience })));
  if (p.unauthorizedParty) await reject("azp not an authorized party", bearer(sign({ ...p.claims("1"), ...p.unauthorizedParty })));
  await reject("signed by another key", bearer(sign(p.claims("1"), p.impostor ?? { key: impostor.privateKey })));
  await reject('alg "none"', bearer(mint(p.claims("1"), { alg: "none" })));
  await reject("HS256 signed with the public key", bearer(mint(p.claims("1"), { alg: "HS256", key: signing.publicKey.export({ type: "spki", format: "pem" }) })));
  await reject("no subject", bearer(sign({ ...p.claims("1"), sub: undefined })));

  // Only the Supabase-shaped case maps a roles array we can set per token.
  const support = name === "jwt" ? (org) => bearer(sign({ ...p.claims(org), app_metadata: { org_id: org, roles: ["support"] } })) : undefined;
  await crudAndScope(base, t, valid, valid, bearer(sign(p.claims(undefined))), support);
  if (name === "jwt" && language === "typescript") {
    const as = (roles, org = "1", extra = {}) => bearer(sign({ ...p.claims(org), app_metadata: { org_id: org, roles }, ...extra }));
    await rolePermissions(base, t, as(["owner"]), as(["member"]), as(["member"], "2"), as(["member"], "1", { permissions: ["invoice:delete"] }));
    await mcpTools(base, t, as(["owner"]), as(["member"]), as(["owner"], "2"), as(["owner"], "1", { aud: `${base}/mcp` }));
  }
  if (name === "jwt") {
    await keyNextToSignIn(base, t, valid("1"));
    const platform = await boot(PLATFORM);
    await gatewayNextToSignIn(platform.base, t, bearer(sign(p.claims("1"))));
  } else {
    t.expect("[R14] keys off: a request that sends x-api-key is refused, valid user token or not", await call("GET", base + ORGS, { headers: { ...valid("1"), "x-api-key": KEY } }), 401);
  }
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
  t.assert("mcp without credentials is a 401 that names the sign-in metadata", anonymous.status === 401 && Boolean(metadataUrl), `${anonymous.status} ${challenge}`);
  const metadata = metadataUrl ? await call("GET", metadataUrl) : { json: undefined, text: "" };
  t.assert(
    "mcp sign-in metadata names the token issuer and this endpoint",
    metadata.json?.resource === `${base}/mcp` && Array.isArray(metadata.json?.authorization_servers) && metadata.json.authorization_servers.length === 1,
    metadata.text
  );
  const badToken = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer not.a.jwt" },
    body: JSON.stringify(rpc),
  });
  t.assert("mcp with a bad token is a 401 invalid_token", badToken.status === 401 && (badToken.headers.get("www-authenticate") ?? "").includes("invalid_token"));
  // An MCP client asks the identity provider for a token for the MCP URL.
  const issuedForMcp = await (await connect(ownerForMcp)).listTools().then((r) => r.tools.length, () => 0);
  t.assert("mcp accepts a token issued for the MCP endpoint's URL", issuedForMcp > 0);

  const names = (await asOwner.listTools()).tools.map((tool) => tool.name).sort();
  const expected = ["create_invoice", "delete_invoice", "get_invoice", "get_project", "list_invoices", "list_projects", "update_invoice"];
  t.assert("mcp lists only the opted-in operations", JSON.stringify(names) === JSON.stringify(expected), names.join(","));

  const denied = await asMember.callTool({ name: "list_invoices", arguments: {} });
  t.assert("mcp call by a member lacks invoice:read", denied.isError === true && text(denied).includes("invoice:read"), text(denied));

  // Invoice carries the permissions; Project carries the tenant scope.
  const created = await asOwner.callTool({ name: "create_invoice", arguments: { body: { total: 7, organizationId: 1 } } });
  const invoice = created.isError ? {} : JSON.parse(text(created));
  t.assert("mcp create by the owner works", !created.isError && invoice.total === 7, text(created));
  const mine = rowsOf(await asOwner.callTool({ name: "list_invoices", arguments: { limit: 100 } }));
  t.assert("mcp list shows the owner its invoice", mine?.some((row) => row.id === invoice.id) === true);

  const project = await call("POST", base + PROJECTS, { headers: owner, body: { title: "mcp scoped", organizationId: 2 } });
  if (!t.expect("create a project over REST for the mcp scope checks", project, 200, 201)) return;
  const own = rowsOf(await asOwner.callTool({ name: "list_projects", arguments: { limit: 100 } }));
  t.assert("mcp list shows the owner its project", own?.some((row) => row.id === project.json.id) === true);
  const theirs = rowsOf(await asOther.callTool({ name: "list_projects", arguments: { limit: 100 } }));
  t.assert("mcp list hides it from another tenant", theirs !== undefined && !theirs.some((row) => row.id === project.json.id));
  const crossGet = await asOther.callTool({ name: "get_project", arguments: { id: project.json.id } });
  t.assert("mcp get by id is refused across tenants", crossGet.isError === true, text(crossGet));
  const memberDelete = await asMember.callTool({ name: "delete_invoice", arguments: { id: invoice.id } });
  t.assert("mcp delete by a member lacks invoice:delete", memberDelete.isError === true && text(memberDelete).includes("invoice:delete"), text(memberDelete));
  const removed = await asOwner.callTool({ name: "delete_invoice", arguments: { id: invoice.id } });
  t.assert("mcp delete by the owner works", !removed.isError, text(removed));
}

/**
 * permissions: { read: ["owner"], delete: ["owner"] } on Invoice; create is open.
 * Then runtime grants (RolePermission rows, scoped to the tenant) and a
 * permission carried in the token extend that, and nothing else does.
 */
async function rolePermissions(base, t, owner, member, otherMember, memberWithDelete) {
  const INVOICES = route("Invoices");
  const GRANTS = route("RolePermissions");
  const org = await call("POST", base + ORGS, { headers: owner, body: { name: "Billing Co" } });
  if (!t.expect("create organization for invoices", org, 200, 201)) return;
  const created = await call("POST", base + INVOICES, { headers: member, body: { total: 100, organizationId: org.json.id } });
  if (!t.expect("member creates an invoice (create not restricted)", created, 200, 201)) return;
  const iid = created.json.id;
  t.expect("member cannot list invoices", await call("GET", base + INVOICES, { headers: member }), 403);
  t.expect("member cannot read an invoice", await call("GET", `${base}${INVOICES}/${iid}`, { headers: member }), 403);
  t.expect("member cannot read invoices through a join", await call("GET", `${base}${ORGS}?join=invoices`, { headers: member }), 403);
  t.expect("member lists organizations without the join", await call("GET", base + ORGS, { headers: member }), 200);
  t.expect("member cannot delete an invoice", await call("DELETE", `${base}${INVOICES}/${iid}`, { headers: member }), 403);
  // [R11] The same refusal for every way a request can load the relation.
  const embed = (headers, select = "name,invoices(total)") => call("GET", `${base}${ORGS}?select=${select}`, { headers });
  t.expect("[R11] member cannot read invoices through a select embed", await embed(member), 403);
  t.expect("[R11] member cannot read invoices through a select embed, dialect named in the header", await embed({ ...member, "x-crud-dialect": "postgrest" }), 403);
  t.expect("[R11] member cannot read invoices through an aliased inner embed", await embed(member, "name,bills:invoices!inner(total)"), 403);
  t.expect("[R11] member cannot read invoices through a nested embed", await embed(member, "name,projects(title,organization(name,invoices(total)))"), 403);
  t.expect("[R11] member cannot read invoices through a nested join", await call("GET", `${base}${PROJECTS}?join=organization&join=organization.invoices`, { headers: member }), 403);
  t.expect("[R11] member cannot read invoices through a join in list form", await call("GET", `${base}${ORGS}?join[0]=projects&join[1]=invoices`, { headers: member }), 403);
  t.expect("[R11] member reads an embed it is allowed", await embed(member, "name,projects(title)"), 200);
  const ownerEmbed = await embed(owner);
  t.assert("[R11] owner reads invoices through a select embed", ownerEmbed.status === 200 && rows(ownerEmbed.json).some((o) => (o.invoices ?? []).some((i) => i.id === iid)), `${ownerEmbed.status} ${ownerEmbed.text.slice(0, 200)}`);
  t.expect("owner lists invoices", await call("GET", base + INVOICES, { headers: owner }), 200);
  t.expect("owner reads invoices through a join", await call("GET", `${base}${ORGS}?join=invoices`, { headers: owner }), 200);

  // Runtime grants.
  t.expect("member cannot grant itself a permission", await call("POST", base + GRANTS, { headers: member, body: { role: "member", permission: "invoice:read" } }), 403);
  const grant = await call("POST", base + GRANTS, { headers: owner, body: { role: "member", permission: "invoice:read", organizationId: 2 } });
  if (t.expect("owner grants members invoice:read", grant, 200, 201)) {
    t.assert("grant is stored in the owner's tenant", String(grant.json?.organizationId) === "1", `organizationId=${grant.json?.organizationId}`);
    t.expect("member lists invoices after the grant", await call("GET", base + INVOICES, { headers: member }), 200);
    t.expect("member reads invoices through a join after the grant", await call("GET", `${base}${ORGS}?join=invoices`, { headers: member }), 200);
    t.expect("[R11] member reads invoices through a select embed after the grant", await embed(member), 200);
    t.expect("member of another tenant still cannot list invoices", await call("GET", base + INVOICES, { headers: otherMember }), 403);
    t.expect("the grant does not include delete", await call("DELETE", `${base}${INVOICES}/${iid}`, { headers: member }), 403);
    t.expect("owner revokes the grant", await call("DELETE", `${base}${GRANTS}/${grant.json.id}`, { headers: owner }), 200, 204);
    t.expect("member cannot list invoices after the revoke", await call("GET", base + INVOICES, { headers: member }), 403);
  }

  // A permission in the token (Auth0 RBAC style).
  t.expect("member with invoice:delete in its token deletes the invoice", await call("DELETE", `${base}${INVOICES}/${iid}`, { headers: memberWithDelete }), 200, 204);
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
  const list = await call("GET", base + PROJECTS, { headers });
  t.assert("[R10] key caller lists every tenant's projects", list.status === 200 && made.every((id) => rows(list.json).some((p) => p.id === id)), `${list.status} ${list.text.slice(0, 200)}`);
  t.expect("[R10] key caller reads a project by id", await call("GET", `${base}${PROJECTS}/${made[1]}`, { headers }), 200);
  t.expect("[R13] key caller updates a project", await call("PATCH", `${base}${PROJECTS}/${made[1]}`, { headers, body: { title: "Renamed" } }), 200);
  for (const id of made) t.expect("[R13] key caller deletes a project", await call("DELETE", `${base}${PROJECTS}/${id}`, { headers }), 200, 204);
}

/** A service with no auth block: nothing configured, then each key source. */
async function keyCase(name, boot) {
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
  const kept = await call("GET", s.base + ORGS, { headers: { "x-request-id": "req-from-caller-1" } });
  t.assert("a request id the caller sent is kept and echoed", kept.requestId === "req-from-caller-1" && bodyRequestId(kept) === "req-from-caller-1", `${kept.requestId} ${kept.text.slice(0, 200)}`);

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
  s = await boot({ APSO_API_KEY: KEY });
  plain401(t, "[R5] wrong key, no local flag", await call("GET", s.base + ORGS, { headers: key("sk_smoke_nope") }), s.log);
  t.expect("[R14] a key removed from APSO_API_KEY is refused after a restart", await call("GET", s.base + ORGS, { headers: key(OLD_KEY) }), 401);

  // The platform's gateway token (hosted).
  s = await boot({ ...PLATFORM, APSO_LOCAL: "1" });
  await gateway401s(s, t);
  t.expect("[R0] platform mode, no credential and no sign-in", await call("GET", s.base + ORGS), 401);
  await serviceCaller(s.base, t, serviceToken());
  return t.failures;
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
async function keyNextToSignIn(base, t, user) {
  t.expect("[R14] a wrong key is refused even with a valid user token", await call("GET", base + ORGS, { headers: { ...user, ...key("sk_smoke_nope") } }), 401);
  t.expect("[R4] a valid user token with no key still signs in", await call("GET", base + ORGS, { headers: user }), 200);
  t.expect("[R1] no key and no token", await call("GET", base + ORGS), 401);
  await serviceCaller(base, t, key(KEY));
  if (language !== "typescript") return;

  // Invoices are limited to owners; a key caller has no role and is not limited.
  const INVOICES = route("Invoices");
  const invoice = await call("POST", base + INVOICES, { headers: key(KEY), body: { total: 5, organizationId: 1 } });
  if (t.expect("[R13] key caller creates an invoice", invoice, 200, 201)) {
    t.expect("[R13] key caller lists invoices without a role", await call("GET", base + INVOICES, { headers: key(KEY) }), 200);
    t.expect("[R13] key caller reads invoices through a join", await call("GET", `${base}${ORGS}?join=invoices`, { headers: key(KEY) }), 200);
    t.expect("[R13] key caller reads invoices through a select embed", await call("GET", `${base}${ORGS}?select=name,invoices(total)`, { headers: key(KEY) }), 200);
    t.expect("[R13] key caller deletes an invoice without a role", await call("DELETE", `${base}${INVOICES}/${invoice.json.id}`, { headers: key(KEY) }), 200, 204);
  }

  // /mcp follows the same rules.
  const rpc = (headers) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  t.assert("[R22] mcp with a wrong key is a 401", (await rpc(key("sk_smoke_nope"))).status === 401);
  t.assert("[R14] mcp with a wrong key and a valid user token is a 401", (await rpc({ ...user, ...key("sk_smoke_nope") })).status === 401);
  const client = new Client({ name: "auth-smoke-key", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: key(KEY) } }));
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

const work = fs.mkdtempSync(path.join(os.tmpdir(), "apso-auth-smoke-"));
const failures = [];
try {
  console.log(`==> Scaffolding a ${language} project in ${work}`);
  const project = scaffold(work);
  {
    // A new project gets a development key in .env, which git ignores. The
    // cases below set the service's key source themselves, so take it out
    // (the TypeScript service reads .env).
    const t = checker("init");
    const envPath = path.join(project, ".env");
    const env = fs.readFileSync(envPath, "utf8");
    t.assert("apso init writes a development key and the local flag to .env", /^APSO_API_KEY=apso_dev_\w{32,}$/m.test(env) && /^APSO_LOCAL=1$/m.test(env));
    t.assert(".env is git-ignored in the scaffold", spawnSync("git", ["check-ignore", "-q", ".env"], { cwd: project }).status === 0);
    fs.writeFileSync(envPath, env.replace(/^APSO_.*\n/gm, ""));
    failures.push(...t.failures);
  }
  for (const [name, p] of Object.entries(cases)) {
    if (only.length > 0 && !only.includes(name)) continue;
    console.log(`==> ${language} / ${name}`);
    const db = `auth_smoke_${language}_${name.replace(/\W/g, "_")}`;
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
      generate(project, p.auth);
      const f = p.auth ? await jwtCase(name, p, boot) : await keyCase(name, boot);
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
  if (!process.env.AUTH_SMOKE_KEEP) fs.rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.log(`\nFAIL (${language}): ${failures.length} check(s) failed`);
  for (const f of failures) console.log(`- ${f}`);
  process.exit(1);
}
console.log(`\nPASS (${language}): every auth check passed`);
