import { expect, describe, test } from "@jest/globals";
import { authEntityNames, authEntityRoutes } from "../../../src/lib/guards";
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
const betterAuth: AuthConfig = { provider: "better-auth" };

describe("authEntityNames", () => {
  test("names the session, user and membership entities and Better Auth's tables", () => {
    expect(authEntityNames(entities, betterAuth)).toEqual(["User", "account", "session", "verification", "AccountUser"]);
    expect(authEntityRoutes(entities, betterAuth)).toEqual(["users", "accounts", "sessions", "verifications", "accountusers"]);
  });

  test("follows the entity names in the auth block", () => {
    const renamed = [{ name: "Login", fields: [text("token")] }, { name: "Person" }, { name: "Member" }, { name: "User" }];
    const auth: AuthConfig = { provider: "custom-db-session", sessionEntity: "Login", userEntity: "Person", accountUserEntity: "Member" };
    expect(authEntityNames(renamed, auth)).toEqual(["Login", "Person", "Member"]);
  });

  test("leaves a domain entity that only shares a Better Auth name", () => {
    const domain = [{ name: "Account", fields: [text("plan")] }, { name: "Verification", fields: [text("status")] }];
    expect(authEntityNames(domain, betterAuth)).toEqual([]);
  });

  test("is empty without database-session sign-in", () => {
    expect(authEntityNames(entities)).toEqual([]);
    expect(authEntityNames(entities, { provider: "jwt", jwt: { issuer: "https://issuer.example.com/" } })).toEqual([]);
  });

  test("refuses mcp on an auth entity", () => {
    const withTool = entities.map((e) => (e.name === "session" ? { ...e, mcp: ["read" as const] } : e));
    expect(() => authEntityNames(withTool, betterAuth)).toThrow("session.mcp: session is an auth entity");
  });
});
