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
import { snakeCase } from "../utils/casing";
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
    return { status: res.status, text, json };
  } catch (error) {
    return { status: 0, text: String(error) };
  }
}

const rowsOf = (json: any): Row[] => {
  if (Array.isArray(json)) return json;
  const list = json?.data ?? json?.items;
  return Array.isArray(list) ? list : [];
};

// ---------- the schema, as the cases need it ----------

export interface AccessEntity {
  name: string;
  route: string;
  fields: NonNullable<Entity["fields"]>;
  payload: Row;
  /** Required foreign keys: property -> the entity it points to. */
  parents: { property: string; entity: string }[];
  /** Relations a `join` can name: property -> the entity it loads. */
  relations: { property: string; entity: string }[];
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
  return language === "typescript" ? `/${plural}` : `/api/${plural.toLowerCase()}`;
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
    const ops = language === "typescript" ? mcpOperations(entity) : [];
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

/**
 * Every way a request can load `relation` of `entity` (and, one step further,
 * each relation of that): the join parameter, and select embeds with and
 * without the dialect header, with chosen columns, and under an alias.
 */
function relationLoads(model: AccessModel, relation: AccessEntity["relations"][number], nested = true): Attempt[] {
  const p = relation.property;
  const out: Attempt[] = [
    { name: `join ${p}`, query: `join=${enc(p)}` },
    { name: `join ${p} with chosen fields`, query: `join=${enc(`${p}||id`)}` },
    { name: `select embed ${p}`, query: `select=${enc(`*,${p}(*)`)}`, headers: POSTGREST },
    { name: `select embed ${p}, no dialect header`, query: `select=${enc(`*,${p}(*)`)}` },
    { name: `select embed ${p} with chosen columns, no dialect header`, query: `select=${enc(`id,${p}(id)`)}` },
    { name: `select embed ${p} under an alias`, query: `select=${enc(`*,${alias(p)}:${p}(*)`)}` },
    { name: `select embed ${p} with an inner join hint`, query: `select=${enc(`*,${p}!inner(*)`)}` },
  ];
  if (!nested) return out;
  for (const second of model.entities.find((e) => e.name === relation.entity)?.relations ?? []) {
    const q = second.property;
    out.push(
      { name: `join ${p}.${q}`, query: `join=${enc(p)}&join=${enc(`${p}.${q}`)}` },
      { name: `join ${p}.${q} without joining ${p}`, query: `join=${enc(`${p}.${q}`)}` },
      { name: `select embed ${p}(${q})`, query: `select=${enc(`*,${p}(*,${q}(*))`)}`, headers: POSTGREST },
      { name: `select embed ${p}(${q}), no dialect header`, query: `select=${enc(`id,${p}(id,${q}(*))`)}` },
      { name: `select embed ${p}(${q}) under aliases`, query: `select=${enc(`*,${alias(p)}:${p}(*,${alias(q)}:${q}(*))`)}` }
    );
  }
  return out;
}

/** A field of an entity's seeded row to test for through a relation, and a value no row has. */
function probe(entity: AccessEntity, row: Row): { field: string; value: string; absent: string } {
  const field = Object.keys(entity.payload).find((k) => typeof row[k] === "string" && row[k] !== "") ?? "id";
  return { field, value: String(row[field]), absent: field === "id" ? "987654321" : "apso-access-absent" };
}

/**
 * Filters on a field of a related entity the caller cannot read. If the
 * filter matches for the real value and not for a value no row has, the
 * caller can learn the field one guess at a time without ever being sent it.
 */
async function oracle(url: string, headers: Headers, property: string, target: AccessEntity, row: Row): Promise<string> {
  const { field, value, absent } = probe(target, row);
  const forms: [string, (v: string) => string, Headers?][] = [
    ["filter", (v) => `filter=${f(`${property}.${field}`, "$eq", v)}`],
    ["filter with join", (v) => `join=${enc(property)}&filter=${f(`${property}.${field}`, "$eq", v)}`],
    ["filter $starts", (v) => `filter=${f(`${property}.${field}`, "$starts", v.slice(0, Math.max(1, v.length - 1)))}`],
    ["s search", (v) => `s=${enc(JSON.stringify({ [`${property}.${field}`]: num(v) }))}`],
    ["postgrest filter", (v) => `${property}.${field}=${enc(`eq.${v}`)}`, POSTGREST],
    ["postgrest inner embed filter", (v) => `select=${enc(`id,${property}!inner(id)`)}&${property}.${field}=${enc(`eq.${v}`)}`],
  ];
  const leaks: string[] = [];
  for (const [name, query, extra] of forms) {
    const real = await call("GET", `${url}?${query(value)}`, { headers: { ...headers, ...extra } });
    if (real.status !== 200 || rowsOf(real.json).length === 0) continue;
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
}

const enc = encodeURIComponent;
/** A token claim is text; a numeric column is filtered as a number in JSON. */
const num = (v: string): unknown => (/^\d+$/.test(v) ? Number(v) : v);
/** One nestjsx-style condition, field||operator||value, encoded. */
const f = (...parts: string[]) => enc(parts.join("||"));

/**
 * Query strings a caller of one tenant would try in order to read another
 * tenant's rows of `entity`: both query dialects, nested and encoded forms.
 * `mine` and `theirs` are the two tenants' values of the scope column and
 * `theirId` is the id of the other tenant's row.
 */
function widenAttempts(model: AccessModel, entity: AccessEntity, mine: string, theirs: string, theirId: string): Attempt[] {
  const col = entity.scope!.field;
  const s = (o: unknown) => `s=${enc(JSON.stringify(o))}`;
  const postgrest = POSTGREST;
  const out: Attempt[] = [
    // filter
    { name: "filter names the other tenant", query: `filter=${f(col, "$eq", theirs)}` },
    { name: "filter $in lists both tenants", query: `filter=${f(col, "$in", `${mine},${theirs}`)}` },
    { name: "filter $ne excludes the caller's tenant", query: `filter=${f(col, "$ne", mine)}` },
    { name: "filter $notnull on the tenant column", query: `filter=${f(col, "$notnull")}` },
    { name: "filter by the other tenant's row id", query: `filter=${f("id", "$eq", theirId)}` },
    { name: "filter sent twice (own tenant, then the other)", query: `filter=${f(col, "$eq", mine)}&filter=${f(col, "$eq", theirs)}` },
    { name: "filter as an array parameter", query: `filter[]=${f(col, "$eq", theirs)}` },
    { name: "filter as an indexed array parameter", query: `filter[0]=${f(col, "$eq", theirs)}&filter[1]=${f("id", "$eq", theirId)}` },
    { name: "filter with unencoded separators", query: `filter=${col}||$eq||${theirs}` },
    { name: "filter double-encoded", query: `filter=${enc(f(col, "$eq", theirs))}` },
    { name: "filter on the column's snake_case name", query: `filter=${f(snakeCase(col), "$eq", theirs)}` },
    { name: "filter on the column in upper case", query: `filter=${f(col.toUpperCase(), "$eq", theirs)}` },
    { name: "the guard's own filter key", query: `filter.${col}=${enc(`$eq:${theirs}`)}` },
    { name: "the guard's own filter key, sent twice", query: `filter.${col}=${enc(`$eq:${theirs}`)}&filter.${col}=${enc(`$eq:${theirs}`)}` },
    { name: "filter as a nested object parameter", query: `filter[${col}]=${enc(theirs)}` },
    // or
    { name: "or names the other tenant", query: `or=${f(col, "$eq", theirs)}` },
    { name: "filter own tenant, or the other", query: `filter=${f(col, "$eq", mine)}&or=${f(col, "$eq", theirs)}` },
    { name: "two or conditions", query: `or=${f(col, "$eq", theirs)}&or=${f("id", "$eq", theirId)}` },
    { name: "filter and or by the other tenant's row id", query: `filter=${f("id", "$eq", theirId)}&or=${f("id", "$eq", theirId)}` },
    { name: "or matching every row", query: `or=${f("id", "$notnull")}&or=${f("id", "$isnull")}` },
    { name: "or as an array parameter", query: `or[]=${f(col, "$eq", theirs)}&or[]=${f("id", "$eq", theirId)}` },
    // s (JSON search)
    { name: "s names the other tenant", query: s({ [col]: num(theirs) }) },
    { name: "s $or of both tenants", query: s({ $or: [{ [col]: num(mine) }, { [col]: num(theirs) }] }) },
    { name: "s $or of the other tenant and its row id", query: s({ $or: [{ [col]: num(theirs) }, { id: num(theirId) }] }) },
    { name: "s $ne the caller's tenant", query: s({ [col]: { $ne: num(mine) } }) },
    { name: "s $in both tenants", query: s({ [col]: { $in: [num(mine), num(theirs)] } }) },
    { name: "s $or nested in $and", query: s({ $and: [{ $or: [{ [col]: num(theirs) }, { id: { $notnull: true } }] }] }) },
    { name: "s $or nested in $or", query: s({ $or: [{ $or: [{ [col]: num(theirs) }] }, { $and: [{ id: num(theirId) }] }] }) },
    { name: "s by the other tenant's row id", query: s({ id: num(theirId) }) },
    { name: "s $or inside the column's condition", query: s({ [col]: { $or: { $eq: num(theirs), $notnull: true } } }) },
    { name: "s as a nested object parameter", query: `s[${col}]=${enc(theirs)}` },
    { name: "s double-encoded", query: `s=${enc(enc(JSON.stringify({ [col]: num(theirs) })))}` },
    { name: "s with filter and or together", query: `${s({ [col]: num(theirs) })}&filter=${f(col, "$eq", theirs)}&or=${f(col, "$eq", theirs)}` },
    // sort and pagination
    { name: "sort by tenant descending, first row only", query: `sort=${enc(`${col},DESC`)}&limit=1` },
    { name: "sort by tenant ascending, first row only", query: `sort=${enc(`${col},ASC`)}&limit=1` },
    { name: "sort by id, a very large page", query: `sort=${enc("id,DESC")}&limit=100000` },
    { name: "limit 0", query: "limit=0" },
    { name: "negative limit", query: "limit=-1" },
    { name: "second page", query: "limit=1&page=2" },
    { name: "offset past the caller's rows", query: "limit=100&offset=1" },
    { name: "negative offset", query: "offset=-1" },
    { name: "per_page and take", query: "per_page=1000&take=1000" },
    { name: "fields limited to the tenant column", query: `fields=${enc(col)}` },
    { name: "cache off", query: "cache=0" },
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
  ];
  // every way to load a relation, and every relation of those
  for (const relation of entity.relations) {
    out.push(
      ...relationLoads(model, relation),
      { name: `join ${relation.property} with a filter on it`, query: `join=${enc(relation.property)}&filter=${f(`${relation.property}.id`, "$notnull")}&or=${f(`${relation.property}.id`, "$isnull")}` },
      { name: `sort by a field of ${relation.property}`, query: `join=${enc(relation.property)}&sort=${enc(`${relation.property}.id,DESC`)}&limit=1` }
    );
  }
  return out;
}

/** A list answer is clean when it is refused, or holds none of the other tenant's rows and no more rows than the caller owns. */
function widened(model: AccessModel, entity: AccessEntity, res: Res, theirs: Record<string, Row>, own: number): string {
  // Refused. A 5xx returned no rows either: it is a defect, reported as a warning, not a leak.
  if (res.status >= 400) return "";
  if (res.status !== 200) return `status ${res.status} ${res.text.slice(0, 200)}`;
  // A list answers with an envelope or a bare array; a read by id with the row.
  const isList = Array.isArray(res.json) || Array.isArray(res.json?.data) || Array.isArray(res.json?.items);
  const leaked = foreignRows(model, entity.name, isList ? rowsOf(res.json) : res.json, theirs);
  if (leaked.length > 0) return `returned another tenant's rows: ${[...new Set(leaked)].join(", ")}`;
  const n = rowsOf(res.json).length;
  const total = typeof res.json?.total === "number" ? res.json.total : n;
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
  for (const [name, query] of [
    ["a filter", `filter=${f(col, "$eq", theirValue)}`],
    ["an s search", `s=${enc(JSON.stringify({ [col]: theirValue }))}`],
    ["an or", `or=${f("id", "$eq", String(other.id))}`],
    ...entity.relations.map((r) => [`join ${r.property}`, `join=${enc(r.property)}`]),
  ])
    t.expect(`[R7] ${n}: read another tenant's row by id with ${name}`, await call("GET", `${url}/${other.id}?${query}`, { headers: asA }), 400, 403, 404);

  // R8: only a scopeBy field can be sent in a body; a path through a parent is checked by R6.
  if (!entity.scope!.parent) {
    const theirTenant = asColumn(entity, b.value);
    const stored = async (label: string, id: unknown) => {
      const row = await call("GET", `${url}/${id}`, { headers: key });
      t.assert(label, row.status === 200 && String(row.json?.[col]) === a.value, `${col}=${row.json?.[col]} (${row.status})`);
    };
    const made: unknown[] = [];
    const bodies: [string, Row][] = [
      ["names another tenant", { [col]: theirTenant }],
      ["names another tenant as text", { [col]: String(theirTenant) }],
    ];
    let k = 10;
    for (const [what, extra] of bodies) {
      k += 1;
      const created = await call("POST", url, { headers: asA, body: { ...payloadFor(entity, k), ...parentsOf(entity, a), ...extra } });
      if (created.status >= 400 && created.status < 500) {
        t.assert(`[R8] ${n}: a create body that ${what} is refused (${created.status})`, true);
        continue;
      }
      if (!t.expect(`[R8] ${n}: create with a body that ${what}`, created, 200, 201)) continue;
      made.push(created.json?.id);
      await stored(`[R8] ${n}: a create body that ${what} is stored in the caller's tenant`, created.json?.id);
    }
    const bulk = await call("POST", `${url}/bulk`, { headers: asA, body: { bulk: [{ ...payloadFor(entity, 21), ...parentsOf(entity, a), [col]: theirTenant }, { ...payloadFor(entity, 22), ...parentsOf(entity, a), [col]: theirTenant }] } });
    const bulkRows: Row[] = Array.isArray(bulk.json) ? bulk.json : [];
    if (bulk.status === 200 || bulk.status === 201) {
      for (const row of bulkRows) {
        made.push(row.id);
        await stored(`[R8] ${n}: a bulk create that names another tenant is stored in the caller's tenant`, row.id);
      }
      t.assert(`[R8] ${n}: a bulk create answers with its rows`, bulkRows.length > 0, bulk.text.slice(0, 200));
    } else t.assert(`[R8] ${n}: a bulk create that names another tenant is refused (${bulk.status})`, bulk.status >= 400 && bulk.status < 500, bulk.text.slice(0, 200));

    for (const [method, what] of [["PATCH", "update"], ["PUT", "replace"]]) {
      const res = await call(method, `${url}/${mine.id}`, { headers: asA, body: { ...payloadFor(entity, 1), ...parentsOf(entity, a), [col]: theirTenant } });
      t.assert(`[R8] ${n}: ${what} own row with another tenant in the body (${res.status})`, res.status < 500 && res.status !== 0, res.text.slice(0, 200));
      await stored(`[R8] ${n}: after that ${what} the row is still in the caller's tenant`, mine.id);
    }
    // Put the row back if an update moved it, so one failure does not cause others.
    await call("PATCH", `${url}/${mine.id}`, { headers: key, body: { [col]: asColumn(entity, a.value) } });
    const steal = await call("PATCH", `${url}/${other.id}`, { headers: asA, body: { [col]: asColumn(entity, a.value) } });
    t.expect(`[R8] ${n}: move another tenant's row into the caller's tenant`, steal, 403, 404);
    const theirsAfter = await call("GET", `${url}/${other.id}`, { headers: key });
    t.assert(`[R8] ${n}: that row is still the other tenant's`, theirsAfter.status === 200 && String(theirsAfter.json?.[col]) === b.value, `${col}=${theirsAfter.json?.[col]}`);
    for (const id of made) if (id !== undefined) await call("DELETE", `${url}/${id}`, { headers: key });
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
    // A filter on a field of the other tenant's row must not say whether it matched.
    const theirs = target && b.rows[target.name];
    if (target?.scope && theirs) {
      const told = await oracle(base + entity.route, asA, relation.property, target, theirs);
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
          const told = await oracle(base + from.route, outsider, relation.property, entity, row);
          t.assert(`[R11] ${n}: a role outside read cannot test ${n} fields through a filter on ${from.name}.${relation.property}`, told === "", `GET ${from.route} ${told}`);
          t.expect(`[R11] ${n}: a role outside read cannot join ${from.name}?join=${relation.property}`, await call("GET", `${base}${from.route}?join=${enc(relation.property)}`, { headers: outsider }), 403);
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
  const names = listed.sort();
  t.assert("[R21] mcp: the tools are the operations the schema opts in, and no others", JSON.stringify(names) === JSON.stringify(expected), `listed ${names.join(",")}; expected ${expected.join(",")}`);

  for (const entity of model.entities) {
    const [mine, other] = [a.rows[entity.name], b.rows[entity.name]];
    if (!entity.scope || !entity.tools.list || !mine || !other) continue;
    const col = entity.scope.field;
    const rest = await call("GET", base + entity.route, { headers: asA });
    const own = typeof rest.json?.total === "number" ? rest.json.total : rowsOf(rest.json).length;
    const [m, o] = [String(mine[col]), String(other[col])];
    const attempts: [string, Row][] = [
      ["no arguments", {}],
      ["filter names the other tenant", { filter: [`${col}||$eq||${o}`] }],
      ["filter own tenant, or the other", { filter: [`${col}||$eq||${m}`], or: [`${col}||$eq||${o}`] }],
      ["two or conditions", { or: [`${col}||$eq||${o}`, `id||$eq||${other.id}`] }],
      ["s names the other tenant", { s: JSON.stringify({ [col]: other[col] }) }],
      ["s $or of both tenants", { s: JSON.stringify({ $or: [{ [col]: mine[col] }, { [col]: other[col] }] }) }],
      ["sort by tenant, a large page", { sort: [`${col},DESC`], limit: 1000 }],
      ...entity.relations.map((r): [string, Row] => [`join ${r.property}`, { join: [r.property] }]),
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
  for (const s of model.skipped) ctx.log?.(`  skip ${s.name}: ${s.reason}`);
  const [a, b] = await seed(ctx);
  try {
    if (ctx.user) {
      // The callers hold every role a permissions list names, so a role check
      // does not hide a tenant check; bypass roles are left out.
      const bypass = new Set(model.entities.flatMap((e) => e.scope?.bypassRoles ?? []));
      const roles = [...new Set(model.entities.flatMap((e) => Object.values(e.permissions ?? {}).flat()))].filter((r) => !bypass.has(r as string)) as string[];
      const asA = ctx.user({ tenant: a.value, roles });
      for (const entity of model.entities) {
        if (entity.scope && a.rows[entity.name] && b.rows[entity.name]) await tenantScope(ctx, entity, a, b, asA);
        else if (!entity.scope) await joinsFromShared(ctx, entity, b, asA);
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
