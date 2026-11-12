# Access rules

Every generated service follows one numbered list of access rules: who may call, which tenant's rows a caller sees, what a role may do, how API keys and MCP tools behave. The list is tracked in [apsoai/cli#208](https://github.com/apsoai/cli/issues/208).

## Where things live

| What | Where |
|---|---|
| The rule list (id, rule, status per language) | `src/lib/access/rules.json` |
| The cases that follow from a schema | `src/lib/access/cases.ts` |
| The fixed-schema cases and the CI run | `scripts/auth-smoke.mjs` |
| The removals for the break-each-rule job | `scripts/access-mutations.mjs` |
| The owner's command | `apso test access` |

`rules.json` is the only place a rule is written. To correct a rule, edit it there.

## How a rule is proven

The suite talks to a running service over HTTP only, so the same cases prove TypeScript, Python and Go. Each rule has one status per language:

- `enforced`: the service enforces it. The suite must run a case for it.
- `refused`: `apso generate` refuses the feature for that language. The suite must run a case that shows the refusal.
- `pending`: not built yet. `issue` names the work that builds it.
- `na`: does not apply.

Every case label starts with the rule it proves, for example `[R7] Project: or names the other tenant`. A run ends with a table of results per rule. A run fails when a case names no rule, names a rule that is not on the list, or when a rule marked `enforced` or `refused` ran no case. `npm test` checks the same from the source, without starting a service.

## A tenant scope with no tenant claim

`apso generate` and `apso schema validate` print a warning, and still succeed, for each sign-in provider that maps no tenant claim while an entity is tenant-scoped. What is guaranteed is at run time (R9, R27): a token with no tenant gets the "no tenant" 403 on tenant-scoped entities, in every language.

## Relations

The tenant filter limits the entity a request starts from. Which relations a request may load on top of that is one rule, built from one table (`relationScopes` in `src/lib/guards.ts`) and checked in one place per language:

| Language | Where |
|---|---|
| TypeScript | `guards/relations.interceptor.ts`, on every controller after the request is parsed |
| Python | `relation_refused` in `auth.py`, called by the query builder for every relation a request names. Every relation is `lazy="raise"` in the model, so one loads only when a request names it, and a response carries only the relations its query loaded. |
| Go | `RelationLoads` in `middleware/auth.go`, called where the query preloads relations |

A TypeScript service accepts the PostgREST query syntax only, so a relation is loaded there by a `select` embed and by nothing else. Python and Go services accept `join` as well.

A user caller may load a relation onto a tenant-scoped entity when it holds a role that skips that entity's scope, or when it is limited to its tenant on the entity the relation starts from and the target is scoped by the same keys (`Project.tasks`). Any other load answers 403, for `join`, a `select` embed and every nesting depth. A filter or sort on a related entity's field needs the relation loaded, so it meets the same check. A service caller is not limited. In TypeScript the same place checks `permissions.read` of the related entity (R11).

A same-key relation does not rely on the stored foreign key. The rows it loads are limited to the caller's tenant by the target's own `scopeBy` fields: as a condition on the join in TypeScript (so a filter or sort on the related entity's fields, an `!inner` embed and the count in `Content-Range` meet it too), on the relation's own query in Python (`relation_conditions`) and on the preload in Go. A row whose foreign key names another tenant's row, for example one a service caller wrote, loads that relation as empty. The exception is a target scoped through a parent (`project.organizationId`, TypeScript only), which has no tenant column of its own: it counts as same-key only when loaded from that parent through the one relation between the two, and is refused with 403 from anywhere else.

## Writes

The tenant on a write always comes from the caller (R8), and a user caller is limited to its tenant on every operation (R6). No schema option turns either off: `apso generate` and `apso schema validate` refuse `scopeOptions.injectOnCreate` and `scopeOptions.enforceOn`. A caller that must set another tenant or work across tenants is a service caller (API key). The one remaining option, `scopeOptions.bypassRoles`, names roles that skip an entity's scope entirely (R10).

A foreign key in a write body must name a row the caller could read. This holds on create, bulk create, update and replace, for every foreign key that points at a tenant-scoped entity, whether the body sends the column (`projectId`), the relation as an object, or a list under a to-many relation. Otherwise the write is refused with 403, the same answer as for a parent outside the tenant. A key set to null is accepted. A service caller, and a role that skips the target entity's scope, are not checked. Each referenced row is looked up once per request: one lookup per distinct row in TypeScript, one query per referenced entity in Python and Go.

| Language | Where |
|---|---|
| TypeScript | `checkBody` in `guards/scope.guard.ts`, with the same `verifyResourceAccess` lookup that reads by id use |
| Python | `check_references` in `auth.py`, called by each service's create, bulk create, update and replace |
| Go | `CheckReferences` in `middleware/auth.go`, called by each service's create and update |

## Query syntax

A TypeScript service accepts the PostgREST query syntax only. Each nestjsx parameter (`fields`, `filter`, `or`, `join`, `sort`, `s`, `per_page`, `page`, `cache`) and the `X-Crud-Dialect: nestjsx` header get a 400. Python and Go services accept both syntaxes for now.

The suite follows that. Every way a query could reach another tenant's rows is written in PostgREST form, and where it has one in nestjsx form too. The nestjsx forms carry `nestjsx: true` in `cases.ts`. Python and Go run both forms. TypeScript runs the PostgREST forms, and one case per nestjsx parameter that asserts the 400. On TypeScript the suite also checks the count: the total in `Content-Range` under a tenant-scoped caller covers that caller's rows only, for a plain list, a count-only request and a filter that names another tenant.

MCP list tools go through the same routes. The suite checks that a list tool refuses each embed REST refuses, with the same message: 403 for a relation the caller may not load, and on TypeScript 400 for a name that is no embeddable relation, with the list of embeddable relations.

A new case that sends a query needs a PostgREST form. Add a nestjsx form beside it, marked with `nx(...)`, only while Python and Go still accept that syntax.

## Running it

```bash
npm run build
export AUTH_SMOKE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432

node scripts/auth-smoke.mjs typescript
PYTHON=python3.12 node scripts/auth-smoke.mjs python
node scripts/auth-smoke.mjs go
```

To test library builds that are not on npm yet, point `APSO_CRUD_TARBALL`, `APSO_CRUD_CORE_TARBALL`, `APSO_CRUD_REQUEST_TARBALL`, `APSO_CRUD_TYPEORM_TARBALL`, `APSO_POSTGREST_REQUEST_TARBALL`, `APSO_MCP_TARBALL` and `APSO_LOGGING_TARBALL` at `npm pack` output. Each one set replaces that package in the generated TypeScript service.

Add leg names to run part of it: `node scripts/auth-smoke.mjs go generate jwt`.

## Break each rule

A rule is only covered if removing its protection turns a case for that rule red. `scripts/break-each-rule.mjs` generates the service, removes one protection at a time from the generated code (the list is `scripts/access-mutations.mjs`), runs the suite, and fails if any removal goes unnoticed.

```bash
node scripts/break-each-rule.mjs typescript
```

It builds the service once per removal, so it takes several minutes. It runs in CI when the guards or the suite change, weekly, and on demand. Run it before a change to `src/lib/templates/guards`, the Python or Go auth and service templates, or the suite is merged to `main`, because a merge to `main` publishes a release.

A removal edits generated files in the temp project only. Generated services have no switch that turns a protection off.

## Adding a rule or a case

1. Add or correct the rule in `rules.json`.
2. Add cases. A case that depends only on the schema goes in `cases.ts`, so `apso test access` runs it on every owner's project. A case that needs a particular schema or a service restart goes in `auth-smoke.mjs`.
3. Add a removal to `access-mutations.mjs`, or a reason in `NOT_BREAKABLE`.
4. If a language cannot enforce the rule, make `apso generate` refuse the feature for it, set the status to `refused`, and add a case that shows the refusal.

## `apso test access`

Runs the schema-driven cases on a project's own `.apsorc`: its entities, its `scopeBy`, its permissions and its MCP tools. It starts the service the way `apso test smoke` does, signs test tokens with a local issuer using the claim names from the project's `auth` block, and points the service at that issuer through `AUTH_JWT_ISSUER` and `AUTH_JWKS_URI` for the run. It creates one row of each entity for two test tenants and deletes them afterwards.

It prints pass or fail per rule and exits 1 on any failure, so it can gate a deploy. Rules only the hosted platform provides (R15 to R20) are listed as not applicable, with what the platform adds.

Limits:

- Sign-in providers that keep sessions in the database (`better-auth`, `custom-db-session`) cannot be signed in to locally. Only the API key rules run.
- Entities scoped by the caller's user id or email are skipped.
- Python and Go services run on the database in `DATABASE_URL` and need its tables to exist.
