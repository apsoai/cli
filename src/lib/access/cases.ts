/**
 * The access rule cases that follow from a schema: given the entities, their
 * scopeBy, permissions and mcp settings, and a running service, they seed two
 * tenants and check the rules in rules.json over HTTP only. The same cases
 * run in CI against a generated service in each language
 * (scripts/auth-smoke.mjs) and on an owner's own project (`apso test access`).
 */

/* eslint-disable no-await-in-loop */

import { randomUUID } from "crypto";
import pluralize from "pluralize";
import { getScopedEntities, mcpOperations } from "../guards";
import { Entity, EntityPermissions } from "../types/entity";
import { RelationshipMap } from "../types/relationship";
import { kebabCase, snakeCase } from "../utils/casing";
import { getRelationshipIdField, getRelationshipName } from "../utils/relationships/parse";
import { planCrud } from "../verify/crud-plan";
import { Checker, Language } from "./report";
import { Caller } from "./tokens";

type Headers = Record<string, string>;
type Row = Record<string, any>;

export interface Res {
  status: number;
  text: string;
  json?: any;
  /** The Content-Range response header, when the service sent one. */
  range?: string;
}

export async function call(
  method: string,
  url: string,
  { headers = {}, body }: { headers?: Headers; body?: unknown } = {}
): Promise<Res> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, text, json, range: res.headers.get("content-range") ?? undefined };
  } catch (error) {
    return { status: 0, text: String(error) };
  }
}

const rowsOf = (json: any): Row[] => {
  if (Array.isArray(json)) return json;
  const list = json?.data ?? json?.items;
  return Array.isArray(list) ? list : [];
};

/** The total in a Content-Range header: 7 for "0-4/7" and for "*\/7", undefined for "0-4/*" or no header. */
const rangeTotal = (res: Res): number | undefined => {
  const total = /\/(\d+)$/.exec(res.range ?? "")?.[1];
  return total === undefined ? undefined : Number(total);
};

// ---------- the schema, as the cases need it ----------

export interface AccessEntity {
  name: string;
  route: string;
  fields: NonNullable<Entity["fields"]>;
  payload: Row;
  /** Required foreign keys: property -> the entity it points to. */
  parents: { property: string; entity: string }[];
  /** Relations a `join` can name: property -> the entity it loads, and for a many-to-one its foreign key. */
  relations: { property: string; entity: string; fk?: string }[];
  /**
   * The column a caller's rows are limited by: the scopeBy field, or for a
   * path through a parent (project.organizationId) the foreign key to it.
   */
  scope?: { field: string; parent?: string; bypassRoles: string[] };
  permissions?: EntityPermissions;
  /** MCP tool names by operation, for the operations the schema opts in. */
  tools: { list?: string; get?: string; create?: string; update?: string; delete?: string };
}

export interface AccessModel {
  language: Language;
  entities: AccessEntity[];
  /** Entities the cases cannot cover, and why. */
  skipped: { name: string; reason: string }[];
  /** The entity whose id is the tenant id, when scopeBy fields point at one. */
  tenantRoot?: string;
  /** The entity whose rows grant permissions at runtime, when the schema has one. */
  grants?: string;
}

const routeOf = (language: Language, name: string): string => {
  const plural = pluralize(name);
  if (language === "typescript") return `/${plural}`;
  // Go routes are kebab-case (/api/role-permissions).
  return `/api/${language === "go" ? kebabCase(plural) : plural.toLowerCase()}`;
};

/**
 * Describe a schema for the cases.
 * @param {Entity[]} entities - The .apsorc entities
 * @param {RelationshipMap} relationships - The parsed relationships
 * @param {Language} language - The service's language
 * @param {object} [auth] - The .apsorc auth block, if any
 * @returns {AccessModel} The schema as the cases use it
 */
export function buildModel(
  entities: Entity[],
  relationships: RelationshipMap,
  language: Language,
  auth?: { permissionEntity?: string }
): AccessModel {
  const plan = planCrud(entities, relationships);
  const skipped = [...plan.skipped];
  const scoped = auth ? getScopedEntities(entities, relationships) : [];
  let tenantRoot: string | undefined;

  const model = plan.order.map((planned): AccessEntity => {
    const entity = entities.find((e) => e.name === planned.name)!;
    const relations = (relationships[entity.name] ?? []).map((r) => ({
      property:
        r.type === "OneToMany" || r.type === "ManyToMany"
          ? pluralize(getRelationshipName(r))
          : getRelationshipName(r),
      entity: r.name,
      ...(r.type === "ManyToOne" ? { fk: getRelationshipIdField(r) } : {}),
    }));
    const config = scoped.find((s) => s.name === entity.name);
    const direct = config?.scopes.find(
      (s) => s.direct && s.contextKey !== "userId" && s.contextKey !== "email"
    );
    // Only TypeScript enforces a path through a parent; Python and Go refuse it at generate.
    const nested = language === "typescript" ? config?.scopes.find((s) => s.fkField) : undefined;
    let scope: AccessEntity["scope"];
    if (config && direct) {
      scope = { field: direct.field, bypassRoles: config.bypassRoles };
      const parent = (relationships[entity.name] ?? []).find(
        (r) => r.type !== "OneToMany" && r.type !== "ManyToMany" && getRelationshipIdField(r) === direct.field
      );
      tenantRoot = tenantRoot ?? parent?.name;
    } else if (config && nested) {
      scope = { field: nested.fkField!, parent: nested.parentEntity, bypassRoles: config.bypassRoles };
    } else if (config) {
      skipped.push({ name: entity.name, reason: "its scopeBy is the caller's user id or email, which these cases do not cover" });
    }
    const ops = mcpOperations(entity);
    const one = snakeCase(entity.name);
    return {
      name: entity.name,
      route: routeOf(language, entity.name),
      fields: entity.fields ?? [],
      payload: planned.payload,
      parents: planned.parents,
      relations,
      scope,
      permissions: auth ? entity.permissions : undefined,
      tools: {
        ...(ops.includes("read") ? { list: `list_${snakeCase(pluralize(entity.name))}`, get: `get_${one}` } : {}),
        ...(ops.includes("create") ? { create: `create_${one}` } : {}),
        ...(ops.includes("update") ? { update: `update_${one}` } : {}),
        ...(ops.includes("delete") ? { delete: `delete_${one}` } : {}),
      },
    };
  });
  const grants = auth?.permissionEntity ?? "RolePermission";
  return {
    language,
    entities: model,
    skipped,
    tenantRoot,
    grants: model.some((e) => e.name === grants && e.permissions) ? grants : undefined,
  };
}

// ---------- the running service ----------

export interface McpClient {
  listTools(): Promise<string[]>;
  /** The tool's JSON answer, or undefined with `error` set when the call is refused. */
  callTool(name: string, args: Row): Promise<{ json?: any; error?: string }>;
}

export interface AccessContext {
  base: string;
  model: AccessModel;
  t: Checker;
  /** A valid API key. The cases seed both tenants with it and read back what was stored. */
  key: Headers;
  /** Headers for a signed-in user. Leave out when the service has no sign-in. */
  user?: (caller?: Caller) => Headers;
  /** True when a user token can carry roles. */
  roles?: boolean;
  /** Tokens the service must refuse. */
  badTokens?: { label: string; headers: Headers }[];
  /** Connect to the service's MCP endpoint with these headers. Leave out to skip the MCP cases. */
  mcp?: (headers: Headers) => Promise<McpClient>;
  log?: (line: string) => void;
  /** Told about answers that are not leaks but are still wrong, such as a 500 for a query the service should refuse. */
  warn?: (line: string) => void;
}

interface Tenant {
  value: string;
  rows: Record<string, Row>;
}

const TEXT = new Set(["text", "string", "varchar"]);

/** A create body for the nth row of an entity: text values differ per row so unique fields do not collide. */
function payloadFor(entity: AccessEntity, n: number): Row {
  const body: Row = { ...entity.payload };
  for (const field of entity.fields) {
    const value = body[field.name];
    if (typeof value !== "string") continue;
    if (field.is_email) body[field.name] = `access${n}@example.com`;
    else if (TEXT.has(field.type as string)) body[field.name] = `${value.slice(0, -1)}${n}`;
  }
  return body;
}

/** A tenant id of the scope column's type, for a schema with no tenant entity. */
function syntheticTenant(model: AccessModel, n: number): string {
  for (const entity of model.entities) {
    if (!entity.scope || entity.scope.parent) continue;
    const type = entity.fields.find((f) => f.name === entity.scope!.field)?.type as string | undefined;
    if (type === "uuid") return randomUUID();
    if (type && TEXT.has(type)) return `apso-access-${n}`;
    break;
  }
  return String(910_000 + n);
}

const asColumn = (entity: AccessEntity, value: string): unknown => {
  const type = entity.fields.find((f) => f.name === entity.scope?.field)?.type as string | undefined;
  return type && (TEXT.has(type) || type === "uuid") ? value : /^\d+$/.test(value) ? Number(value) : value;
};

/** Create one row of every entity for each of two tenants, as a service caller. */
async function seed(ctx: AccessContext): Promise<Tenant[]> {
  const { model, base, key } = ctx;
  const tenants: Tenant[] = [];
  for (const n of [1, 2]) {
    const tenant: Tenant = { value: "", rows: {} };
    for (const entity of model.entities) {
      const body = payloadFor(entity, n);
      const missing = entity.parents.find((p) => !tenant.rows[p.entity]);
      if (missing) {
        ctx.log?.(`  skip ${entity.name}: needs a ${missing.entity} row, which could not be created`);
        continue;
      }
      for (const parent of entity.parents) body[parent.property] = tenant.rows[parent.entity].id;
      if (entity.scope?.parent) {
        if (!tenant.rows[entity.scope.parent]) continue;
        body[entity.scope.field] = tenant.rows[entity.scope.parent].id;
      } else if (entity.scope) {
        if (!tenant.value) {
          const root = model.tenantRoot && tenant.rows[model.tenantRoot];
          tenant.value = root ? String(root.id) : model.tenantRoot ? "" : syntheticTenant(model, n);
        }
        if (!tenant.value) {
          ctx.log?.(`  skip ${entity.name}: its tenant (${model.tenantRoot}) is created after it`);
          continue;
        }
        body[entity.scope.field] = asColumn(entity, tenant.value);
      }
      const created = await call("POST", base + entity.route, { headers: key, body });
      if ([200, 201].includes(created.status) && created.json?.id !== undefined) tenant.rows[entity.name] = created.json;
      else ctx.log?.(`  skip ${entity.name}: could not create a row (${created.status} ${created.text.slice(0, 200)})`);
    }
    if (!tenant.value) {
      const root = model.tenantRoot && tenant.rows[model.tenantRoot];
      tenant.value = root ? String(root.id) : syntheticTenant(model, n);
    }
    tenants.push(tenant);
  }
  return tenants;
}

/**
 * The other tenant's rows in a response: every object of a scoped entity,
 * at the top or under a joined relation, whose id is one the other tenant owns.
 */
function foreignRows(
  model: AccessModel,
  entityName: string,
  value: unknown,
  theirs: Record<string, Row>,
  depth = 0
): string[] {
  return rowsWhere(model, entityName, value, (entity, row) => {
    const other = theirs[entity.name];
    return Boolean(entity.scope && other && row.id !== undefined && String(row.id) === String(other.id));
  }, depth);
}

/** The alias the embed cases give a relation (select=x_projects:projects(*)). */
const alias = (property: string) => `x_${property}`;

/** Every row in a response, at the top or under a relation (by its name or the alias above), that `hit` picks. */
function rowsWhere(
  model: AccessModel,
  entityName: string,
  value: unknown,
  hit: (entity: AccessEntity, row: Row) => boolean,
  depth = 0
): string[] {
  if (value === null || typeof value !== "object" || depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((v) => rowsWhere(model, entityName, v, hit, depth));
  const entity = model.entities.find((e) => e.name === entityName);
  if (!entity) return [];
  const row = value as Row;
  const found: string[] = hit(entity, row) ? [`${entityName} ${row.id ?? ""}`.trim()] : [];
  for (const relation of entity.relations)
    for (const key of [relation.property, alias(relation.property)])
      found.push(...rowsWhere(model, relation.entity, row[key], hit, depth + 1));
  return found;
}

const POSTGREST = { "x-crud-dialect": "postgrest" };

/** A TypeScript service accepts the PostgREST query syntax only; Python and Go still accept nestjsx as well. */
const postgrestOnly = (model: AccessModel): boolean => model.language === "typescript";

/**
 * The forms a service of this language parses. Where nestjsx is refused its
 * forms are left out: each has a PostgREST form beside it, and the refusal
 * itself is proven once per parameter by nestjsxRefused.
 */
const forms = <T extends { nestjsx?: boolean }>(model: AccessModel, list: T[]): T[] =>
  postgrestOnly(model) ? list.filter((item) => !item.nestjsx) : list;

/**
 * Every way a request can load `relation` of `entity` (and, one step further,
 * each relation of that): the join parameter, and select embeds with and
 * without the dialect header, with chosen columns, and under an alias.
 */
function relationLoads(model: AccessModel, relation: AccessEntity["relations"][number], nested = true): Attempt[] {
  const p = relation.property;
  const out: Attempt[] = [
    nx(`join ${p}`, `join=${enc(p)}`),
    nx(`join ${p} with chosen fields`, `join=${enc(`${p}||id`)}`),
    { name: `select embed ${p}`, query: `select=${enc(`*,${p}(*)`)}`, headers: POSTGREST },
    { name: `select embed ${p}, no dialect header`, query: `select=${enc(`*,${p}(*)`)}` },
    { name: `select embed ${p} with chosen columns, no dialect header`, query: `select=${enc(`id,${p}(id)`)}` },
    { name: `select embed ${p} under an alias`, query: `select=${enc(`*,${alias(p)}:${p}(*)`)}` },
    { name: `select embed ${p} with an inner join hint`, query: `select=${enc(`*,${p}!inner(*)`)}` },
  ];
  if (!nested) return forms(model, out);
  for (const second of model.entities.find((e) => e.name === relation.entity)?.relations ?? []) {
    const q = second.property;
    out.push(
      nx(`join ${p}.${q}`, `join=${enc(p)}&join=${enc(`${p}.${q}`)}`),
      nx(`join ${p}.${q} without joining ${p}`, `join=${enc(`${p}.${q}`)}`),
      { name: `select embed ${p}(${q})`, query: `select=${enc(`*,${p}(*,${q}(*))`)}`, headers: POSTGREST },
      { name: `select embed ${p}(${q}), no dialect header`, query: `select=${enc(`id,${p}(id,${q}(*))`)}` },
      { name: `select embed ${p}(${q}) under aliases`, query: `select=${enc(`*,${alias(p)}:${p}(*,${alias(q)}:${q}(*))`)}` }
    );
  }
  return forms(model, out);
}

/** A field of an entity's seeded row to test for through a relation, and a value no row has. */
function probe(entity: AccessEntity, row: Row): { field: string; value: string; absent: string } {
  const field = Object.keys(entity.payload).find((k) => typeof row[k] === "string" && row[k] !== "") ?? "id";
  return { field, value: String(row[field]), absent: field === "id" ? "987654321" : "apso-access-absent" };
}

/** A value less its last character, for a "starts with" filter. */
const start = (v: string) => v.slice(0, Math.max(1, v.length - 1));

/**
 * Filters on a field of a related entity the caller cannot read. If the
 * filter matches for the real value and not for a value no row has, the
 * caller can learn the field one guess at a time without ever being sent it.
 * With `through`, the caller may read related rows of its own that match the
 * same filter, so only an answer that holds that row (the one whose relation
 * points at the row the caller cannot read) counts.
 */
async function oracle(model: AccessModel, url: string, headers: Headers, property: string, target: AccessEntity, row: Row, through?: Row): Promise<string> {
  const { field, value, absent } = probe(target, row);
  const tries: { name: string; query: (v: string) => string; extra?: Headers; nestjsx?: boolean }[] = [
    { name: "filter", query: (v) => `filter=${f(`${property}.${field}`, "$eq", v)}`, nestjsx: true },
    { name: "filter with join", query: (v) => `join=${enc(property)}&filter=${f(`${property}.${field}`, "$eq", v)}`, nestjsx: true },
    { name: "filter $starts", query: (v) => `filter=${f(`${property}.${field}`, "$starts", start(v))}`, nestjsx: true },
    { name: "s search", query: (v) => `s=${enc(JSON.stringify({ [`${property}.${field}`]: num(v) }))}`, nestjsx: true },
    { name: "postgrest filter", query: (v) => `${property}.${field}=${enc(`eq.${v}`)}`, extra: POSTGREST },
    { name: "postgrest inner embed filter", query: (v) => `select=${enc(`id,${property}!inner(id)`)}&${property}.${field}=${enc(`eq.${v}`)}` },
    { name: "postgrest inner embed filter, like", query: (v) => `select=${enc(`id,${property}!inner(id)`)}&${property}.${field}=${enc(`like.${start(v)}*`)}` },
    { name: "postgrest inner embed filter, in", query: (v) => `select=${enc(`id,${property}!inner(id)`)}&${property}.${field}=${enc(`in.(${v})`)}` },
  ];
  const leaks: string[] = [];
  for (const { name, query, extra } of forms(model, tries)) {
    const real = await call("GET", `${url}?${query(value)}`, { headers: { ...headers, ...extra } });
    if (real.status !== 200 || rowsOf(real.json).length === 0) continue;
    if (through && !rowsOf(real.json).some((r: Row) => String(r.id) === String(through.id))) continue;
    // "$starts" of a value no row has, cut the same way, still matches nothing.
    const none = await call("GET", `${url}?${query(absent)}`, { headers: { ...headers, ...extra } });
    if (none.status === 200 && rowsOf(none.json).length === 0) leaks.push(`${name}: ?${query(value)}`);
  }
  return leaks.join("; ");
}

// ---------- R7: ways a query tries to reach another tenant ----------

interface Attempt {
  name: string;
  /** The query string, already encoded as it should go on the wire. */
  query: string;
  headers?: Headers;
  /** True for nestjsx syntax, which a PostgREST-only service refuses with a 400. */
  nestjsx?: boolean;
}

/** An attempt in nestjsx syntax. */
const nx = (name: string, query: string): Attempt => ({ name, query, nestjsx: true });

const enc = encodeURIComponent;
/** A token claim is text; a numeric column is filtered as a number in JSON. */
const num = (v: string): unknown => (/^\d+$/.test(v) ? Number(v) : v);
/** One nestjsx-style condition, field||operator||value, encoded. */
const f = (...parts: string[]) => enc(parts.join("||"));

/**
 * Query strings a caller of one tenant would try in order to read another
 * tenant's rows of `entity`: both query dialects, nested and encoded forms.
 * `mine` and `theirs` are the two tenants' values of the scope column and
 * `theirId` is the id of the other tenant's row. Every nestjsx attempt has a
 * PostgREST form in the list; a PostgREST-only service runs only those.
 */
function widenAttempts(model: AccessModel, entity: AccessEntity, mine: string, theirs: string, theirId: string): Attempt[] {
  const col = entity.scope!.field;
  const s = (o: unknown) => `s=${enc(JSON.stringify(o))}`;
  const postgrest = POSTGREST;
  const out: Attempt[] = [
    // filter
    nx("filter names the other tenant", `filter=${f(col, "$eq", theirs)}`),
    nx("filter $in lists both tenants", `filter=${f(col, "$in", `${mine},${theirs}`)}`),
    nx("filter $ne excludes the caller's tenant", `filter=${f(col, "$ne", mine)}`),
    nx("filter $notnull on the tenant column", `filter=${f(col, "$notnull")}`),
    nx("filter by the other tenant's row id", `filter=${f("id", "$eq", theirId)}`),
    nx("filter sent twice (own tenant, then the other)", `filter=${f(col, "$eq", mine)}&filter=${f(col, "$eq", theirs)}`),
    nx("filter as an array parameter", `filter[]=${f(col, "$eq", theirs)}`),
    nx("filter as an indexed array parameter", `filter[0]=${f(col, "$eq", theirs)}&filter[1]=${f("id", "$eq", theirId)}`),
    nx("filter with unencoded separators", `filter=${col}||$eq||${theirs}`),
    nx("filter double-encoded", `filter=${enc(f(col, "$eq", theirs))}`),
    nx("filter on the column's snake_case name", `filter=${f(snakeCase(col), "$eq", theirs)}`),
    nx("filter on the column in upper case", `filter=${f(col.toUpperCase(), "$eq", theirs)}`),
    { name: "the guard's own filter key", query: `filter.${col}=${enc(`$eq:${theirs}`)}` },
    { name: "the guard's own filter key, sent twice", query: `filter.${col}=${enc(`$eq:${theirs}`)}&filter.${col}=${enc(`$eq:${theirs}`)}` },
    nx("filter as a nested object parameter", `filter[${col}]=${enc(theirs)}`),
    // or
    nx("or names the other tenant", `or=${f(col, "$eq", theirs)}`),
    nx("filter own tenant, or the other", `filter=${f(col, "$eq", mine)}&or=${f(col, "$eq", theirs)}`),
    nx("two or conditions", `or=${f(col, "$eq", theirs)}&or=${f("id", "$eq", theirId)}`),
    nx("filter and or by the other tenant's row id", `filter=${f("id", "$eq", theirId)}&or=${f("id", "$eq", theirId)}`),
    nx("or matching every row", `or=${f("id", "$notnull")}&or=${f("id", "$isnull")}`),
    nx("or as an array parameter", `or[]=${f(col, "$eq", theirs)}&or[]=${f("id", "$eq", theirId)}`),
    // s (JSON search)
    nx("s names the other tenant", s({ [col]: num(theirs) })),
    nx("s $or of both tenants", s({ $or: [{ [col]: num(mine) }, { [col]: num(theirs) }] })),
    nx("s $or of the other tenant and its row id", s({ $or: [{ [col]: num(theirs) }, { id: num(theirId) }] })),
    nx("s $ne the caller's tenant", s({ [col]: { $ne: num(mine) } })),
    nx("s $in both tenants", s({ [col]: { $in: [num(mine), num(theirs)] } })),
    nx("s $or nested in $and", s({ $and: [{ $or: [{ [col]: num(theirs) }, { id: { $notnull: true } }] }] })),
    nx("s $or nested in $or", s({ $or: [{ $or: [{ [col]: num(theirs) }] }, { $and: [{ id: num(theirId) }] }] })),
    nx("s by the other tenant's row id", s({ id: num(theirId) })),
    nx("s $or inside the column's condition", s({ [col]: { $or: { $eq: num(theirs), $notnull: true } } })),
    nx("s as a nested object parameter", `s[${col}]=${enc(theirs)}`),
    nx("s double-encoded", `s=${enc(enc(JSON.stringify({ [col]: num(theirs) })))}`),
    nx("s with filter and or together", `${s({ [col]: num(theirs) })}&filter=${f(col, "$eq", theirs)}&or=${f(col, "$eq", theirs)}`),
    // sort and pagination
    nx("sort by tenant descending, first row only", `sort=${enc(`${col},DESC`)}&limit=1`),
    nx("sort by tenant ascending, first row only", `sort=${enc(`${col},ASC`)}&limit=1`),
    nx("sort by id, a very large page", `sort=${enc("id,DESC")}&limit=100000`),
    { name: "limit 0", query: "limit=0" },
    { name: "negative limit", query: "limit=-1" },
    nx("second page", "limit=1&page=2"),
    { name: "offset past the caller's rows", query: "limit=100&offset=1" },
    { name: "negative offset", query: "offset=-1" },
    nx("per_page and take", "per_page=1000&take=1000"),
    nx("fields limited to the tenant column", `fields=${enc(col)}`),
    nx("cache off", "cache=0"),
    // the PostgREST dialect
    { name: "postgrest: column eq the other tenant", query: `${col}=${enc(`eq.${theirs}`)}`, headers: postgrest },
    { name: "postgrest: column eq, dialect inferred", query: `${col}=${enc(`eq.${theirs}`)}` },
    { name: "postgrest: column in both tenants", query: `${col}=${enc(`in.(${mine},${theirs})`)}`, headers: postgrest },
    { name: "postgrest: column neq the caller's tenant", query: `${col}=${enc(`neq.${mine}`)}`, headers: postgrest },
    { name: "postgrest: not.eq the caller's tenant", query: `${col}=${enc(`not.eq.${mine}`)}`, headers: postgrest },
    { name: "postgrest: id eq the other tenant's row", query: `id=${enc(`eq.${theirId}`)}`, headers: postgrest },
    { name: "postgrest: or group", query: `or=${enc(`(${col}.eq.${theirs},id.eq.${theirId})`)}`, headers: postgrest },
    { name: "postgrest: or group, dialect inferred", query: `or=${enc(`(${col}.eq.${theirs},id.eq.${theirId})`)}` },
    { name: "postgrest: and group", query: `and=${enc(`(${col}.eq.${theirs})`)}`, headers: postgrest },
    { name: "postgrest: not.and of the caller's tenant", query: `not.and=${enc(`(${col}.eq.${mine})`)}`, headers: postgrest },
    { name: "postgrest: or nested in and", query: `and=${enc(`(or(${col}.eq.${theirs},id.eq.${theirId}))`)}`, headers: postgrest },
    { name: "postgrest: order by tenant, first row", query: `order=${enc(`${col}.desc`)}&limit=1`, headers: postgrest },
    { name: "postgrest: offset", query: "limit=100&offset=1", headers: postgrest },
    { name: "postgrest: select all", query: `select=${enc("*")}`, headers: postgrest },
    { name: "postgrest: Range header", query: "", headers: { ...postgrest, range: "0-999", prefer: "count=exact" } },
    // the PostgREST form of each nestjsx attempt above that had none
    { name: "postgrest: tenant column is not null", query: `${col}=${enc("not.is.null")}` },
    { name: "postgrest: tenant column is.not_null", query: `${col}=${enc("is.not_null")}` },
    { name: "postgrest: column filter sent twice (own tenant, then the other)", query: `${col}=${enc(`eq.${mine}`)}&${col}=${enc(`eq.${theirs}`)}` },
    { name: "postgrest: column filter sent twice (the other tenant, then own)", query: `${col}=${enc(`eq.${theirs}`)}&${col}=${enc(`eq.${mine}`)}` },
    { name: "postgrest: column filter as an array parameter", query: `${col}[]=${enc(`eq.${theirs}`)}` },
    { name: "postgrest: column filter as an indexed array parameter", query: `${col}[0]=${enc(`eq.${theirs}`)}&${col}[1]=${enc(`eq.${theirs}`)}` },
    { name: "postgrest: column filter as a nested object parameter", query: `${col}[eq]=${enc(theirs)}` },
    { name: "postgrest: or group with unencoded separators", query: `or=(${col}.eq.${theirs},id.eq.${theirId})` },
    { name: "postgrest: or group double-encoded", query: `or=${enc(enc(`(${col}.eq.${theirs},id.eq.${theirId})`))}` },
    { name: "postgrest: column filter on the snake_case name", query: `${snakeCase(col)}=${enc(`eq.${theirs}`)}` },
    { name: "postgrest: column filter on the name in upper case", query: `${col.toUpperCase()}=${enc(`eq.${theirs}`)}` },
    { name: "postgrest: filter own tenant, or group the other", query: `${col}=${enc(`eq.${mine}`)}&or=${enc(`(${col}.eq.${theirs})`)}` },
    { name: "postgrest: or group of both tenants", query: `or=${enc(`(${col}.eq.${mine},${col}.eq.${theirs})`)}` },
    { name: "postgrest: or group matching every row", query: `or=${enc("(id.not.is.null,id.is.null)")}` },
    { name: "postgrest: or group as an array parameter", query: `or[]=${enc(`(${col}.eq.${theirs})`)}&or[]=${enc(`(id.eq.${theirId})`)}` },
    { name: "postgrest: or nested in or", query: `or=${enc(`(or(${col}.eq.${theirs}),and(id.eq.${theirId}))`)}` },
    { name: "postgrest: negated condition in an or group", query: `or=${enc(`(${col}.not.eq.${mine},id.eq.${theirId})`)}` },
    { name: "postgrest: column filter with or and and groups together", query: `${col}=${enc(`eq.${theirs}`)}&or=${enc(`(${col}.eq.${theirs})`)}&and=${enc(`(${col}.eq.${theirs})`)}` },
    { name: "postgrest: order by tenant ascending, first row", query: `order=${enc(`${col}.asc`)}&limit=1` },
    { name: "postgrest: order by id, a very large page", query: `order=${enc("id.desc")}&limit=100000` },
    { name: "postgrest: second page", query: "limit=1&offset=1" },
    { name: "postgrest: select limited to the tenant column", query: `select=${enc(col)}` },
    { name: "postgrest: count of both tenants", query: `${col}=${enc(`in.(${mine},${theirs})`)}`, headers: { prefer: "count=exact" } },
    { name: "postgrest: count only, the other tenant", query: `${col}=${enc(`eq.${theirs}`)}&limit=0`, headers: { prefer: "count=exact" } },
    { name: "postgrest: count with an or group of both tenants", query: `or=${enc(`(${col}.eq.${mine},${col}.eq.${theirs})`)}`, headers: { prefer: "count=exact" } },
  ];
  // every way to load a relation, and every relation of those
  for (const relation of entity.relations) {
    out.push(
      ...relationLoads(model, relation),
      nx(`join ${relation.property} with a filter on it`, `join=${enc(relation.property)}&filter=${f(`${relation.property}.id`, "$notnull")}&or=${f(`${relation.property}.id`, "$isnull")}`),
      nx(`sort by a field of ${relation.property}`, `join=${enc(relation.property)}&sort=${enc(`${relation.property}.id,DESC`)}&limit=1`),
      { name: `select embed ${relation.property} with a filter on it`, query: `select=${enc(`*,${relation.property}(*)`)}&${relation.property}.id=${enc("not.is.null")}` },
      { name: `select inner embed ${relation.property} with a filter on it`, query: `select=${enc(`*,${relation.property}!inner(*)`)}&${relation.property}.id=${enc("not.is.null")}` },
      { name: `select inner embed ${relation.property} with a filter on it and a count`, query: `select=${enc(`id,${relation.property}!inner(id)`)}&${relation.property}.id=${enc("not.is.null")}`, headers: { prefer: "count=exact" } },
      { name: `order by a field of ${relation.property}`, query: `select=${enc(`*,${relation.property}(id)`)}&order=${enc(`${relation.property}(id).desc`)}&limit=1` }
    );
  }
  return forms(model, out);
}

/** A list answer is clean when it is refused, or holds none of the other tenant's rows and no more rows than the caller owns. */
function widened(model: AccessModel, entity: AccessEntity, res: Res, theirs: Record<string, Row>, own: number): string {
  // Refused. A 5xx returned no rows either: it is a defect, reported as a warning, not a leak.
  if (res.status >= 400) return "";
  // 206 is a page of a longer list (PostgREST).
  if (res.status !== 200 && res.status !== 206) return `status ${res.status} ${res.text.slice(0, 200)}`;
  // A list answers with an envelope or a bare array; a read by id with the row.
  const isList = Array.isArray(res.json) || Array.isArray(res.json?.data) || Array.isArray(res.json?.items);
  const leaked = foreignRows(model, entity.name, isList ? rowsOf(res.json) : res.json, theirs);
  if (leaked.length > 0) return `returned another tenant's rows: ${[...new Set(leaked)].join(", ")}`;
  const n = rowsOf(res.json).length;
  // The total a list reports: in the nestjsx envelope, or in Content-Range.
  const total = typeof res.json?.total === "number" ? res.json.total : rangeTotal(res) ?? n;
  if (entity.scope && (n > own || total > own)) return `returned ${n} rows (total ${total}); the caller owns ${own}`;
  return "";
}

// ---------- the cases ----------

async function whoIsCalling(ctx: AccessContext): Promise<void> {
  const { base, model, t, key } = ctx;
  t.expect("[R1] /health is public", await call("GET", `${base}/health`), 200);
  for (const entity of model.entities)
    t.expect(`[R1] ${entity.name}: no credential`, await call("GET", base + entity.route), 401);
  const first = model.entities[0];
  if (!first) return;
  for (const bad of ctx.badTokens ?? [])
    t.expect(`[R2] ${bad.label}`, await call("GET", base + first.route, { headers: bad.headers }), 401);
  t.expect("[R5] a key that is not the service's key", await call("GET", base + first.route, { headers: { "x-api-key": "apso-access-wrong-key" } }), 401);
  t.expect("[R13] the service's key is a service caller", await call("GET", base + first.route, { headers: key }), 200);
  if (ctx.user)
    t.expect("[R14] a wrong key is refused even with a valid user token", await call("GET", base + first.route, { headers: { ...ctx.user({ tenant: "1" }), "x-api-key": "apso-access-wrong-key" } }), 401);
}

/**
 * The roles the test callers hold: every role a permissions list names, so a
 * role check does not hide a tenant check. Bypass roles are left out.
 */
function callerRoles(model: AccessModel): string[] {
  const bypass = new Set(model.entities.flatMap((e) => e.scope?.bypassRoles ?? []));
  return [...new Set(model.entities.flatMap((e) => Object.values(e.permissions ?? {}).flat()))].filter((r) => !bypass.has(r as string)) as string[];
}

/** True for the 400 a PostgREST-only service gives a nestjsx parameter: it names the parameter. */
const refused = (res: Res, parameter: string) =>
  res.status === 400 && typeof res.json?.message === "string" && res.json.message.includes(`'${parameter}'`) && /PostgREST/.test(res.json.message);

/**
 * A PostgREST-only service answers 400 to each nestjsx query parameter and
 * says what to send instead. One case per parameter: the forms left out by
 * forms() above are all spelled with these.
 */
async function nestjsxRefused(ctx: AccessContext): Promise<void> {
  const { base, model, t, key } = ctx;
  const entity = model.entities.find((e) => e.scope) ?? model.entities[0];
  if (!entity) return;
  const url = base + entity.route;
  const relation = entity.relations[0]?.property ?? "x";
  const parameters: [string, string][] = [
    ["fields", "id"],
    ["filter", "id||$notnull"],
    ["or", "id||$notnull"],
    ["join", relation],
    ["sort", "id,DESC"],
    ["s", JSON.stringify({ id: { $notnull: true } })],
    ["per_page", "1000"],
    ["page", "1"],
    ["cache", "0"],
  ];
  for (const [parameter, value] of parameters) {
    const res = await call("GET", `${url}?${parameter}=${enc(value)}`, { headers: key });
    t.assert(`[R7] ${entity.name}: the nestjsx parameter ${parameter} is refused with a 400 that names it`, refused(res, parameter), `${res.status} ${res.text.slice(0, 300)}`);
  }
  const array = await call("GET", `${url}?filter[]=${enc("id||$notnull")}`, { headers: key });
  t.assert(`[R7] ${entity.name}: a nestjsx parameter sent as an array is refused with a 400`, refused(array, "filter"), `${array.status} ${array.text.slice(0, 300)}`);
  const byId = await call("GET", `${url}/1?join=${enc(relation)}`, { headers: key });
  t.assert(`[R7] ${entity.name}: a nestjsx parameter on a read by id is refused with a 400`, refused(byId, "join"), `${byId.status} ${byId.text.slice(0, 300)}`);
  t.expect(`[R7] ${entity.name}: the X-Crud-Dialect: nestjsx header is refused with a 400`, await call("GET", url, { headers: { ...key, "x-crud-dialect": "nestjsx" } }), 400);
  const user = ctx.user?.({ tenant: "1", roles: callerRoles(model) });
  if (user) t.expect(`[R7] ${entity.name}: a nestjsx parameter from a signed-in caller is refused with a 400`, await call("GET", `${url}?filter=${enc("id||$notnull")}`, { headers: user }), 400);
  const plain = await call("GET", `${url}?limit=1`, { headers: key });
  t.assert(`[R7] ${entity.name}: a list is a JSON array with a Content-Range header`, plain.status === 200 && Array.isArray(plain.json) && /^(\d+-\d+|\*)\/(\d+|\*)$/.test(plain.range ?? ""), `${plain.status} Content-Range ${plain.range} ${plain.text.slice(0, 200)}`);
}

async function tenantScope(ctx: AccessContext, entity: AccessEntity, a: Tenant, b: Tenant, asA: Headers): Promise<void> {
  const { base, model, t, key } = ctx;
  const url = base + entity.route;
  const mine = a.rows[entity.name];
  const other = b.rows[entity.name];
  const col = entity.scope!.field;
  const [mineValue, theirValue] = [String(mine[col]), String(other[col])];
  const n = entity.name;

  // R6
  const plain = await call("GET", url, { headers: asA });
  const own = rowsOf(plain.json);
  t.assert(`[R6] ${n}: a caller lists its own row and not the other tenant's`, plain.status === 200 && own.some((r) => String(r.id) === String(mine.id)) && !own.some((r) => String(r.id) === String(other.id)), `${plain.status} ${plain.text.slice(0, 200)}`);
  const ownCount = typeof plain.json?.total === "number" ? plain.json.total : own.length;
  t.expect(`[R6] ${n}: read another tenant's row by id`, await call("GET", `${url}/${other.id}`, { headers: asA }), 403, 404);
  t.expect(`[R6] ${n}: update another tenant's row`, await call("PATCH", `${url}/${other.id}`, { headers: asA, body: payloadFor(entity, 7) }), 403, 404);
  t.expect(`[R6] ${n}: replace another tenant's row`, await call("PUT", `${url}/${other.id}`, { headers: asA, body: payloadFor(entity, 7) }), 403, 404, 405);
  t.expect(`[R6] ${n}: delete another tenant's row`, await call("DELETE", `${url}/${other.id}`, { headers: asA }), 403, 404);
  const still = await call("GET", `${url}/${other.id}`, { headers: key });
  t.assert(`[R6] ${n}: the other tenant's row is unchanged after those attempts`, still.status === 200 && [col, ...Object.keys(entity.payload)].every((k) => JSON.stringify(still.json?.[k]) === JSON.stringify(other[k])), `${still.status} ${still.text.slice(0, 200)}`);
  const all = await call("GET", `${url}?limit=1000`, { headers: key });
  t.assert(`[R10] ${n}: a service caller lists both tenants' rows`, all.status === 200 && [mine, other].every((row) => rowsOf(all.json).some((r) => String(r.id) === String(row.id))), `${all.status} ${all.text.slice(0, 200)}`);

  // R7
  const harmless = await call("GET", `${url}?select=${enc("*")}`, { headers: { ...asA, ...POSTGREST } });
  if (harmless.status >= 400)
    ctx.warn?.(`${n}: a harmless PostgREST-dialect request (select=*) answered ${harmless.status}, so the PostgREST cases on this entity were refused before they could test the tenant filter`);
  for (const attempt of widenAttempts(model, entity, mineValue, theirValue, String(other.id))) {
    const res = await call("GET", attempt.query ? `${url}?${attempt.query}` : url, { headers: { ...asA, ...attempt.headers } });
    if (res.status >= 500) ctx.warn?.(`${n}: GET ${entity.route}?${attempt.query} answered ${res.status}`);
    t.assert(`[R7] ${n}: ${attempt.name} (${res.status})`, widened(model, entity, res, b.rows, ownCount) === "", `GET ${entity.route}?${attempt.query} ${widened(model, entity, res, b.rows, ownCount)}`);
  }
  for (const { name, query } of forms(model, [
    nx("a filter", `filter=${f(col, "$eq", theirValue)}`),
    nx("an s search", `s=${enc(JSON.stringify({ [col]: theirValue }))}`),
    nx("an or", `or=${f("id", "$eq", String(other.id))}`),
    ...entity.relations.map((r) => nx(`join ${r.property}`, `join=${enc(r.property)}`)),
    { name: "a column filter", query: `${col}=${enc(`eq.${theirValue}`)}` },
    { name: "an or group", query: `or=${enc(`(id.eq.${other.id},${col}.eq.${theirValue})`)}` },
    { name: "a select", query: `select=${enc("*")}` },
    ...entity.relations.map((r) => ({ name: `select embed ${r.property}`, query: `select=${enc(`*,${r.property}(*)`)}` })),
  ]))
    t.expect(`[R7] ${n}: read another tenant's row by id with ${name}`, await call("GET", `${url}/${other.id}?${query}`, { headers: asA }), 400, 403, 404);

  // The count a list reports is a second way to learn about rows: it must
  // cover the caller's rows only, whatever the query asks for.
  if (postgrestOnly(model)) {
    const exact = { prefer: "count=exact" };
    const counts: [string, string, number][] = [
      ["a plain list", "", ownCount],
      ["a count-only request (limit=0)", "limit=0", ownCount],
      ["a filter that lists both tenants", `${col}=${enc(`in.(${mineValue},${theirValue})`)}`, ownCount],
      ["an or group that names the other tenant's row", `or=${enc(`(id.eq.${mine.id},id.eq.${other.id})`)}`, 1],
      ["a filter on the other tenant's row id", `id=${enc(`eq.${other.id}`)}`, 0],
    ];
    for (const [name, query, expected] of counts) {
      const res = await call("GET", query ? `${url}?${query}` : url, { headers: { ...asA, ...exact } });
      t.assert(`[R6,R7] ${n}: the Content-Range count of ${name} is the caller's rows only`, [200, 206].includes(res.status) && rangeTotal(res) === expected, `GET ${entity.route}?${query} answered ${res.status} with Content-Range ${res.range}; expected a total of ${expected}`);
    }
    const every = await call("GET", `${url}?limit=0`, { headers: { ...key, ...exact } });
    t.assert(`[R10] ${n}: a service caller's Content-Range count covers both tenants`, every.status === 200 && (rangeTotal(every) ?? 0) >= ownCount + 1, `${every.status} Content-Range ${every.range}`);
  }

  // R8: whatever a body says, a written row stays with the caller. For a
  // scopeBy field the value is the tenant; for a path through a parent it is
  // the caller's parent row.
  {
    const [myValue, theirs] = [mine[col], other[col]];
    const watched = [col, ...Object.keys(entity.payload)];
    const stored = async (label: string, id: unknown) => {
      const row = await call("GET", `${url}/${id}`, { headers: key });
      t.assert(label, row.status === 200 && String(row.json?.[col]) === mineValue, `${col}=${row.json?.[col]} (${row.status})`);
    };
    const made: unknown[] = [];
    // The relation whose foreign key is the scope column.
    const relation = entity.relations.find((r) => `${r.property}Id` === col)?.property;
    const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const namings: [string, Row][] = [
      ["names another tenant", { [col]: theirs }],
      ["names another tenant as text", { [col]: String(theirs) }],
      ["names another tenant as an object in the column", { [col]: { id: theirs } }],
      ["names another tenant beside an empty bulk list", { [col]: theirs, bulk: [] }],
      [`names another tenant as ${upper(col)}`, { [upper(col)]: theirs }],
      ...(snakeCase(col) === col ? [] : [[`names another tenant as ${snakeCase(col)}`, { [snakeCase(col)]: theirs }] as [string, Row]]),
      ["carries the id of another tenant's row", { id: other.id }],
      ...(relation
        ? ([
            [`names another tenant through ${relation}`, { [relation]: { id: theirs } }],
            [`names its own tenant in the column and another through ${relation}`, { [col]: myValue, [relation]: { id: theirs } }],
            [`names another tenant through ${relation} as a list`, { [relation]: [{ id: theirs }] }],
            [`names another tenant through ${relation} as a bare id`, { [relation]: theirs }],
            [`names another tenant through ${upper(relation)}`, { [upper(relation)]: { id: theirs } }],
          ] as [string, Row][])
        : []),
    ];
    let k = 10;
    for (const [what, extra] of namings) {
      k += 1;
      // A row scoped through its parent names the caller's own parent first.
      const body = (i: number): Row => ({ ...payloadFor(entity, i), ...parentsOf(entity, a), ...(entity.scope!.parent ? { [col]: myValue } : {}), ...extra });
      const created = await call("POST", url, { headers: asA, body: body(k * 10) });
      if (created.status >= 400 && created.status < 500) t.assert(`[R8] ${n}: a create body that ${what} is refused (${created.status})`, true);
      else if (t.expect(`[R8] ${n}: create with a body that ${what}`, created, 200, 201)) {
        made.push(created.json?.id);
        await stored(`[R8] ${n}: a create body that ${what} is stored in the caller's tenant`, created.json?.id);
      }
      const bulk = await call("POST", `${url}/bulk`, { headers: asA, body: { bulk: [body(k * 10 + 1), body(k * 10 + 2)] } });
      const bulkRows: Row[] = Array.isArray(bulk.json) ? bulk.json : [];
      if (bulk.status === 200 || bulk.status === 201) {
        for (const row of bulkRows) {
          made.push(row.id);
          await stored(`[R8] ${n}: a bulk create that ${what} is stored in the caller's tenant`, row.id);
        }
        t.assert(`[R8] ${n}: a bulk create that ${what} answers with its rows`, bulkRows.length > 0, bulk.text.slice(0, 200));
      } else t.assert(`[R8] ${n}: a bulk create that ${what} is refused (${bulk.status})`, bulk.status >= 400 && bulk.status < 500, bulk.text.slice(0, 200));
      for (const [method, verb] of [["PATCH", "update"], ["PUT", "replace"]]) {
        const res = await call(method, `${url}/${mine.id}`, { headers: asA, body: body(1) });
        t.assert(`[R8] ${n}: ${verb} own row with a body that ${what} (${res.status})`, res.status < 500 && res.status !== 0, res.text.slice(0, 200));
        await stored(`[R8] ${n}: after a ${verb} with a body that ${what} the row is still in the caller's tenant`, mine.id);
      }
      const theirsNow = await call("GET", `${url}/${other.id}`, { headers: key });
      const untouched = theirsNow.status === 200 && watched.every((w) => JSON.stringify(theirsNow.json?.[w]) === JSON.stringify(other[w]));
      t.assert(`[R8] ${n}: bodies that ${what} leave the other tenant's row as it was`, untouched, `${theirsNow.status} ${theirsNow.text.slice(0, 200)}`);
      // Put both rows back if a write moved them, so one failure does not cause others.
      if (!untouched) await call("PATCH", `${url}/${other.id}`, { headers: key, body: pick(other, watched) });
      await call("PATCH", `${url}/${mine.id}`, { headers: key, body: { [col]: myValue } });
    }
    const steal = await call("PATCH", `${url}/${other.id}`, { headers: asA, body: { [col]: myValue } });
    t.expect(`[R8] ${n}: move another tenant's row into the caller's tenant`, steal, 403, 404);
    const theirsAfter = await call("GET", `${url}/${other.id}`, { headers: key });
    t.assert(`[R8] ${n}: that row is still the other tenant's`, theirsAfter.status === 200 && String(theirsAfter.json?.[col]) === theirValue, `${col}=${theirsAfter.json?.[col]}`);
    for (const id of made)
      if (id !== undefined && ![String(mine.id), String(other.id)].includes(String(id))) await call("DELETE", `${url}/${id}`, { headers: key });
  }

  // R9
  if (ctx.user) {
    const noTenant = ctx.user({});
    t.expect(`[R9] ${n}: a caller with no tenant cannot list`, await call("GET", url, { headers: noTenant }), 403);
    t.expect(`[R9] ${n}: a caller with no tenant cannot read a row`, await call("GET", `${url}/${mine.id}`, { headers: noTenant }), 403, 404);
    t.expect(`[R9] ${n}: a caller with no tenant cannot create`, await call("POST", url, { headers: noTenant, body: { ...payloadFor(entity, 31), ...parentsOf(entity, a) } }), 403);
  }

  // R10
  if (ctx.user && ctx.roles && entity.scope!.bypassRoles.length > 0) {
    const bypass = await call("GET", `${url}?limit=1000`, { headers: ctx.user({ tenant: a.value, roles: [entity.scope!.bypassRoles[0]] }) });
    t.assert(`[R10] ${n}: the "${entity.scope!.bypassRoles[0]}" role the schema names lists another tenant's row`, bypass.status === 200 && rowsOf(bypass.json).some((r) => String(r.id) === String(other.id)), `${bypass.status} ${bypass.text.slice(0, 200)}`);
    const not = await call("GET", `${url}?limit=1000`, { headers: ctx.user({ tenant: a.value, roles: ["apso-access-no-such-role"] }) });
    t.assert(`[R10] ${n}: a role the schema does not name stays in its tenant`, not.status !== 200 || !rowsOf(not.json).some((r) => String(r.id) === String(other.id)), `${not.status} ${not.text.slice(0, 200)}`);
  }
}

const pick = (row: Row, keys: string[]): Row => Object.fromEntries(keys.map((k) => [k, row[k]]));

const parentsOf = (entity: AccessEntity, tenant: Tenant): Row =>
  Object.fromEntries(entity.parents.map((p) => [p.property, tenant.rows[p.entity]?.id]));

/** An entity with no scopeBy must not hand out scoped rows through a join. */
async function joinsFromShared(ctx: AccessContext, entity: AccessEntity, b: Tenant, asA: Headers): Promise<void> {
  const { base, model, t } = ctx;
  const scoped = (name: string) => Boolean(model.entities.find((e) => e.name === name)?.scope);
  const attempts: Attempt[] = [];
  for (const relation of entity.relations) {
    const target = model.entities.find((e) => e.name === relation.entity);
    const reachesScoped = scoped(relation.entity) || (target?.relations ?? []).some((second) => scoped(second.entity));
    if (!reachesScoped) continue;
    attempts.push(...relationLoads(model, relation).map((a) => ({ ...a, query: `${a.query}&limit=1000` })));
    // Refused, not answered with the relation left out: the caller is told the load is not allowed.
    if (scoped(relation.entity))
      t.expect(`[R7] ${entity.name} (not scoped): a select embed of ${relation.property}, whose rows are tenant-scoped, is refused`, await call("GET", `${base}${entity.route}?select=${enc(`*,${relation.property}(*)`)}`, { headers: asA }), 403);
    // A filter on a field of the other tenant's row must not say whether it matched.
    const theirs = target && b.rows[target.name];
    if (target?.scope && theirs) {
      const told = await oracle(model, base + entity.route, asA, relation.property, target, theirs);
      t.assert(`[R7] ${entity.name} (not scoped): a filter on a field of ${relation.property} does not reveal another tenant's values`, told === "", `GET ${entity.route} ${told}`);
    }
  }
  // With no join at all: a service that loads relations on every read leaks here.
  const plain = await call("GET", `${base}${entity.route}?limit=1000`, { headers: asA });
  t.assert(`[R6] ${entity.name} (not scoped): a list holds no other tenant's scoped rows (${plain.status})`, widened(model, entity, plain, b.rows, 0) === "", `GET ${entity.route}?limit=1000 ${widened(model, entity, plain, b.rows, 0)}`);
  for (const attempt of attempts) {
    const res = await call("GET", `${base}${entity.route}?${attempt.query}`, { headers: { ...asA, ...attempt.headers } });
    t.assert(`[R7] ${entity.name} (not scoped): ${attempt.name} (${res.status})`, widened(model, entity, res, b.rows, 0) === "", `GET ${entity.route}?${attempt.query} ${widened(model, entity, res, b.rows, 0)}`);
    const theirs = b.rows[entity.name];
    if (!theirs) continue;
    const one = await call("GET", `${base}${entity.route}/${theirs.id}?${attempt.query}`, { headers: { ...asA, ...attempt.headers } });
    t.assert(`[R7] ${entity.name} (not scoped): by id, ${attempt.name} (${one.status})`, widened(model, entity, one, b.rows, 0) === "", `GET ${entity.route}/${theirs.id}?${attempt.query} ${widened(model, entity, one, b.rows, 0)}`);
  }
}

/**
 * A body must not reach another tenant's row through a relation: naming the
 * row under a relation of the caller's own row, or of a shared row, must not
 * move it or change its fields.
 */
async function relationWrites(ctx: AccessContext, entity: AccessEntity, a: Tenant, b: Tenant, asA: Headers): Promise<void> {
  const { base, model, t, key } = ctx;
  const mine = a.rows[entity.name];
  const url = base + entity.route;
  for (const relation of entity.relations) {
    const target = model.entities.find((e) => e.name === relation.entity);
    const theirs = target?.scope && b.rows[target.name];
    if (!target || !theirs) continue;
    const watched = [target.scope!.field, ...Object.keys(target.payload)];
    const text = target.fields.find((f) => typeof target.payload[f.name] === "string" && !f.is_email && TEXT.has(f.type as string))?.name;
    const item: Row = { id: theirs.id, ...(text ? { [text]: "apso-access-changed" } : {}) };
    const fresh: Row = { ...payloadFor(entity, 51), ...parentsOf(entity, a), ...(entity.scope?.parent ? { [entity.scope.field]: mine[entity.scope.field] } : {}) };
    const writes: [string, string, string, Row][] = [
      ["update", "PATCH", `${url}/${mine.id}`, {}],
      ["replace", "PUT", `${url}/${mine.id}`, { ...fresh, ...payloadFor(entity, 1) }],
      ["create", "POST", url, fresh],
    ];
    for (const [shape, value] of [["a list", [item]], ["an object", item]] as [string, unknown][]) {
      for (const [verb, method, to, body] of writes) {
        const res = await call(method, to, { headers: asA, body: { ...body, [relation.property]: value } });
        if (res.status >= 500) ctx.warn?.(`${entity.name}: ${method} with ${relation.property} in the body answered ${res.status}`);
        const now = await call("GET", `${base}${target.route}/${theirs.id}`, { headers: key });
        const untouched = now.status === 200 && watched.every((w) => JSON.stringify(now.json?.[w]) === JSON.stringify(theirs[w]));
        t.assert(`[R8] ${entity.name}: a ${verb} that names another tenant's ${target.name} under ${relation.property} as ${shape} leaves that row as it was (${res.status})`, untouched, `${now.status} ${now.text.slice(0, 200)}`);
        // Put the rows back before deleting the new one, so one failure does not cause others.
        if (!untouched) await call("PATCH", `${base}${target.route}/${theirs.id}`, { headers: key, body: pick(theirs, watched) });
        const own = a.rows[target.name];
        if (own) await call("PATCH", `${base}${target.route}/${own.id}`, { headers: key, body: pick(own, watched) });
        if (method === "POST" && res.json?.id !== undefined && String(res.json.id) !== String(mine.id)) await call("DELETE", `${url}/${res.json.id}`, { headers: key });
      }
    }
  }
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** True when a stored row's foreign key names the row with this id. */
const names = (row: Row | undefined, fk: string, id: unknown): boolean =>
  row !== undefined && row[fk] !== null && row[fk] !== undefined && String(row[fk]) === String(id);

/** A row as stored, read by a service caller. */
async function storedRow(ctx: AccessContext, url: string): Promise<Row | undefined> {
  const res = await call("GET", url, { headers: ctx.key });
  return res.json;
}

/**
 * A foreign key to a tenant-scoped entity must name a row the caller can
 * read (R8), and a stored key that names another tenant's row must not carry
 * that row into a response (R7). Runs for every such key of `entity` other
 * than its own scope column, with every body shape the tenant cases use.
 */
async function foreignKeys(ctx: AccessContext, entity: AccessEntity, a: Tenant, b: Tenant, asA: Headers, asB: Headers): Promise<void> {
  const { base, model, t, key } = ctx;
  const mine = a.rows[entity.name];
  const url = base + entity.route;
  const n = entity.name;
  const upper = upperFirst;
  for (const relation of entity.relations) {
    const fk = relation.fk;
    const target = model.entities.find((e) => e.name === relation.entity);
    if (!fk || !target?.scope || fk === entity.scope?.field) continue;
    const [own, theirs] = [a.rows[target.name], b.rows[target.name]];
    if (!own || !theirs) continue;
    const p = relation.property;
    const what = `another tenant's ${target.name}`;
    const required = entity.parents.some((parent) => parent.property === fk);
    const made: unknown[] = [];
    const fresh = (i: number): Row => ({
      ...payloadFor(entity, i),
      ...parentsOf(entity, a),
      ...(entity.scope?.parent ? { [entity.scope.field]: mine[entity.scope.field] } : {}),
    });
    const restore: [string, string, { headers: Headers; body: Row }] = ["PATCH", `${url}/${mine.id}`, { headers: key, body: { [fk]: mine[fk] ?? null } }];

    // R8: the plain forms are refused with 403, in every language.
    const plain = { [fk]: theirs.id };
    t.expect(`[R8] ${n}: a create that names ${what} in ${fk} is refused`, await call("POST", url, { headers: asA, body: { ...fresh(61), ...plain } }), 403);
    t.expect(`[R8] ${n}: an update that names ${what} in ${fk} is refused`, await call("PATCH", `${url}/${mine.id}`, { headers: asA, body: plain }), 403);
    t.expect(`[R8] ${n}: a replace that names ${what} in ${fk} is refused`, await call("PUT", `${url}/${mine.id}`, { headers: asA, body: { ...fresh(1), ...plain } }), 403, 405);
    await call(...restore);

    // R8: whatever the body's shape, the reference is never stored.
    const namings: [string, Row][] = [
      [`in ${fk}`, plain],
      [`in ${fk} as text`, { [fk]: String(theirs.id) }],
      [`as an object in ${fk}`, { [fk]: { id: theirs.id } }],
      [`in ${fk} beside an empty bulk list`, { [fk]: theirs.id, bulk: [] }],
      [`as ${upper(fk)}`, { [upper(fk)]: theirs.id }],
      ...(snakeCase(fk) === fk ? [] : [[`as ${snakeCase(fk)}`, { [snakeCase(fk)]: theirs.id }] as [string, Row]]),
      [`through ${p}`, { [p]: { id: theirs.id } }],
      [`through ${p} beside its own ${target.name} in ${fk}`, { [fk]: own.id, [p]: { id: theirs.id } }],
      [`through ${p} as a list`, { [p]: [{ id: theirs.id }] }],
      [`through ${p} as a bare id`, { [p]: theirs.id }],
      [`through ${upper(p)}`, { [upper(p)]: { id: theirs.id } }],
    ];
    let k = 62;
    for (const [how, extra] of namings) {
      k += 3;
      const created = await call("POST", url, { headers: asA, body: { ...fresh(k), ...extra } });
      if (created.json?.id !== undefined && created.status < 300) made.push(created.json.id);
      t.assert(`[R8] ${n}: a create that names ${what} ${how} does not store that reference (${created.status})`, created.status !== 0 && created.status < 500 && (created.status >= 400 || !names(await storedRow(ctx, `${url}/${created.json?.id}`), fk, theirs.id)), created.text.slice(0, 200));
      const bulk = await call("POST", `${url}/bulk`, { headers: asA, body: { bulk: [{ ...fresh(k + 1), [fk]: own.id }, { ...fresh(k + 2), ...extra }] } });
      const bulkRows: Row[] = bulk.status < 300 && Array.isArray(bulk.json) ? bulk.json : [];
      let kept = false;
      for (const row of bulkRows) {
        made.push(row.id);
        kept = kept || names(await storedRow(ctx, `${url}/${row.id}`), fk, theirs.id);
      }
      t.assert(`[R8] ${n}: a bulk create with a row that names ${what} ${how} does not store that reference (${bulk.status})`, bulk.status !== 0 && bulk.status < 500 && !kept, bulk.text.slice(0, 200));
      for (const [method, verb, body] of [["PATCH", "update", extra], ["PUT", "replace", { ...fresh(1), ...extra }]] as [string, string, Row][]) {
        const res = await call(method, `${url}/${mine.id}`, { headers: asA, body });
        t.assert(`[R8] ${n}: ${verb === "update" ? "an" : "a"} ${verb} that names ${what} ${how} does not store that reference (${res.status})`, res.status !== 0 && res.status < 500 && !names(await storedRow(ctx, `${url}/${mine.id}`), fk, theirs.id), res.text.slice(0, 200));
        await call(...restore);
      }
    }

    // R8: the caller's own row, and no row at all, are still accepted.
    const ok = await call("POST", url, { headers: asA, body: { ...fresh(98), [fk]: own.id } });
    if (t.expect(`[R8] ${n}: a create that names its own tenant's ${target.name} in ${fk}`, ok, 200, 201)) made.push(ok.json?.id);
    t.expect(`[R8] ${n}: an update that names its own tenant's ${target.name} in ${fk}`, await call("PATCH", `${url}/${mine.id}`, { headers: asA, body: { [fk]: own.id } }), 200);
    if (!required) t.expect(`[R8] ${n}: an update that sets ${fk} to null`, await call("PATCH", `${url}/${mine.id}`, { headers: asA, body: { [fk]: null } }), 200);
    await call(...restore);

    // R7: a row written by a service caller that names the other tenant's row.
    const seeded = await call("POST", url, { headers: key, body: { ...fresh(99), ...(entity.scope && !entity.scope.parent ? { [entity.scope.field]: mine[entity.scope.field] } : {}), [fk]: theirs.id } });
    if (t.assert(`[R7] ${n}: a service caller stores a row that names ${what} in ${fk} (${seeded.status})`, seeded.status < 300 && names(seeded.json, fk, theirs.id), seeded.text.slice(0, 200))) {
      const row = seeded.json as Row;
      made.push(row.id);
      const select = (embed: string) => `select=${enc(embed)}`;
      const loads: [string, string][] = [
        [`select embed ${p}`, select(`*,${p}(*)`)],
        [`select embed ${p} with chosen columns`, select(`id,${p}(id)`)],
        [`select embed ${p} under an alias`, select(`*,${alias(p)}:${p}(*)`)],
        [`select embed ${p} with an inner join hint`, select(`*,${p}!inner(*)`)],
        // Python and Go load a relation on a read by id only through the join parameter.
        ...(model.language === "typescript" ? [] : [[`join ${p}`, `join=${enc(p)}`] as [string, string]]),
      ];
      for (const [name, query] of loads) {
        for (const [where, to] of [["a list", `${url}?${query}&limit=1000`], ["a read by id", `${url}/${row.id}?${query}`]]) {
          const res = await call("GET", to, { headers: query.startsWith("join=") ? asA : { ...asA, ...POSTGREST } });
          if (res.status >= 500) ctx.warn?.(`${n}: GET ${to.slice(base.length)} answered ${res.status}`);
          const leaked = res.status === 200 ? foreignRows(model, n, res.json?.data ?? res.json, b.rows) : [];
          t.assert(`[R7] ${n}: ${where} with ${name} does not return ${what} through a stored ${fk} (${res.status})`, res.status !== 0 && leaked.length === 0, `GET ${to.slice(base.length)} returned ${leaked.join(", ")}`);
        }
      }
      const told = await oracle(model, url, asA, p, target, theirs, row);
      t.assert(`[R7] ${n}: a filter on a field of ${p} does not reveal ${what} through a stored ${fk}`, told === "", `GET ${entity.route} ${told}`);
      // The other way round: the other tenant's caller loads its own row's relation back to this entity.
      for (const back of entity.scope ? target.relations.filter((r) => r.entity === n) : []) {
        const q = back.property;
        const joined = model.language === "typescript" ? select(`*,${q}(*)`) : `join=${enc(q)}`;
        for (const [where, to, headers] of [["a list", `${base}${target.route}?${select(`*,${q}(*)`)}&limit=1000`, POSTGREST], ["a read by id", `${base}${target.route}/${theirs.id}?${joined}`, model.language === "typescript" ? POSTGREST : {}]] as [string, string, Headers][]) {
          const res = await call("GET", to, { headers: { ...asB, ...headers } });
          const leaked = res.status === 200 ? rowsWhere(model, target.name, res.json?.data ?? res.json, (e, r) => e.name === n && String(r.id) === String(row.id)) : [];
          t.assert(`[R7] ${target.name}: ${where} that loads ${q} does not return another tenant's ${n} that names it in ${fk} (${res.status})`, res.status !== 0 && leaked.length === 0, `GET ${to.slice(base.length)} returned ${leaked.join(", ")}`);
        }
      }
      // A relation inside the tenant still loads.
      const within = ok.json?.id === undefined ? undefined : await call("GET", `${url}?select=${enc(`*,${p}(*)`)}&id=${enc(`eq.${ok.json.id}`)}`, { headers: { ...asA, ...POSTGREST } });
      if (within?.status === 200) t.assert(`[R7] ${n}: a list with select embed ${p} returns its own tenant's ${target.name}`, String(rowsOf(within.json)[0]?.[p]?.id) === String(own.id), within.text.slice(0, 200));
    }
    for (const id of made)
      if (id !== undefined && String(id) !== String(mine.id)) await call("DELETE", `${url}/${id}`, { headers: key });
  }
}

const NO_ROLE = "apso-access-no-such-role";

async function permissions(ctx: AccessContext, entity: AccessEntity, a: Tenant, b: Tenant): Promise<void> {
  const { base, model, t } = ctx;
  if (!ctx.user || !ctx.roles || !entity.permissions) return;
  const url = base + entity.route;
  const row = a.rows[entity.name];
  const n = entity.name;
  const outsider = ctx.user({ tenant: a.value, roles: [NO_ROLE] });
  const rule = entity.name === model.grants ? "R11,R12" : "R11";
  const tries: Record<string, [string, () => Promise<Res>][]> = {
    read: [
      ["list", () => call("GET", url, { headers: outsider })],
      ...(row ? [["read by id", () => call("GET", `${url}/${row.id}`, { headers: outsider })] as [string, () => Promise<Res>]] : []),
    ],
    create: [["create", () => call("POST", url, { headers: outsider, body: { ...payloadFor(entity, 41), ...parentsOf(entity, a) } })]],
    update: row ? [["update", () => call("PATCH", `${url}/${row.id}`, { headers: outsider, body: payloadFor(entity, 42) })]] : [],
    delete: row ? [["delete", () => call("DELETE", `${url}/${row.id}`, { headers: outsider })]] : [],
  };
  for (const [op, roles] of Object.entries(entity.permissions)) {
    for (const [what, attempt] of tries[op] ?? [])
      t.expect(`[${rule}] ${n}: a role outside ${op} [${roles!.join(", ")}] cannot ${what}`, await attempt(), 403);
  }
  const readers = entity.permissions.read;
  // A role that cannot read the entity must not be sent its rows through a
  // relation of another entity, however the relation is loaded, nor learn
  // their fields through a filter.
  if (readers) {
    const guarded = (e: AccessEntity) => e.name === entity.name;
    for (const from of model.entities) {
      if (from.permissions?.read) continue;
      for (const relation of from.relations) {
        const target = model.entities.find((e) => e.name === relation.entity);
        const direct = relation.entity === entity.name;
        if (!direct && !(target?.relations ?? []).some((second) => second.entity === entity.name)) continue;
        for (const attempt of relationLoads(model, relation)) {
          const res = await call("GET", `${base}${from.route}?${attempt.query}&limit=1000`, { headers: { ...outsider, ...attempt.headers } });
          const sent = res.status === 200 ? rowsWhere(model, from.name, rowsOf(res.json), guarded) : [];
          t.assert(`[R11] ${n}: a role outside read is not sent ${n} rows by ${from.name}, ${attempt.name} (${res.status})`, res.status !== 0 && res.status < 500 && sent.length === 0, `GET ${from.route}?${attempt.query} returned ${sent.length} ${n} row(s)`);
        }
        if (direct && row) {
          const told = await oracle(model, base + from.route, outsider, relation.property, entity, row);
          t.assert(`[R11] ${n}: a role outside read cannot test ${n} fields through a filter on ${from.name}.${relation.property}`, told === "", `GET ${from.route} ${told}`);
          if (!postgrestOnly(model))
            t.expect(`[R11] ${n}: a role outside read cannot join ${from.name}?join=${relation.property}`, await call("GET", `${base}${from.route}?join=${enc(relation.property)}`, { headers: outsider }), 403);
          t.expect(`[R11] ${n}: a role outside read cannot embed ${from.name}?select=*,${relation.property}(*)`, await call("GET", `${base}${from.route}?select=${enc(`*,${relation.property}(*)`)}`, { headers: outsider }), 403);
        }
      }
    }
  }
  if (readers && readers.length > 0)
    t.expect(`[R11] ${n}: the "${readers[0]}" role can list`, await call("GET", url, { headers: ctx.user({ tenant: a.value, roles: [readers[0]] }) }), 200);

  // R12: a grant made by a role that may grant applies in that tenant only.
  const grants = model.entities.find((e) => e.name === model.grants);
  const granter = grants?.permissions?.create?.[0];
  if (!readers || !grants || !granter || entity === grants || !grants.scope) return;
  const permission = `${entity.name.charAt(0).toLowerCase()}${entity.name.slice(1)}:read`;
  const grant = await call("POST", base + grants.route, { headers: ctx.user({ tenant: a.value, roles: [granter] }), body: { ...payloadFor(grants, 51), ...parentsOf(grants, a), role: NO_ROLE, permission } });
  if (!t.expect(`[R12] ${n}: the "${granter}" role grants ${permission} to a role`, grant, 200, 201)) return;
  t.expect(`[R12] ${n}: the role can list after the grant`, await call("GET", url, { headers: outsider }), 200);
  t.expect(`[R12] ${n}: the same role in another tenant still cannot`, await call("GET", url, { headers: ctx.user({ tenant: b.value, roles: [NO_ROLE] }) }), 403);
  if (entity.permissions.delete && row)
    t.expect(`[R12] ${n}: the grant adds read only, not delete`, await call("DELETE", `${url}/${row.id}`, { headers: outsider }), 403);
  await call("DELETE", `${base}${grants.route}/${grant.json?.id}`, { headers: ctx.key });
  t.expect(`[R12] ${n}: the role cannot list once the grant is removed`, await call("GET", url, { headers: outsider }), 403);
}

async function mcpCases(ctx: AccessContext, a: Tenant, b: Tenant, asA: Headers): Promise<void> {
  const { base, model, t } = ctx;
  const expected = model.entities.flatMap((e) => Object.values(e.tools)).sort();
  if (!ctx.mcp || expected.length === 0) return;
  const rpc = (headers: Headers) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }).then((r) => r.status, () => 0);
  if (ctx.user) {
    t.assert("[R22] mcp: listing tools with no credential is a 401", (await rpc({})) === 401);
    for (const bad of ctx.badTokens ?? [])
      t.assert(`[R22] mcp: ${bad.label} is a 401`, (await rpc(bad.headers)) === 401);
  }
  let client: McpClient;
  try {
    client = await ctx.mcp(asA);
  } catch (error) {
    t.assert("[R22] mcp: a signed-in caller connects", false, String(error));
    return;
  }
  const listed = await client.listTools();
  // Every name an entity operation could have as a tool. A tool with another
  // name is a hand-written route that opted in itself, which the schema does
  // not describe.
  const possible = new Set(
    model.entities.flatMap((e) => {
      const one = snakeCase(e.name);
      return [`list_${snakeCase(pluralize(e.name))}`, ...["get", "create", "update", "delete"].map((op) => `${op}_${one}`)];
    })
  );
  const names = listed.filter((name) => possible.has(name)).sort();
  t.assert("[R21] mcp: the tools for entity operations are the ones the schema opts in, and no others", JSON.stringify(names) === JSON.stringify(expected), `listed ${names.join(",")}; expected ${expected.join(",")}`);

  for (const entity of model.entities) {
    const [mine, other] = [a.rows[entity.name], b.rows[entity.name]];
    if (!entity.scope || !entity.tools.list || !mine || !other) continue;
    const col = entity.scope.field;
    const rest = await call("GET", base + entity.route, { headers: asA });
    const own = typeof rest.json?.total === "number" ? rest.json.total : rowsOf(rest.json).length;
    const [m, o] = [String(mine[col]), String(other[col])];
    const nestjsx: [string, Row][] = [
      ["filter names the other tenant", { filter: [`${col}||$eq||${o}`] }],
      ["filter own tenant, or the other", { filter: [`${col}||$eq||${m}`], or: [`${col}||$eq||${o}`] }],
      ["two or conditions", { or: [`${col}||$eq||${o}`, `id||$eq||${other.id}`] }],
      ["s names the other tenant", { s: JSON.stringify({ [col]: other[col] }) }],
      ["s $or of both tenants", { s: JSON.stringify({ $or: [{ [col]: mine[col] }, { [col]: other[col] }] }) }],
      ["sort by tenant, a large page", { sort: [`${col},DESC`], limit: 1000 }],
      ...entity.relations.map((r): [string, Row] => [`join ${r.property}`, { join: [r.property] }]),
    ];
    const attempts: [string, Row][] = [
      ["no arguments", {}],
      ...(postgrestOnly(model) ? [] : nestjsx),
      ["column filter names the other tenant", { [col]: `eq.${o}` }],
      ["column filter lists both tenants", { [col]: `in.(${m},${o})`, limit: 1000 }],
      ["column filter excludes the caller's tenant", { [col]: `neq.${m}` }],
      ["column filter by the other tenant's row id", { id: `eq.${other.id}` }],
      ["column filter own tenant, or group the other", { [col]: `eq.${m}`, or: `(${col}.eq.${o},id.eq.${other.id})` }],
      ["or group of both tenants", { or: `(${col}.eq.${m},${col}.eq.${o})` }],
      ["and group with a nested or", { and: `(or(${col}.eq.${o},id.eq.${other.id}))` }],
      ["order by tenant, a large page", { order: `${col}.desc`, limit: 1000 }],
      ...entity.relations.flatMap((r): [string, Row][] => [
        [`select embed ${r.property}`, { select: `*,${r.property}(*)`, limit: 1000 }],
        [`embedded filter on ${r.property}`, { select: `*,${r.property}(*)`, embedded: { [`${r.property}.id`]: "not.is.null" }, limit: 1000 }],
        [`embedded filter on an inner embed of ${r.property}`, { select: `id,${r.property}!inner(id)`, embedded: { [`${r.property}.id`]: "not.is.null" }, limit: 1000 }],
        [`embedded filter on ${r.property} sent as a top-level argument`, { select: `*,${r.property}(*)`, [`${r.property}.id`]: "not.is.null", limit: 1000 }],
      ]),
    ];
    for (const [name, args] of attempts) {
      const res = await client.callTool(entity.tools.list, args);
      const problem = res.error === undefined ? widened(model, entity, { status: 200, text: "", json: res.json }, b.rows, own) : "";
      t.assert(`[R7,R23] mcp ${entity.tools.list}: ${name}`, problem === "", `${JSON.stringify(args)} ${problem}`);
    }
    const got = await client.callTool(entity.tools.get!, { id: other.id });
    t.assert(`[R6,R23] mcp ${entity.tools.get}: another tenant's row by id is refused`, got.error !== undefined, JSON.stringify(got.json));
  }
}

/**
 * Run every case the schema calls for against the service at ctx.base.
 * The service must be running with the API key in ctx.key accepted.
 * @param {AccessContext} ctx - The service, its schema and how to call it
 * @returns {Promise<void>} Resolves when the cases have run; results are on ctx.t
 */
export async function runAccessCases(ctx: AccessContext): Promise<void> {
  const { model } = ctx;
  await whoIsCalling(ctx);
  if (postgrestOnly(model)) await nestjsxRefused(ctx);
  for (const s of model.skipped) ctx.log?.(`  skip ${s.name}: ${s.reason}`);
  const [a, b] = await seed(ctx);
  try {
    if (ctx.user) {
      const roles = callerRoles(model);
      const asA = ctx.user({ tenant: a.value, roles });
      const asB = ctx.user({ tenant: b.value, roles });
      for (const entity of model.entities) {
        if (entity.scope && a.rows[entity.name] && b.rows[entity.name]) await tenantScope(ctx, entity, a, b, asA);
        else if (!entity.scope) await joinsFromShared(ctx, entity, b, asA);
        if (a.rows[entity.name]) await relationWrites(ctx, entity, a, b, asA);
        if (a.rows[entity.name]) await foreignKeys(ctx, entity, a, b, asA, asB);
      }
      await mcpCases(ctx, a, b, asA);
      for (const entity of model.entities) await permissions(ctx, entity, a, b);
    }
  } finally {
    for (const tenant of [b, a])
      for (const entity of [...model.entities].reverse())
        if (tenant.rows[entity.name]) await call("DELETE", `${ctx.base}${entity.route}/${tenant.rows[entity.name].id}`, { headers: ctx.key });
  }
}
