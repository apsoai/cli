#!/usr/bin/env node
/**
 * End-to-end auth check for generated services, one language per run.
 *
 * Scaffolds a project with the CLI from this checkout, then for each auth
 * provider (Auth0, Clerk, Cognito, generic JWT, API key) regenerates it,
 * starts it on a fresh Postgres database, and checks that:
 *   - requests without valid credentials get 401 (missing, garbage, expired,
 *     wrong issuer, wrong audience, wrong signing key, alg "none", HS256
 *     signed with the public key, no subject; for API keys wrong, revoked,
 *     expired keys)
 *   - a valid token or key can list, create, read and delete rows
 *   - /health stays public
 *   - scopeBy keeps each tenant to its own rows, overrides a tenant id sent in
 *     a create body, and refuses a caller with no tenant
 *
 * Tokens are minted locally with the claim shapes each provider issues, signed
 * by a key this script serves as a JWKS.
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
    return { status: res.status, text, json };
  } catch (e) {
    return { status: 0, text: String(e), json: undefined };
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

function mint(payload, { key = signing.privateKey, alg = "RS256", kid = "k1" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + 600, ...payload };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  const head = `${b64url({ alg, typ: "JWT", kid })}.${b64url(body)}`;
  let sig = "";
  if (alg === "RS256") sig = crypto.sign("sha256", Buffer.from(head), key).toString("base64url");
  if (alg === "HS256") sig = crypto.createHmac("sha256", key).update(head).digest("base64url");
  if (alg === "EdDSA") sig = crypto.sign(null, Buffer.from(head), key).toString("base64url");
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
    "api-key": { auth: { provider: "api-key" } },
  };
}

// ---------- project ----------

const ENTITIES = [
  { name: "Organization", created_at: true, updated_at: true, fields: [{ name: "name", type: "text" }] },
  {
    name: "ApiKey",
    created_at: true,
    updated_at: true,
    fields: [
      { name: "name", type: "text" },
      { name: "keyHash", type: "text", length: 64, unique: true },
      { name: "status", type: "enum", values: ["active", "revoked"], default: "active" },
      { name: "expiresAt", type: "date", nullable: true },
    ],
  },
  { name: "Project", created_at: true, updated_at: true, scopeBy: "organizationId", fields: [{ name: "title", type: "text" }] },
  // A tenant field that is not named workspaceId/organizationId (imported schemas).
  { name: "Note", created_at: true, updated_at: true, scopeBy: "orgId", fields: [{ name: "body", type: "text" }, { name: "orgId", type: "integer", nullable: true }] },
];
const RELATIONSHIPS = [
  { from: "Organization", to: "ApiKey", type: "OneToMany" },
  { from: "Organization", to: "Project", type: "OneToMany" },
];

const route = (plural) =>
  language === "typescript" ? `/${plural}` : `/api/${plural.toLowerCase()}`;
const ORGS = route("Organizations");
const PROJECTS = route("Projects");
const rows = (json) => (Array.isArray(json) ? json : json?.data ?? json?.items ?? []);

function scaffold(dir) {
  sh(CLI, ["init", "--name", "authapp", "--language", language, "--skip-platform"], { cwd: dir });
  const project = path.join(dir, "authapp");
  const rcPath = path.join(project, ".apsorc");
  const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
  Object.assign(rc, { version: 2, entities: ENTITIES, relationships: RELATIONSHIPS });
  fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2));
  return project;
}

function generate(project, auth) {
  const rcPath = path.join(project, ".apsorc");
  const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
  rc.auth = auth;
  fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2));
  sh(CLI, ["generate", "--language", language], { cwd: project });
  if (language === "typescript") {
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

async function start(project, db) {
  const port = await freePort();
  const u = new URL(`${PG}/${db}`);
  const env = { ...process.env };
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
    });
    [cmd, args] = [process.execPath, ["dist/main"]];
  } else if (language === "go") {
    Object.assign(env, { DATABASE_URL: `${PG}/${db}?sslmode=disable`, DATABASE_SYNC: "true", PORT: String(port), GIN_MODE: "release" });
    [cmd, args] = [path.join(project, "bin", "server"), []];
  } else {
    Object.assign(env, { DATABASE_URL: `${PG.replace(/^postgres(ql)?:/, "postgresql+asyncpg:")}/${db}`, DATABASE_SYNC: "true", PORT: String(port) });
    [cmd, args] = [path.join(project, ".venv", "bin", "python"), ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)]];
  }
  const child = spawn(cmd, args, { cwd: project, env });
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
async function crudAndScope(base, t, auth, auth2, noTenant) {
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
  }
  t.expect("delete project", await call("DELETE", `${base}${PROJECTS}/${pid}`, { headers: as1 }), 200, 204);
}

async function jwtCase(name, p, base) {
  const t = checker(name);
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

  await crudAndScope(base, t, valid, valid, bearer(sign(p.claims(undefined))));
  return t.failures;
}

async function apiKeyCase(name, base, db) {
  const t = checker(name);
  const table = psql(db, "select table_name from information_schema.tables where table_schema='public' and replace(table_name,'_','') ilike 'apikey'");
  const orgTable = psql(db, "select table_name from information_schema.tables where table_schema='public' and table_name ilike 'organization'");
  const cols = (tbl) => psql(db, `select column_name from information_schema.columns where table_name='${tbl}'`).split("\n");
  const pick = (list, re) => list.find((c) => re.test(c));
  const kc = cols(table);
  const oc = cols(orgTable);
  const q = (c) => `"${c}"`;
  const stamps = (list) => [pick(list, /^created_?at$/i), pick(list, /^updated_?at$/i)].filter(Boolean);
  const orgId = (name) =>
    psql(db, `insert into ${q(orgTable)} (name${stamps(oc).map((c) => `, ${q(c)}`).join("")}) values ('${name}'${stamps(oc).map(() => ", now()").join("")}) returning id`);
  const id1 = orgId("Acme");
  const id2 = orgId("Beta");
  const insertKey = (plain, status, expires, org) => {
    const hash = crypto.createHash("sha256").update(plain).digest("hex");
    const c = [pick(kc, /^name$/), pick(kc, /^key_?hash$/i), pick(kc, /^status$/), pick(kc, /^expires_?at$/i), pick(kc, /^organization_?id$/i), ...stamps(kc)];
    const v = [`'${plain.slice(0, 8)}'`, `'${hash}'`, `'${status}'`, expires ? `'${expires}'` : "null", org, ...stamps(kc).map(() => "now()")];
    psql(db, `insert into ${q(table)} (${c.map(q).join(", ")}) values (${v.join(", ")})`);
  };
  insertKey("sk_test_good_1", "active", null, id1);
  insertKey("sk_test_good_2", "active", "2999-01-01", id2);
  insertKey("sk_test_revoked", "revoked", null, id1);
  insertKey("sk_test_expired", "active", "2000-01-01", id1);

  const key = (k) => ({ "x-api-key": k });
  const reject = async (label, headers) => t.expect(label, await call("GET", base + ORGS, { headers }), 401);
  t.expect("/health is public", await call("GET", `${base}/health`), 200);
  await reject("no key", {});
  await reject("unknown key", key("sk_test_nope"));
  await reject("revoked key", key("sk_test_revoked"));
  await reject("expired key", key("sk_test_expired"));

  // The key decides the tenant; the org argument is ignored.
  const auth = () => key("sk_test_good_1");
  const created = await call("POST", base + PROJECTS, { headers: auth(), body: { title: "Roadmap", organizationId: Number(id2) } });
  if (t.expect("create project", created, 200, 201)) {
    const pid = created.json.id;
    const read = await call("GET", `${base}${PROJECTS}/${pid}`, { headers: auth() });
    t.expect("read project", read, 200);
    {
      t.assert("create body cannot pick another tenant", String(read.json?.organizationId) === id1, `organizationId=${read.json?.organizationId}`);
      t.expect("other tenant's key cannot read the project", await call("GET", `${base}${PROJECTS}/${pid}`, { headers: key("sk_test_good_2") }), 403, 404);
      const theirs = await call("GET", base + PROJECTS, { headers: key("sk_test_good_2") });
      t.assert("other tenant's list excludes the project", theirs.status === 200 && !rows(theirs.json).some((p) => p.id === pid), `${theirs.status}`);
    }
    t.expect("delete project", await call("DELETE", `${base}${PROJECTS}/${pid}`, { headers: auth() }), 200, 204);
  }
  return t.failures;
}

// ---------- main ----------

const jwks = http.createServer((req, res) => {
  if (req.url.endsWith("/.well-known/jwks.json") || req.url.endsWith("/api/auth/jwks")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(JWKS));
  } else {
    res.writeHead(404).end();
  }
});
const jwksPort = await freePort();
await new Promise((r) => jwks.listen(jwksPort, "127.0.0.1", r));
const cases = providers(`http://127.0.0.1:${jwksPort}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "apso-auth-smoke-"));
const failures = [];
try {
  console.log(`==> Scaffolding a ${language} project in ${work}`);
  const project = scaffold(work);
  for (const [name, p] of Object.entries(cases)) {
    if (only.length > 0 && !only.includes(name)) continue;
    console.log(`==> ${language} / ${name}`);
    const db = `auth_smoke_${language}_${name.replace(/\W/g, "_")}`;
    let server;
    try {
      generate(project, p.auth);
      psql("postgres", `drop database if exists ${db}`);
      psql("postgres", `create database ${db}`);
      server = await start(project, db);
      const f = name === "api-key" ? await apiKeyCase(name, server.base, db) : await jwtCase(name, p, server.base);
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
