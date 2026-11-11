import { expect, jest } from "@jest/globals";

// A stand-in platform: PATCH stores the body on the service row, GET returns it.
let service: Record<string, unknown>;
jest.mock("../../../src/lib/api/client", () => ({
  api: {
    get: async () => service,
    patch: async (_path: string, body: Record<string, unknown>) => {
      service = { ...service, ...JSON.parse(JSON.stringify(body)) };
      return service;
    },
  },
}));

import { schemaApi } from "../../../src/lib/api/services";
import { ApiType, ApsorcType } from "../../../src/lib/apsorc-parser";

const plain: ApsorcType = {
  version: 2,
  rootFolder: "src",
  apiType: ApiType.Rest,
  entities: [
    { name: "Invoice", fields: [{ name: "status", type: "enum", values: ["Open", "Paid"] }] },
    { name: "Customer", fields: [{ name: "name", type: "text" }] },
  ],
  relationships: [{ from: "Invoice", to: "Customer", type: "ManyToOne" }],
};

const withEntity = (settings: Record<string, unknown>): ApsorcType => ({
  ...plain,
  entities: [{ ...plain.entities[0], ...settings }, plain.entities[1]],
});

beforeEach(() => {
  service = { id: 7 };
});

const cases: [string, ApsorcType][] = [
  ["mcp: true", withEntity({ mcp: true })],
  ["mcp as an operation list", withEntity({ mcp: ["read", "create"] })],
  ["permissions", withEntity({ permissions: { delete: ["admin"], update: [] } })],
  [
    "scopeOptions",
    withEntity({
      scopeBy: "workspaceId",
      scopeOptions: { injectOnCreate: false, enforceOn: ["find"], bypassRoles: ["system_admin"] },
    }),
  ],
  [
    "auth",
    {
      ...plain,
      auth: {
        provider: "auth0",
        permissionEntity: "RolePermission",
        jwt: { issuer: "https://x.auth0.com/", audience: "api" },
      },
    },
  ],
  ["no optional settings", plain],
];
for (const [name, local] of cases) {
  test(`push then pull keeps ${name} unchanged`, async () => {
    await schemaApi.update("ws", "7", local);
    expect(await schemaApi.get("ws", "7")).toEqual(local);
    const diff = await schemaApi.diff("ws", "7", local);
    expect(diff.hasChanges).toBe(false);
  });
}

test("diff sees a setting the platform does not have yet", async () => {
  await schemaApi.update("ws", "7", plain);
  const diff = await schemaApi.diff("ws", "7", withEntity({ mcp: true }));
  expect(diff).toEqual({ hasChanges: true, added: [], removed: [], modified: ["Invoice"] });
});

test("pull reads a schema an old row stored as a JSON string", async () => {
  service = { id: 7, apsorc: JSON.stringify(plain) };
  expect(await schemaApi.get("ws", "7")).toEqual(plain);
});

test("pull returns null when the service has no schema", async () => {
  expect(await schemaApi.get("ws", "7")).toBeNull();
});
