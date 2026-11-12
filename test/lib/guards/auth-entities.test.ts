import { expect, describe, test } from "@jest/globals";
import { authEntityNames, authEntityRoutes, hidesRelation } from "../../../src/lib/guards";
import { AuthConfig, Entity } from "../../../src/lib/types";

const text = (name: string) => ({ name, type: "text" as const });
const entities: Entity[] = [
  { name: "User", fields: [text("email")] },
  { name: "account", fields: [text("providerId"), text("accountId"), text("password")] },
  { name: "session", fields: [text("token")] },
  { name: "verification", fields: [text("identifier"), text("value")] },
  { name: "AccountUser", fields: [text("role")] },
  { name: "Project", fields: [text("title")] },
];
const betterAuth: AuthConfig = { provider: "better-auth", url: "https://app.example.com/api/auth" };

describe("authEntityNames", () => {
  test("names the session, user and membership entities and Better Auth's tables", () => {
    expect(authEntityNames(entities, betterAuth)).toEqual(["User", "account", "session", "verification", "AccountUser"]);
    expect(authEntityRoutes(entities, betterAuth)).toEqual(["users", "accounts", "sessions", "verifications", "accountusers"]);
  });

  test("follows the entity names in the auth block", () => {
    const renamed = [{ name: "Login", fields: [text("token")] }, { name: "Person" }, { name: "Member" }, { name: "User" }];
    const auth: AuthConfig = { ...(betterAuth as any), sessionEntity: "Login", userEntity: "Person", accountUserEntity: "Member" };
    expect(authEntityNames(renamed, auth)).toEqual(["Login", "Person", "Member"]);
    // Also when Better Auth is one of several providers.
    expect(authEntityNames(renamed, [{ provider: "jwt", jwt: { issuer: "https://staff.example.com" } }, auth as any])).toEqual(["Login", "Person", "Member"]);
  });

  test("names the organization, JWT and OAuth provider plugins' tables", () => {
    const plugins: Entity[] = [
      { name: "member", fields: [text("role")] },
      { name: "invitation", fields: [text("email"), text("status")] },
      { name: "jwks", fields: [text("publicKey"), text("privateKey")] },
      ...["oauthClient", "oauthResource", "oauthClientResource", "oauthRefreshToken", "oauthAccessToken", "oauthConsent", "oauthClientAssertion"].map((name) => ({ name, fields: [] })),
      // A gym's members are not Better Auth's.
      { name: "Organization", fields: [text("name")] },
    ];
    expect(authEntityNames(plugins, betterAuth)).toEqual(plugins.slice(0, -1).map((e) => e.name));
    expect(authEntityNames([{ name: "Member", fields: [text("plan")] }], betterAuth)).toEqual([]);
  });

  test("leaves a domain entity that only shares a Better Auth name", () => {
    const domain = [{ name: "Account", fields: [text("plan")] }, { name: "Verification", fields: [text("status")] }];
    expect(authEntityNames(domain, betterAuth)).toEqual([]);
  });

  test("is empty without the better-auth provider", () => {
    expect(authEntityNames(entities)).toEqual([]);
    expect(authEntityNames(entities, { provider: "jwt", jwt: { issuer: "https://issuer.example.com/" } })).toEqual([]);
  });

  test("a relation from another entity onto an auth entity is hidden; the others are not", () => {
    expect(hidesRelation("Project", "User", entities, betterAuth)).toBe(true);
    expect(hidesRelation("session", "User", entities, betterAuth)).toBe(false);
    expect(hidesRelation("User", "Project", entities, betterAuth)).toBe(false);
    expect(hidesRelation("Project", "User", entities)).toBe(false);
  });

  test("refuses mcp on an auth entity", () => {
    const withTool = entities.map((e) => (e.name === "session" ? { ...e, mcp: ["read" as const] } : e));
    expect(() => authEntityNames(withTool, betterAuth)).toThrow("session.mcp: session is an auth entity");
  });
});
