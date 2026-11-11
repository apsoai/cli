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

## Running it

```bash
npm run build
export AUTH_SMOKE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432

node scripts/auth-smoke.mjs typescript
PYTHON=python3.12 node scripts/auth-smoke.mjs python
node scripts/auth-smoke.mjs go
```

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
