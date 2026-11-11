import { expect, describe, test } from "@jest/globals";
import { accessRuleErrors } from "../../../src/commands/schema/validate";
import { parseApsorcV2, ApsorcType } from "../../../src/lib/apsorc-parser";
import { TargetLanguage } from "../../../src/lib/types";

const JWT = { provider: "jwt", jwt: { issuer: "https://issuer.test" } };

/** accessRuleErrors for an .apsorc with one Invoice entity. */
const check = (
  rc: { auth?: unknown; invoice?: object; entities?: object[] },
  language: TargetLanguage = "typescript"
) => {
  const entities = [
    {
      name: "Invoice",
      created_at: true,
      updated_at: true,
      fields: [{ name: "total", type: "integer" }],
      ...rc.invoice,
    },
    ...(rc.entities ?? []),
  ];
  const parsed = parseApsorcV2({ version: 2, entities, relationships: [] } as unknown as ApsorcType);
  return accessRuleErrors({ ...parsed, rootFolder: "src", apiType: "Rest", auth: rc.auth as never, language });
};

describe("apso schema validate: the rules apso generate enforces", () => {
  test("a schema with no auth, permissions or mcp passes in every language", async () => {
    for (const language of ["typescript", "python", "go"] as TargetLanguage[])
      // eslint-disable-next-line no-await-in-loop -- each language is checked in turn
      expect(await check({}, language)).toEqual([]);
  });

  describe("auth", () => {
    test("a JWT provider with an issuer passes", async () => {
      expect(await check({ auth: JWT })).toEqual([]);
    });
    test("a JWT provider with no issuer fails", async () => {
      expect(await check({ auth: { provider: "auth0", jwt: {} } })).toEqual([
        expect.stringContaining("auth.jwt.issuer is required"),
      ]);
    });
    test("a symmetric algorithm fails", async () => {
      const auth = { provider: "jwt", jwt: { issuer: "https://issuer.test", algorithms: ["HS256"] } };
      expect(await check({ auth })).toEqual([expect.stringContaining("HS256 not supported")]);
    });
    test("a database-session provider fails outside TypeScript", async () => {
      expect(await check({ auth: { provider: "better-auth" } }, "python")).toEqual([
        expect.stringContaining("TypeScript services only"),
      ]);
    });
  });

  describe("permissions", () => {
    test("role lists with sign-in pass", async () => {
      expect(await check({ auth: JWT, invoice: { permissions: { read: ["owner"] } } })).toEqual([]);
    });
    test("an unknown operation fails", async () => {
      expect(await check({ auth: JWT, invoice: { permissions: { list: ["owner"] } } })).toEqual([
        expect.stringContaining('unknown operation "list"'),
      ]);
    });
    test("permissions with no auth block fail", async () => {
      expect(await check({ invoice: { permissions: { read: ["owner"] } } })).toEqual([
        expect.stringContaining("permissions in .apsorc need an auth block"),
      ]);
    });
    test("a grants entity anyone can write to fails", async () => {
      const grants = {
        name: "RolePermission",
        fields: [{ name: "role", type: "text" }, { name: "permission", type: "text" }],
      };
      expect(
        await check({ auth: JWT, invoice: { permissions: { read: ["owner"] } }, entities: [grants] })
      ).toEqual([expect.stringContaining("RolePermission.permissions must list roles")]);
    });
    test("permissions fail outside TypeScript", async () => {
      expect(await check({ auth: JWT, invoice: { permissions: { read: ["owner"] } } }, "go")).toEqual([
        expect.stringContaining("TypeScript services only"),
      ]);
    });
  });

  describe("mcp", () => {
    test("opted-in operations with sign-in pass", async () => {
      expect(await check({ auth: JWT, invoice: { mcp: ["read"] } })).toEqual([]);
      expect(await check({ auth: JWT, invoice: { mcp: true } })).toEqual([]);
    });
    test("an unknown operation fails", async () => {
      expect(await check({ auth: JWT, invoice: { mcp: ["list"] } })).toEqual([
        expect.stringContaining("Invoice.mcp must be true or a list of"),
      ]);
    });
    test("mcp with no auth block fails", async () => {
      expect(await check({ invoice: { mcp: true } })).toEqual([
        expect.stringContaining("Invoice.mcp needs an auth block"),
      ]);
    });
    test("mcp fails outside TypeScript", async () => {
      expect(await check({ auth: JWT, invoice: { mcp: true } }, "python")).toEqual([
        expect.stringContaining("TypeScript services only"),
      ]);
    });
  });
});
