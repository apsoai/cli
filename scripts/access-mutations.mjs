/**
 * Break each access rule on purpose (apsoai/cli#210).
 *
 * Each entry removes one protection from the service the auth smoke generates,
 * by editing the generated guard, controller or service in the temp project.
 * scripts/break-each-rule.mjs applies them one at a time and requires the
 * suite to fail a case for every rule the entry names. Nothing here ships: the
 * edits exist only in the test project, and there is no switch in a generated
 * service that turns a protection off.
 *
 * An edit is [file, find, replace]. `*` in the file matches one path segment.
 * An entry with no edits for a language does not run for it.
 */
import fs from "node:fs";
import path from "node:path";

const TS = {
  key: "src/autogen/guards/key.guard.ts",
  auth: "src/autogen/guards/auth.guard.ts",
  scope: "src/autogen/guards/scope.guard.ts",
  permission: "src/autogen/guards/permission.guard.ts",
  controllers: "src/autogen/*/*.controller.ts",
};
const PY = { auth: "app/autogen/auth.py", services: "app/autogen/services/*.py" };
const GO = { auth: "autogen/middleware/auth.go", services: "autogen/services/*.go" };

export const MUTATIONS = [
  {
    id: "default-deny",
    removes: "the refusal when no key source and no sign-in is configured",
    rules: ["R0"],
    legs: ["no-auth"],
    typescript: [[TS.key, /this\.refuse\(request, NO_SOURCE,/, "return true; this.refuse(request, NO_SOURCE,"]],
    python: [[PY.auth, /_refuse\(request, NO_CREDENTIAL if _KEYS or _SERVICE_JWKS else NO_SOURCE\)/, "pass"]],
    go: [[GO.auth, /refuse\(c, noSource\)/, "c.Next()"]],
  },
  {
    id: "credential-required",
    removes: "the refusal of a request with no credential",
    rules: ["R1"],
    legs: ["jwt"],
    typescript: [[TS.key, /await this\.authGuard\.canActivate\(context\);/, "if (!request.headers.authorization) return true; await this.authGuard.canActivate(context);"]],
    python: [[PY.auth, /ctx = await _require_user\(request\)/, 'ctx = await _require_user(request) if request.headers.get("authorization") else AuthContext()']],
    go: [[GO.auth, /\n\t\tuserAuth\(c\)\n/, '\n\t\tif c.GetHeader("Authorization") == "" {\n\t\t\tsetAuth(c, &AuthContext{Roles: []string{}})\n\t\t\tc.Next()\n\t\t\treturn\n\t\t}\n\t\tuserAuth(c)\n']],
  },
  {
    id: "audience-check",
    removes: "the token audience check",
    rules: ["R2"],
    legs: ["jwt"],
    typescript: [[TS.auth, /audience: AUDIENCES\.length > 0 \? AUDIENCES : undefined,/, ""]],
    python: [[PY.auth, /"verify_aud": bool\(AUDIENCE\)/, '"verify_aud": False']],
    go: [[GO.auth, /if audience != "" \{/, "if false {"]],
  },
  {
    id: "issuer-check",
    removes: "the token issuer check",
    rules: ["R2"],
    legs: ["jwt"],
    typescript: [[TS.auth, /issuer: ISSUER,/, ""]],
    python: [[PY.auth, /issuer=ISSUER,/, ""], [PY.auth, /"require": \["exp", "iss"\], "verify_aud"/, '"require": ["exp"], "verify_iss": False, "verify_aud"']],
    go: [[GO.auth, /jwt\.WithIssuer\(issuer\),/, ""]],
  },
  {
    id: "key-compare",
    removes: "the API key comparison",
    rules: ["R5"],
    legs: ["no-auth"],
    typescript: [[TS.key, /if \(!match\) this\.refuse\(request, WRONG_KEY, "api key not recognised"\);\s*serviceId = match\./, "serviceId = (match ?? digest)."]],
    python: [[PY.auth, /if not matches:\n\s+_refuse\(request, WRONG_KEY\)\n\s+key_id = matches\[0\]/, "key_id = (matches or [digest])[0]"]],
    go: [[GO.auth, /refuse\(c, wrongKey\)\n\s+return nil, true/, 'id = "any"']],
  },
  {
    id: "tenant-filter",
    removes: "the tenant filter on reads",
    rules: ["R6", "R7"],
    legs: ["jwt"],
    typescript: [
      [TS.controllers, /filter: \(req: any\) =>\s*(skipScope\(req\)\s*\?\s*\{\}\s*:)?/g, "filter: (req: any) => true ? {} :"],
      [TS.scope, /request\.query\[`filter\.\$\{scope\.field\}`\] = `\$eq:\$\{scopeValue\}`;/, ""],
      [TS.scope, /const hasAccess = await this\.verifyResourceAccess\(/, "const hasAccess = true || await this.verifyResourceAccess("],
    ],
    python: [[PY.services, /, scope=scope\)/g, ")"]],
    go: [[GO.services, /q = q\.Where\(`CAST\("`\+table\+`"\."`\+col\+`" AS TEXT\) = \?`, v\)/g, "_, _ = table, col"]],
  },
  {
    id: "tenant-filter-not-forced",
    removes: "the forced tenant condition, leaving the tenant as a query filter a caller can add to",
    rules: ["R7"],
    legs: ["jwt"],
    typescript: [[TS.controllers, /filter: \(req: any\) =>\s*(skipScope\(req\)\s*\?\s*\{\}\s*:)?/g, "filter: (req: any) => true ? {} :"]],
  },
  {
    id: "tenant-overwrite",
    removes: "the tenant overwrite on create and update",
    rules: ["R8"],
    legs: ["jwt"],
    typescript: [
      [TS.scope, /request\.body\[scope\.field\] = scopeValue;/, ""],
      [TS.controllers, /persist: \(req: any\) =>\s*(skipScope\(req\)[^?]*\?\s*\{\}\s*:)?/g, "persist: (req: any) => true ? {} :"],
    ],
    python: [[PY.services, /payload\[field\] = value/g, "pass"], [PY.services, /(update|replace)_data\.pop\(field, None\)/g, "pass"]],
    go: [[GO.services, /if err := setFromString\(&item, "\w+", v\); err != nil \{/g, "if err := error(nil); err != nil && v != \"\" {"], [GO.services, /delete\(updates, col\)/g, "_ = col"]],
  },
  {
    id: "no-tenant-refused",
    removes: "the refusal of a user with no tenant",
    rules: ["R9"],
    legs: ["jwt"],
    typescript: [
      [TS.scope, /throw new ForbiddenException\("No tenant in the auth context"\);/g, "return;"],
      [TS.scope, /return false; \/\/ The caller has no tenant, so it owns no scoped rows/, "continue;"],
      [TS.controllers, /filter: \(req: any\) =>\s*(skipScope\(req\)\s*\?\s*\{\}\s*:)?/g, "filter: (req: any) => !req.auth?.workspaceId || skipScope(req) ? {} :"],
    ],
    python: [[PY.services, /(if any\(v in \(None, ""\) for v in values\.values\(\)\):\n\s+)raise HTTPException\([^\n]+\)/g, "$1return {}"]],
    go: [[GO.services, /(if v == "" \{\n\s+)return nil, nil, ErrForbidden/g, "$1return q, nil, nil"]],
  },
  {
    id: "bypass-roles",
    removes: "the limit on which roles skip the tenant scope",
    rules: ["R10"],
    legs: ["jwt"],
    typescript: [
      [TS.scope, /bypassRoles: \[("[^\]]+")\]/g, 'bypassRoles: [$1, "apso-access-no-such-role"]'],
      [TS.controllers, /BYPASS_ROLES: string\[\] = \[("[^\]]+")\]/g, 'BYPASS_ROLES: string[] = [$1, "apso-access-no-such-role"]'],
    ],
    python: [[PY.services, /set\(a\.roles\) & set\(\[("[^\]]+")\]\)/g, 'set(a.roles) & set([$1, "apso-access-no-such-role"])']],
    go: [[GO.services, /hasAnyRole\(a\.Roles, ("[^)]+")\)/g, 'hasAnyRole(a.Roles, $1, "apso-access-no-such-role")']],
  },
  {
    id: "service-caller-scoped-reads",
    removes: "the service caller's exemption from tenant scope on reads",
    rules: ["R10"],
    legs: ["jwt"],
    typescript: [
      [TS.scope, /if \(request\.auth\?\.serviceId\) \{/, 'if (request.auth?.serviceId && request.method !== "GET") {'],
      [TS.controllers, /if \(req\.auth\?\.serviceId\) return true;/g, 'if (req.auth?.serviceId && req.method !== "GET") return true;'],
    ],
    python: [[PY.services, /if a\.service_id:/g, 'if a.service_id and op not in ("find", "get"):']],
    go: [[GO.services, /if a\.ServiceID != "" \{/g, 'if a.ServiceID != "" && op != "find" && op != "get" {']],
  },
  {
    id: "service-caller-unscoped",
    removes: "the service caller's exemption from tenant scope",
    rules: ["R13"],
    legs: ["jwt"],
    typescript: [
      [TS.scope, /if \(request\.auth\?\.serviceId\) \{\s*return true;\s*\}/, ""],
      [TS.controllers, /if \(req\.auth\?\.serviceId\) return true;/g, ""],
    ],
    python: [[PY.services, /if a\.service_id:/g, "if False:"]],
    go: [[GO.services, /if a\.ServiceID != "" \{/g, "if false {"]],
  },
  {
    id: "role-check",
    removes: "the role check on a guarded operation",
    rules: ["R11"],
    legs: ["jwt"],
    typescript: [[TS.permission, /if \(rule && !\(await this\.allowed\(request, rule\)\)\) \{/, "if (false) {"]],
  },
  {
    id: "join-role-check",
    removes: "the role check on a joined entity",
    rules: ["R11"],
    legs: ["jwt"],
    typescript: [[TS.permission, /for \(const joined of JOIN_PERMISSIONS\[relation\] \?\? \[\]\)/, "for (const joined of [] as Rule[])"]],
  },
  {
    id: "grant-tenant",
    removes: "the tenant condition on runtime grants",
    rules: ["R12"],
    legs: ["jwt"],
    typescript: [[TS.permission, /where\.push\(\{ role: In\(roles\), \w+: tenant \}\);/, "where.push({ role: In(roles) });"]],
  },
  {
    id: "failed-key-falls-through",
    removes: "the rule that a failed key is not retried as a user token",
    rules: ["R14"],
    legs: ["jwt"],
    typescript: [[TS.key, /if \(!match\) this\.refuse\(request, WRONG_KEY, "api key not recognised"\);/, "if (!match) return false;"]],
    python: [[PY.auth, /if not matches:\n(\s+)_refuse\(request, WRONG_KEY\)/, "if not matches:\n$1return None"]],
    go: [[GO.auth, /refuse\(c, wrongKey\)\n(\s+)return nil, true/, "return nil, false"]],
  },
  {
    id: "service-token-audience",
    removes: "the check that a service token was issued for this service",
    rules: ["R16"],
    legs: ["no-auth"],
    typescript: [[TS.key, /audience: this\.serviceId,/, ""]],
    python: [[PY.auth, /audience=_SERVICE_ID,\n\s+options=\{"require": \["exp", "iss", "aud", "sub"\]\},/, 'options={"require": ["exp", "iss", "sub"], "verify_aud": False},']],
    go: [[GO.auth, /jwt\.WithAudience\(s\.serviceID\),/, ""]],
  },
  {
    id: "mcp-opt-in",
    removes: "the opt-in for MCP tools (delete on Project becomes a tool)",
    rules: ["R21"],
    legs: ["jwt"],
    typescript: [["src/autogen/Project/Project.controller.ts", /@Override\("deleteOneBase"\)/, '@Override("deleteOneBase")\n  @McpTool({ name: "delete_project", description: "not opted in" })']],
  },
  {
    id: "mcp-token-check",
    removes: "the token check on the MCP endpoint",
    rules: ["R22"],
    legs: ["jwt"],
    typescript: [[TS.key, /verify: \(request: any\) => guard\.authenticate\(request\),/, 'verify: async () => ({ userId: "anyone", roles: [] }),']],
  },
];

/** Rules with no removal, and why. A rule marked enforced must be here or in MUTATIONS. */
export const NOT_BREAKABLE = {
  R23: "A tool call is the REST route run through the app's own HTTP pipeline inside @apso/mcp, a library. The generated service has no separate tool path to remove a check from.",
  R26: "Enforced by `apso generate`, not by generated code. The suite's cases run the CLI; test/lib covers the check itself.",
  R27: "Enforced by `apso generate`, not by generated code. The suite's cases run the CLI; test/lib covers the check itself.",
};

function expand(project, pattern) {
  let dirs = [project];
  for (const segment of pattern.split("/")) {
    const match = new RegExp(`^${segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    dirs = dirs.flatMap((dir) =>
      fs.existsSync(dir) && fs.statSync(dir).isDirectory()
        ? fs.readdirSync(dir).filter((name) => match.test(name)).map((name) => path.join(dir, name))
        : []
    );
  }
  return dirs;
}

/**
 * Apply the mutation named in AUTH_SMOKE_MUTATION to a freshly generated
 * project. Throws when an edit matches nothing: a removal that no longer
 * applies would otherwise pass for the wrong reason.
 */
export function mutate(project, language) {
  const id = process.env.AUTH_SMOKE_MUTATION;
  if (!id) return;
  const mutation = MUTATIONS.find((m) => m.id === id);
  if (!mutation?.[language]) throw new Error(`no mutation "${id}" for ${language}`);
  for (const [pattern, find, replace] of mutation[language]) {
    let changed = 0;
    for (const file of expand(project, pattern)) {
      const before = fs.readFileSync(file, "utf8");
      const after = before.replace(find, replace);
      if (after !== before) {
        fs.writeFileSync(file, after);
        changed += 1;
      }
    }
    if (changed === 0) throw new Error(`MUTATION DID NOT APPLY: "${id}" found nothing to change in ${pattern} (${find})`);
  }
  console.log(`==> mutation "${id}" applied: removed ${mutation.removes}`);
}
