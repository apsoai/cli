import { expect, describe, test } from "@jest/globals";
import { getPermissionConfig } from "../../../src/lib/guards";
import { GoGenerator } from "../../../src/lib/generators/go";
import { PythonGenerator } from "../../../src/lib/generators/python";
import { TypeScriptGenerator } from "../../../src/lib/generators/typescript";
import { AuthConfig, Entity, GeneratorConfig, RelationshipMap, TargetLanguage } from "../../../src/lib/types";

const entities: Entity[] = [
  { name: "Organization", fields: [{ name: "name", type: "text" }] },
  {
    name: "Project",
    scopeBy: "organizationId",
    permissions: { delete: ["admin"] },
    fields: [{ name: "title", type: "text" }],
  },
  {
    name: "Invoice",
    permissions: { read: ["admin", "billing"], create: [] },
    fields: [{ name: "total", type: "integer" }],
  },
];
const relationshipMap: RelationshipMap = {
  Organization: [{ name: "Invoice", type: "OneToMany" }],
  Invoice: [{ name: "Organization", type: "ManyToOne" }],
};
const jwt: AuthConfig = { provider: "jwt", jwt: { issuer: "https://issuer.example.com/", audience: "api" } };

// Each constructor points Eta at its language's templates, so build at the point of use.
const generator = (language: TargetLanguage) => {
  const config: GeneratorConfig = { rootFolder: "/tmp/perm-test", entities, relationshipMap, apiType: "rest", language };
  if (language === "go") return new GoGenerator(config);
  if (language === "python") return new PythonGenerator(config);
  return new TypeScriptGenerator(config);
};

const bad = (permissions: unknown) =>
  getPermissionConfig([{ name: "Project", permissions: permissions as any }]);

describe("getPermissionConfig", () => {
  test("is undefined when no entity has permissions", () => {
    expect(getPermissionConfig([{ name: "Project" }])).toBeUndefined();
  });

  test("names each guarded operation and maps joins to the target's read rule", () => {
    const config = getPermissionConfig(entities, relationshipMap)!;
    expect(config.routes).toEqual({
      projects: { delete: { permission: "project:delete", roles: ["admin"] } },
      invoices: {
        read: { permission: "invoice:read", roles: ["admin", "billing"] },
        create: { permission: "invoice:create", roles: [] },
      },
    });
    // /organizations?join=invoices must not leak invoices to a member.
    const read = { permission: "invoice:read", roles: ["admin", "billing"] };
    expect(config.joins).toEqual({ invoice: [read], invoices: [read] });
    expect(config.grants).toBeUndefined();
  });

  test("rejects an unknown operation and a non-list", () => {
    expect(() => bad({ write: ["admin"] })).toThrow('unknown operation "write"');
    expect(() => bad({ delete: "admin" })).toThrow("must be a list of role names");
    expect(() => bad({ delete: [""] })).toThrow("must be a list of role names");
  });
});

const grantsEntity = (extra: Partial<Entity> = {}): Entity => ({
  name: "RolePermission",
  scopeBy: "organizationId",
  permissions: { create: ["owner"], update: ["owner"], delete: ["owner"] },
  fields: [
    { name: "role", type: "text" },
    { name: "permission", type: "text" },
  ],
  ...extra,
});

describe("grants entity", () => {
  test("is used when declared, with its tenant field", () => {
    const config = getPermissionConfig([...entities, grantsEntity()], relationshipMap)!;
    expect(config.grants).toEqual({ entity: "RolePermission", tenantField: "organizationId" });
  });

  test("must guard its own writes, or anyone could grant themselves anything", () => {
    const open = grantsEntity({ permissions: { create: ["owner"] } });
    expect(() => getPermissionConfig([...entities, open])).toThrow("any signed-in user can grant themselves");
  });

  test("must be tenant-scoped when the schema is", () => {
    const global = grantsEntity({ scopeBy: undefined });
    expect(() => getPermissionConfig([...entities, global])).toThrow("would apply in every tenant");
  });

  test("needs role and permission fields, and a named entity must exist", () => {
    expect(() => getPermissionConfig([...entities, grantsEntity({ fields: [{ name: "role", type: "text" }] })])).toThrow(
      '"permission" text field'
    );
    expect(() => getPermissionConfig(entities, {}, { provider: "better-auth", permissionEntity: "Grant" })).toThrow(
      'auth.permissionEntity "Grant" is not an entity'
    );
  });
});

describe("TypeScript permission guard", () => {
  test("renders the role table and registers it between the key check and scope", async () => {
    const files = await generator("typescript").generateGuards(entities, jwt, relationshipMap);
    const guard = files.find((f) => f.path === "guards/permission.guard.ts")!.content;
    expect(guard).toContain('"permission": "invoice:create"');
    expect(guard).toContain("Missing permission");
    expect(guard).not.toContain("DataSource");

    const withGrants = await generator("typescript").generateGuards([...entities, grantsEntity()], jwt, relationshipMap);
    const grantGuard = withGrants.find((f) => f.path === "guards/permission.guard.ts")!.content;
    expect(grantGuard).toContain(".getRepository('RolePermission')");
    expect(grantGuard).toContain("organizationId: IsNull()");

    const mod = files.find((f) => f.path === "guards/guards.module.ts")!.content;
    const order = ["useExisting: ApiKeyGuard", "useClass: PermissionGuard", "useClass: ScopeGuard"].map((s) => mod.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("no permissions, no guard", async () => {
    const plain = entities.map((e) => ({ ...e, permissions: undefined }));
    const files = await generator("typescript").generateGuards(plain, jwt, relationshipMap);
    expect(files.some((f) => f.path === "guards/permission.guard.ts")).toBe(false);
    expect(files.find((f) => f.path === "guards/guards.module.ts")!.content).not.toContain("PermissionGuard");
  });

  test("permissions without auth is an error, not an open API", async () => {
    await expect(generator("typescript").generateGuards(entities, undefined, relationshipMap)).rejects.toThrow(
      "permissions in .apsorc need an auth block"
    );
  });
});

describe.each(["python", "go"] as const)("%s", (language) => {
  test("refuses permissions it cannot enforce yet", async () => {
    await expect(generator(language).generateGuards(entities, jwt)).rejects.toThrow("TypeScript services only");
  });
});
