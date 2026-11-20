import {
  AuthConfig,
  authProviders,
  resolveJwtProviders,
  DB_SESSION_AUTH_DEFAULTS,
  Entity,
  PERMISSION_OPERATIONS,
  PermissionOperation,
  RelationshipMap,
  ScopeOptions,
  isDbSessionAuth,
  ResolvedJwtAuth,
} from "./types";
import pluralize from "pluralize";
import { snakeCase } from "./utils/casing";
import {
  getRelationshipIdField,
  getRelationshipName,
} from "./utils/relationships/parse";

/**
 * Represents a scope field configuration for template rendering
 */
export interface ScopeFieldConfig {
  field: string;
  contextKey: string;
  direct: boolean;
  path?: string;
  /**
   * Nested paths only, set when the relationship map is given: the entity's
   * foreign key to the first hop (taskId), the entity it points to (Task),
   * and the rest of the path on that entity (workspaceId).
   */
  fkField?: string;
  parentEntity?: string;
  parentPath?: string;
}

/**
 * Represents a scoped entity configuration for template rendering
 */
export interface ScopedEntityConfig {
  name: string;
  routeName: string;
  repoName: string;
  scopes: ScopeFieldConfig[];
  bypassRoles: string[];
}

/**
 * Default scope options when not specified
 */
const DEFAULT_SCOPE_OPTIONS: Required<ScopeOptions> = {
  bypassRoles: [],
};

/** scopeOptions keys that no longer exist, and what `apso generate` says about each. */
const REMOVED_SCOPE_OPTIONS: Record<string, string> = {
  injectOnCreate:
    "The tenant on a create always comes from the caller, never from the request body. A service caller (API key) can set any tenant.",
  enforceOn:
    "Every read and write of a tenant-scoped entity by a user caller is limited to the caller's tenant, on every operation. A caller that works across tenants is a service caller (API key).",
};

/**
 * One error per removed scopeOptions key an entity still sets. `apso generate`
 * and `apso schema validate` both refuse it.
 */
export function removedScopeOptionErrors(entities: Entity[]): string[] {
  return entities.flatMap((entity) =>
    Object.entries(REMOVED_SCOPE_OPTIONS)
      .filter(([key]) => (entity.scopeOptions as Record<string, unknown> | undefined)?.[key] !== undefined)
      .map(([key, why]) => `${entity.name}.scopeOptions.${key} is no longer an option; remove it. ${why}`)
  );
}

/**
 * Parses scopeBy configuration and returns structured scope fields.
 */
function parseScopeBy(scopeBy: string | string[]): ScopeFieldConfig[] {
  const scopes = Array.isArray(scopeBy) ? scopeBy : [scopeBy];

  return scopes.map((scope) => {
    const isDirect = !scope.includes(".");
    const field = isDirect ? scope : scope.split(".")[0];
    const contextKey = isDirect ? scope : scope.split(".").pop()!;

    return {
      field,
      contextKey,
      direct: isDirect,
      path: isDirect ? undefined : scope,
    };
  });
}

export function toRouteName(entityName: string): string {
  return pluralize(entityName).toLowerCase();
}

function toRepoName(entityName: string): string {
  const camelCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  return `${camelCase}Repository`;
}

/**
 * A nested path's first segment must be a ManyToOne relationship of the
 * entity: its foreign key is what list queries filter on.
 */
function resolveNestedScope(
  entityName: string,
  scope: ScopeFieldConfig,
  relationshipMap: RelationshipMap
): ScopeFieldConfig {
  if (scope.direct || !scope.path) return scope;
  const relation = (relationshipMap[entityName] ?? []).find(
    (r) => r.type === "ManyToOne" && getRelationshipName(r) === scope.field
  );
  if (!relation)
    throw new Error(
      `${entityName}.scopeBy "${scope.path}": "${scope.field}" must be a many-to-one relationship of ${entityName}`
    );
  return {
    ...scope,
    fkField: getRelationshipIdField(relation),
    parentEntity: relation.name,
    parentPath: scope.path.split(".").slice(1).join("."),
  };
}

/**
 * Extracts scoped entity configurations from all entities. Pass the
 * relationship map to resolve nested paths to their foreign keys.
 */
export function getScopedEntities(
  entities: Entity[],
  relationshipMap?: RelationshipMap
): ScopedEntityConfig[] {
  return entities
    .filter((entity) => entity.scopeBy)
    .map((entity) => {
      const options = { ...DEFAULT_SCOPE_OPTIONS, ...entity.scopeOptions };
      const scopes = parseScopeBy(entity.scopeBy!);

      return {
        name: entity.name,
        routeName: toRouteName(entity.name),
        repoName: toRepoName(entity.name),
        scopes: relationshipMap
          ? scopes.map((s) => resolveNestedScope(entity.name, s, relationshipMap))
          : scopes,
        bypassRoles: options.bypassRoles,
      };
    });
}

/**
 * Checks if any entities have scopeBy configured.
 */
export function hasScopedEntities(entities: Entity[]): boolean {
  return entities.some((entity) => entity.scopeBy);
}

/**
 * Operations an entity exposes as MCP tools, from its `mcp` setting.
 * Empty when the entity has not opted in.
 */
export function mcpOperations(entity: Entity): PermissionOperation[] {
  if (!entity.mcp) return [];
  if (entity.mcp === true) return [...PERMISSION_OPERATIONS];
  const bad =
    !Array.isArray(entity.mcp) ||
    entity.mcp.find((op) => !PERMISSION_OPERATIONS.includes(op));
  if (bad)
    throw new Error(
      `${entity.name}.mcp must be true or a list of ${PERMISSION_OPERATIONS.join(", ")}`
    );
  return [...new Set(entity.mcp)];
}

/**
 * Better Auth's tables by entity name (any case) and the fields that mark
 * them, so a domain entity that shares a name (a billing Account) is not
 * taken for one. The OAuth provider's tables have names no domain entity
 * would use, so the name is enough.
 */
const BETTER_AUTH_TABLES: Record<string, string[]> = {
  session: ["token"],
  account: ["providerId", "accountId"],
  verification: ["identifier", "value"],
  // Organization plugin: who belongs to which tenant, with which role.
  member: ["role"],
  invitation: ["email", "status"],
  // JWT plugin: the signing keys.
  jwks: ["publicKey", "privateKey"],
  oauthclient: [],
  oauthresource: [],
  oauthclientresource: [],
  oauthrefreshtoken: [],
  oauthaccesstoken: [],
  oauthconsent: [],
  oauthclientassertion: [],
};

/**
 * The entities that store Better Auth's own rows when the better-auth
 * provider is listed: the auth block's session, user and membership
 * (accountUserEntity) entities, and Better Auth's other tables (account,
 * verification, the organization plugin's member and invitation, the JWT
 * plugin's jwks, the OAuth provider's tables). Only a service caller (API
 * key) reaches them: the key guard refuses a signed-in user on their routes,
 * no other entity's controller joins onto them, and they cannot be MCP tools.
 */
export function authEntityNames(entities: Entity[], auth?: AuthConfig): string[] {
  const betterAuth = authProviders(auth).find((a) => isDbSessionAuth(a));
  if (!betterAuth) return [];
  const { sessionEntity, userEntity, accountUserEntity } = {
    ...DB_SESSION_AUTH_DEFAULTS,
    ...betterAuth,
  };
  const named = new Set([sessionEntity, userEntity, accountUserEntity]);
  const found = entities.filter((entity) => {
    const fields = new Set((entity.fields ?? []).map((f) => f.name));
    return (
      named.has(entity.name) ||
      BETTER_AUTH_TABLES[entity.name.toLowerCase()]?.every((f) => fields.has(f))
    );
  });
  const tool = found.find((entity) => mcpOperations(entity).length > 0);
  if (tool)
    throw new Error(
      `${tool.name}.mcp: ${tool.name} is an auth entity, which only a service caller (API key) may call, so it cannot be exposed as MCP tools`
    );
  return found.map((entity) => entity.name);
}

/**
 * True for a relation that a response must not carry: one from another entity
 * onto an auth entity. Auth entities keep the relations between themselves.
 */
export function hidesRelation(
  entityName: string,
  relatedName: string,
  entities: Entity[],
  auth?: AuthConfig
): boolean {
  const names = authEntityNames(entities, auth);
  return !names.includes(entityName) && names.includes(relatedName);
}

/** The auth entities' route names (sessions), for the key guard. */
export const authEntityRoutes = (entities: Entity[], auth?: AuthConfig): string[] =>
  authEntityNames(entities, auth).map((name) => toRouteName(name));

/**
 * An entity's MCP operations and the names its tools get, the same in every
 * language: list_line_items, get_line_item, create_line_item and so on.
 * `mcp` does not need an auth block: without one the tools are served to
 * service callers only. The second argument is no longer read.
 */
export function mcpToolNames(entity: Entity, _auth?: AuthConfig) {
  return {
    mcp: mcpOperations(entity),
    mcpName: snakeCase(entity.name),
    mcpPluralName: snakeCase(pluralize(entity.name)),
  };
}

export function hasPermissions(entities: Entity[]): boolean {
  return entities.some((entity) => entity.permissions);
}

/** One guarded operation: its permission name and the roles that have it by default. */
export interface PermissionRule {
  permission: string;
  roles: string[];
}

/** What the permission guard template needs. */
export interface PermissionConfig {
  /** Guarded operations by route name (projects). */
  routes: Record<string, Partial<Record<PermissionOperation, PermissionRule>>>;
  /**
   * Read rules a `?join` must satisfy, by relation name (singular and plural).
   * A name shared by relations to different entities must satisfy all of them.
   */
  joins: Record<string, PermissionRule[]>;
  /** The entity whose rows grant permissions to roles at runtime, if declared. */
  grants?: { entity: string; tenantField?: string };
}

const permissionKey = (entityName: string): string =>
  entityName.charAt(0).toLowerCase() + entityName.slice(1);

/**
 * The grants entity, checked so it cannot become an escalation path: its
 * writes must be role-guarded, and in a multi-tenant schema it must be
 * tenant-scoped so a grant made in one tenant does not apply in another.
 */
function resolveGrants(
  entities: Entity[],
  auth?: AuthConfig
): PermissionConfig["grants"] {
  // One grants entity per service, whichever provider signed the caller in.
  const named = [
    ...new Set(authProviders(auth).map((a) => a.permissionEntity).filter(Boolean)),
  ];
  if (named.length > 1)
    throw new Error(
      `auth providers name different permissionEntity values (${named.join(", ")}); a service has one`
    );
  const name = named[0] ?? "RolePermission";
  const entity = entities.find((e) => e.name === name);
  if (!entity) {
    if (named.length > 0)
      throw new Error(`auth.permissionEntity "${name}" is not an entity in .apsorc`);
    return undefined;
  }
  const fields = new Set((entity.fields ?? []).map((f) => f.name));
  for (const field of ["role", "permission"])
    if (!fields.has(field))
      throw new Error(`Entity ${name} needs a "${field}" text field to grant permissions`);
  const writes = entity.permissions ?? {};
  if (!writes.create || !writes.update || !writes.delete)
    throw new Error(
      `${name}.permissions must list roles for create, update and delete; otherwise any signed-in user can grant themselves any permission`
    );
  const scopes = entity.scopeBy ? [entity.scopeBy].flat() : [];
  const tenantField = scopes.find((s) => !s.includes("."));
  if (!tenantField && entities.some((e) => e !== entity && e.scopeBy))
    throw new Error(
      `${name} needs a direct scopeBy field: this schema is tenant-scoped, and an unscoped grant would apply in every tenant`
    );
  return { entity: name, tenantField };
}

/**
 * Validates every entity's permissions and resolves them to permission names
 * ("invoice:delete") by route and by join name, so a role that cannot read
 * Task cannot read it through /projects?join=tasks either. Undefined when no
 * entity has permissions.
 */
export function getPermissionConfig(
  entities: Entity[],
  relationshipMap?: RelationshipMap,
  auth?: AuthConfig
): PermissionConfig | undefined {
  if (!hasPermissions(entities)) return undefined;
  const byEntity: Record<string, Partial<Record<PermissionOperation, PermissionRule>>> = {};
  for (const entity of entities) {
    if (!entity.permissions) continue;
    const rules: Partial<Record<PermissionOperation, PermissionRule>> = {};
    for (const [op, roles] of Object.entries(entity.permissions)) {
      if (!(PERMISSION_OPERATIONS as readonly string[]).includes(op))
        throw new Error(
          `${entity.name}.permissions: unknown operation "${op}"; use ${PERMISSION_OPERATIONS.join(", ")}`
        );
      if (!Array.isArray(roles) || roles.some((r) => typeof r !== "string" || !r))
        throw new Error(`${entity.name}.permissions.${op} must be a list of role names`);
      rules[op as PermissionOperation] = {
        permission: `${permissionKey(entity.name)}:${op}`,
        roles,
      };
    }
    byEntity[entity.name] = rules;
  }

  const routes: PermissionConfig["routes"] = {};
  for (const [name, rules] of Object.entries(byEntity))
    routes[toRouteName(name)] = rules;

  const joins: PermissionConfig["joins"] = {};
  for (const relations of Object.values(relationshipMap ?? {})) {
    for (const relation of relations) {
      const read = byEntity[relation.name]?.read;
      if (!read) continue;
      const name = getRelationshipName(relation);
      for (const key of new Set([name, pluralize(name)])) {
        const list = joins[key] ?? [];
        if (!list.some((rule) => rule.permission === read.permission))
          list.push(read);
        joins[key] = list;
      }
    }
  }
  return { routes, joins, grants: resolveGrants(entities, auth) };
}

/** A direct scopeBy field and the auth context value that fills it. */
export interface DirectScopeField {
  field: string;
  /** userId and email map to the caller's own; anything else is the tenant. */
  source: "userId" | "email" | "tenant";
}

/** What Go and Python services need to scope one entity. */
export interface EntityScopeData {
  fields: DirectScopeField[];
  bypassRoles: string[];
}

/**
 * The direct scopeBy fields of an entity, for services that filter in their
 * own queries (Go, Python). Undefined without auth: with no caller identity
 * there is no tenant to scope by. Nested paths (task.workspaceId) are not
 * included; see hasNestedScopes.
 */
export function entityScope(
  entity: Entity,
  hasAuth: boolean
): EntityScopeData | undefined {
  if (!hasAuth || !entity.scopeBy) return undefined;
  const [config] = getScopedEntities([entity]);
  const fields = config.scopes
    .filter((s) => s.direct)
    .map((s) => ({
      field: s.field,
      source:
        s.contextKey === "userId" || s.contextKey === "email"
          ? (s.contextKey as "userId" | "email")
          : ("tenant" as const),
    }));
  if (fields.length === 0) return undefined;
  return {
    fields,
    bypassRoles: config.bypassRoles,
  };
}

/** One entity in the relation table every generated service checks. */
export interface RelationScope {
  /** Set when the entity's reads are tenant-scoped: the roles that skip its scope. */
  bypassRoles?: string[];
  /**
   * Set with bypassRoles: the entity's own scopeBy fields and the caller
   * value each must equal (userId, email, or any other name for the tenant).
   * Rows loaded through a relation are limited by these, so a row that points
   * at another tenant's row does not carry it into a response.
   */
  scope?: Record<string, string>;
  /**
   * Each relation a request can load, by the name requests use: the entity it
   * loads, and whether a caller limited to its tenant on this entity stays in
   * that tenant on the related rows (the target is scoped by the same keys).
   */
  relations: Record<string, [entity: string, sameTenant: boolean]>;
}

/**
 * The relation table for the one rule on loading relations (R7): the tenant
 * filter limits only the entity a request starts from, so a user caller may
 * load a relation onto a tenant-scoped entity only when
 * - the caller holds a role that skips that entity's scope, or
 * - the caller is limited to its tenant on the entity the relation starts
 *   from, and the target is scoped by the same keys (Project.tasks).
 * Any other load is refused, for every query syntax and at every depth. The
 * rows of an allowed same-key relation are still limited to the caller's
 * tenant by the target's own scope fields (`scope`), so the rule does not rely
 * on every stored foreign key pointing inside the tenant. A service caller is
 * not limited. Each language walks this table at run time.
 *
 * Undefined without auth or when no entity is scoped.
 */
export function relationScopes(
  entities: Entity[],
  relationshipMap: RelationshipMap | undefined,
  hasAuth: boolean
): Record<string, RelationScope> | undefined {
  if (!hasAuth) return undefined;
  const scoped = new Map<
    string,
    { keys: Set<string>; bypassRoles: string[]; scope: Record<string, string>; parents: string[] }
  >();
  for (const config of getScopedEntities(entities, relationshipMap)) {
    scoped.set(config.name, {
      keys: new Set(config.scopes.map((s) => s.contextKey)),
      bypassRoles: config.bypassRoles,
      scope: Object.fromEntries(
        config.scopes.filter((s) => s.direct).map((s) => [s.field, s.contextKey])
      ),
      // Entities this one is scoped through (project.organizationId -> Project).
      parents: config.scopes.filter((s) => !s.direct).map((s) => s.parentEntity ?? ""),
    });
  }
  if (scoped.size === 0) return undefined;
  const table: Record<string, RelationScope> = {};
  for (const entity of entities) {
    const from = scoped.get(entity.name);
    const relations: RelationScope["relations"] = {};
    for (const relation of relationshipMap?.[entity.name] ?? []) {
      const name = getRelationshipName(relation);
      const many = relation.type === "OneToMany" || relation.type === "ManyToMany";
      const to = scoped.get(relation.name);
      // A target scoped through a parent has no tenant column to check on the
      // loaded rows. Its rows are the caller's by definition only when loaded
      // from that parent, through the one relation between the two.
      const fromParent =
        !to ||
        to.parents.every(
          (parent) =>
            parent === entity.name &&
            (relationshipMap?.[entity.name] ?? []).filter((r) => r.name === relation.name).length === 1
        );
      relations[many ? pluralize(name) : name] = [
        relation.name,
        Boolean(from && to && fromParent && [...to.keys].every((key) => from.keys.has(key))),
      ];
    }
    table[entity.name] = { bypassRoles: from?.bypassRoles, scope: from?.scope, relations };
  }
  return table;
}

/** Entities whose scopeBy uses a nested path, which Go and Python cannot enforce. */
export function nestedScopeEntities(entities: Entity[]): string[] {
  return getScopedEntities(entities)
    .filter((e) => e.scopes.some((s) => !s.direct))
    .map((e) => e.name);
}

/**
 * One warning per provider that maps no tenant claim while entities are
 * tenant-scoped: its users would get 403 on every one of those entities.
 */
export function tenantClaimWarnings(
  entities: Entity[],
  auth?: AuthConfig
): string[] {
  const scoped = getScopedEntities(entities)
    .filter((e) =>
      e.scopes.some((s) => s.contextKey !== "userId" && s.contextKey !== "email")
    )
    .map((e) => e.name);
  if (scoped.length === 0) return [];
  const names =
    scoped.length > 2
      ? `${scoped[0]}, ${scoped[1]} and ${scoped.length - 2} more are`
      : `${scoped.join(" and ")} ${scoped.length === 1 ? "is" : "are"}`;
  const listed = Array.isArray(auth) && auth.length > 1;
  return resolveJwtProviders(auth)
    .filter((p) => !p.claims.workspaceId && !p.claims.organizationId)
    .map(
      (p) =>
        `auth provider "${p.provider}" (${p.issuer}) has no tenant claim, but ${names} tenant-scoped. Tokens from this provider will get 403 "No tenant in the auth context" on ${scoped.length === 1 ? "that entity" : "those entities"}. Set ${listed ? "claims.organizationId on that provider" : "auth.claims.organizationId"} to the claim that holds the tenant.`
    );
}

/**
 * The foreign keys of an entity that point at a tenant-scoped entity, as
 * field -> that entity, from [field, entity] pairs in the generator's own
 * naming. On a write a user caller may only name rows it could read there
 * (R8). The entity's own scopeBy fields are left out: a write sets those from
 * the caller.
 */
export function scopedReferences(
  entity: Entity,
  foreignKeys: [field: string, target: string][],
  scopes: Record<string, RelationScope> | undefined
): Record<string, string> {
  const own = new Set(entity.scopeBy ? [entity.scopeBy].flat() : []);
  return Object.fromEntries(
    foreignKeys.filter(
      ([field, target]) => !own.has(field) && scopes?.[target]?.bypassRoles !== undefined
    )
  );
}

/*
 * Access text for the OpenAPI contract (/_docs-json). An app builder reading
 * the contract should leave these rules to the API instead of copying them
 * into the browser: matching users to roles by email, sending the tenant on a
 * write, hiding a delete button as the only check.
 */

const PROVIDER_NAMES: Record<string, string> = {
  "better-auth": "Better Auth",
  auth0: "Auth0",
  clerk: "Clerk",
  cognito: "Amazon Cognito",
  jwt: "a JWT issuer",
};

const KEY_ONLY_DESCRIPTION =
  "Every request needs the service API key in the `x-api-key` header; without it the API answers 401. " +
  "The key is for server-side callers only. Never put it in a browser app: a browser app calls its own backend, which calls this API.";

/** "the token's `o.rol` claim", naming each provider's claim when they differ. */
function claimText(providers: ResolvedJwtAuth[], pick: (p: ResolvedJwtAuth) => string | undefined): string | undefined {
  const names = [...new Set(providers.map((p) => pick(p)).filter((n): n is string => Boolean(n)))];
  if (names.length === 0) return undefined;
  return `the token's ${names.map((n) => `\`${n}\``).join(" or ")} claim`;
}

const tenantClaim = (p: ResolvedJwtAuth) => p.claims.workspaceId ?? p.claims.organizationId;

const joinWords = (words: string[], last = "and"): string =>
  words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;

/**
 * One operation's role rule as a sentence, for its OpenAPI description:
 * "Requires role: manager (from the token's `o.rol` claim). Other callers get 403."
 */
export function roleRuleText(rule: PermissionRule, auth?: AuthConfig): string {
  const providers = resolveJwtProviders(auth);
  const roles = claimText(providers, (p) => p.claims.roles);
  const perms = claimText(providers, (p) => p.claims.permissions);
  return (
    `Requires role: ${joinWords(rule.roles, "or")}${roles ? ` (from ${roles})` : " (from the token)"}` +
    `${perms ? `, or \`${rule.permission}\` in ${perms}` : ""}. Other signed-in users get 403. ` +
    "The API checks this; a client app must not re-implement it."
  );
}

/** Each guarded operation of an entity and its rule, from .apsorc permissions. */
export function entityRoleRules(entity: Entity): Partial<Record<PermissionOperation, PermissionRule>> {
  return Object.fromEntries(
    Object.entries(entity.permissions ?? {}).map(([op, roles]) => [
      op,
      { permission: `${permissionKey(entity.name)}:${op}`, roles: roles ?? [] },
    ])
  );
}

/**
 * The OpenAPI info.description: who signs callers in, how records are scoped
 * and which operations need which role, in plain words.
 */
export function accessSummary(entities: Entity[], auth?: AuthConfig): string {
  const providers = resolveJwtProviders(auth);
  if (providers.length === 0) return KEY_ONLY_DESCRIPTION;
  const lines: string[] = [
    "**Access rules.** This API enforces every rule below on every request. A client app must not re-implement them: " +
      "do not look users up to decide their role, do not send the tenant field, and do not treat a hidden button as the check.",
    "",
    `- **Sign-in:** ${joinWords(
      [...new Set(providers.map((p) => (p.provider === "jwt" ? `a JWT issuer (${p.issuer})` : PROVIDER_NAMES[p.provider])))],
      "or"
    )}. Send the signed-in user's token as \`Authorization: Bearer <token>\`. Without a valid token the API answers 401.`,
  ];

  const tenant = claimText(providers, tenantClaim) ?? "the token's tenant claim";
  const user = claimText(providers, (p) => p.claims.userId) ?? "the token's `sub` claim";
  // Entities by scope sentence, so a schema scoped by one field reads as one line.
  const byScope = new Map<string, { names: string[]; fields: string[] }>();
  for (const { name, scopes, bypassRoles } of getScopedEntities(entities)) {
    const parts = scopes.map((s) =>
      s.direct
        ? `\`${s.field}\` is taken from ${s.contextKey === "userId" ? user : s.contextKey === "email" ? "the token's email claim" : tenant}`
        : `rows are limited through \`${s.path}\` to the caller's tenant (${tenant})`
    );
    const bypass = bypassRoles.length > 0 ? ` Callers with role ${joinWords(bypassRoles, "or")} see every tenant.` : "";
    const key = `${parts.join("; ")}.${bypass}`;
    const group = byScope.get(key) ?? { names: [], fields: scopes.filter((s) => s.direct).map((s) => `\`${s.field}\``) };
    group.names.push(name);
    byScope.set(key, group);
  }
  for (const [scope, { names, fields }] of byScope) {
    const it = fields.length > 1 ? "them" : "it";
    lines.push(
      `- **Scoped records:** ${joinWords(names)}: ${scope} Reads and lists return only the caller's records` +
        (fields.length > 0
          ? `, and creates and updates set ${joinWords(fields)} from the token. The client must not send ${it} or filter by ${it}.`
          : ".")
    );
  }

  const guarded = entities.filter((e) => e.permissions && Object.keys(e.permissions).length > 0);
  if (guarded.length > 0) {
    const roles = claimText(providers, (p) => p.claims.roles) ?? "the token";
    const perms = claimText(providers, (p) => p.claims.permissions);
    lines.push(
      `- **Roles** come from ${roles}${perms ? ` (a permission such as \`${permissionKey(guarded[0].name)}:delete\` in ${perms} also passes)` : ""}. ` +
        "A caller without the role gets 403. Operations not listed are open to any signed-in user:"
    );
    for (const entity of guarded) {
      // Operations that need the same roles share a clause.
      const byRoles = new Map<string, string[]>();
      for (const op of PERMISSION_OPERATIONS) {
        const roles = entity.permissions?.[op];
        if (!roles) continue;
        const key = joinWords(roles, "or");
        byRoles.set(key, [...(byRoles.get(key) ?? []), op]);
      }
      const clauses = [...byRoles].map(([roles, ops]) => `${joinWords(ops)} need${ops.length === 1 ? "s" : ""} ${roles}`);
      lines.push(`  - ${entity.name}: ${clauses.join("; ")}.`);
    }
    lines.push(
      "- To show only the actions a user may take, read the role from the same token, and still handle 403."
    );
  }

  lines.push(
    "- **API key:** server-side callers may send the service key in `x-api-key` instead of a token. It is not limited to one tenant or role. Never put it in a browser app."
  );
  return lines.join("\n");
}
