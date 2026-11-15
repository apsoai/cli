#!/usr/bin/env node
/**
 * A real Better Auth server for scripts/auth-smoke.mjs, which copies this file
 * into a temporary folder, installs better-auth there and runs it. The smoke
 * signs users up, sets their active organization and fetches tokens over HTTP,
 * the way an app's front end and an MCP client do, so the claim names, the
 * issuer, the audience and the key format are Better Auth's own.
 *
 * Plugins: organization, jwt (with the definePayload a customer needs for the
 * tenant and roles) and @better-auth/oauth-provider (OAuth access tokens for
 * the resources in RESOURCES). Data is kept in memory.
 *
 * The OAuth provider is set up the way the docs describe for organizations:
 * postLogin.consentReferenceId binds the user's organization to the grant,
 * and customAccessTokenClaims turns it into the tenant and roles claims after
 * checking the membership again, on every token it issues.
 *
 * These routes are test controls, not Better Auth:
 *   POST /smoke/member  { userId, organizationId, role }  adds a membership
 *   POST /smoke/remove-member { userId, organizationId }  removes one
 *   POST /smoke/client  { cookie, resources, skip_consent } registers an OAuth client
 *   POST /smoke/sign    { payload, header }               signs any payload with
 *     this server's own signing key, for the tokens Better Auth will not issue
 *     (expired, another audience, an access token without azp)
 *
 * Env: PORT, RESOURCES (comma-separated resource URLs).
 */
import crypto from "node:crypto";
import http from "node:http";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import { jwt, organization } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { SignJWT, importJWK } from "jose";

const port = Number(process.env.PORT);
const BASE = `http://127.0.0.1:${port}`;
const tables =
  "user session account verification jwks organization member invitation oauthClient oauthResource oauthClientResource oauthRefreshToken oauthAccessToken oauthConsent oauthClientAssertion";
const db = Object.fromEntries(tables.split(" ").map((name) => [name, []]));

const memberships = (userId) => db.member.filter((m) => m.userId === userId);
const membership = (userId, organizationId) => db.member.find((m) => m.userId === userId && m.organizationId === organizationId);

const auth = betterAuth({
  baseURL: BASE,
  secret: crypto.randomBytes(32).toString("hex"),
  database: memoryAdapter(db),
  emailAndPassword: { enabled: true },
  plugins: [
    organization(),
    jwt({
      // So /smoke/sign can read the signing key. An app leaves this off.
      jwks: { disablePrivateKeyEncryption: true },
      jwt: {
        // What a customer adds: the active organization and the member's roles.
        definePayload: ({ user, session }) => {
          const member = membership(user.id, session.activeOrganizationId);
          return {
            email: user.email,
            activeOrganizationId: session.activeOrganizationId ?? undefined,
            roles: member ? member.role.split(",") : [],
          };
        },
      },
    }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      resources: (process.env.RESOURCES || "").split(",").filter(Boolean),
      scopes: ["openid", "offline_access"],
      // After sign-in: a user with several organizations picks one on this
      // page (organization.setActive, then /oauth2/continue).
      postLogin: {
        page: "/select-organization",
        shouldRedirect: ({ user, session, isContinuation }) => {
          const mine = memberships(user.id);
          const chosen = mine.some((m) => m.organizationId === session.activeOrganizationId);
          return mine.length > 1 && (!isContinuation || !chosen);
        },
        // The organization this grant is for, decided here on the server: the
        // active one when the user is a member of it, else their only one.
        consentReferenceId: ({ user, session }) => {
          const mine = memberships(user.id);
          if (mine.some((m) => m.organizationId === session.activeOrganizationId)) return session.activeOrganizationId;
          return mine.length === 1 ? mine[0].organizationId : undefined;
        },
      },
      // Runs for every access token, refreshed ones too. An access token has no
      // session; referenceId is the organization bound to the grant above. The
      // membership is read again, so a removed member gets no tenant claim.
      customAccessTokenClaims: ({ user, referenceId }) => {
        const member = user && referenceId ? membership(user.id, referenceId) : undefined;
        return member ? { activeOrganizationId: referenceId, roles: member.role.split(",") } : {};
      },
    }),
  ],
});
const betterAuthHandler = toNodeHandler(auth);

const controls = {
  "/smoke/member": ({ userId, organizationId, role }) => {
    if (!db.organization.some((o) => o.id === organizationId))
      db.organization.push({ id: organizationId, name: `Org ${organizationId}`, slug: `org-${organizationId}`, createdAt: new Date() });
    db.member.push({ id: crypto.randomUUID(), organizationId, userId, role, createdAt: new Date() });
    return {};
  },
  "/smoke/remove-member": ({ userId, organizationId }) => {
    db.member = db.member.filter((m) => !(m.userId === userId && m.organizationId === organizationId));
    return {};
  },
  "/smoke/client": ({ cookie, resources, skip_consent = true }) =>
    auth.api.adminCreateOAuthClient({
      headers: new Headers({ cookie }),
      // skip_consent: the authorization request answers with the code, no consent page.
      body: { client_name: "auth-smoke", redirect_uris: ["https://client.smoke.test/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], skip_consent, resources },
    }),
  "/smoke/sign": async ({ payload, header = {} }) => {
    const key = db.jwks[db.jwks.length - 1];
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "EdDSA", kid: key.id, ...header })
      .sign(await importJWK(JSON.parse(key.privateKey), "EdDSA"));
    return { token };
  },
};

http
  .createServer(async (req, res) => {
    const control = controls[req.url];
    if (!control) return betterAuthHandler(req, res);
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const result = await control(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error), body: error.body }));
    }
  })
  .listen(port, "127.0.0.1", () => console.log("ready"));
