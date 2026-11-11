/**
 * A local token issuer for the access suite: it signs user tokens with the
 * claim names of the project's own `auth` block and serves the public key as
 * a JWKS, so a service started with AUTH_JWT_ISSUER and AUTH_JWKS_URI pointed
 * here checks them the way it checks its real issuer's tokens.
 */

import * as crypto from "crypto";
import * as http from "http";
import { ResolvedJwtAuth } from "../types/auth";

type Headers = Record<string, string>;

const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });
const bad = (label: string, token: string) => ({ label, headers: bearer(token) });

const b64url = (v: unknown) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

const generate = (alg: string): crypto.KeyPairKeyObjectResult => {
  if (alg === "EdDSA") return crypto.generateKeyPairSync("ed25519");
  if (alg.startsWith("ES"))
    return crypto.generateKeyPairSync("ec", { namedCurve: alg === "ES384" ? "P-384" : "P-256" });
  return crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
};

/**
 * Sign a JWT. `alg` picks the signature; an unknown one (e.g. "none") leaves it empty.
 * @param {object} payload - The claims; undefined values are dropped
 * @param {string} alg - The JWS algorithm
 * @param {crypto.KeyObject | string} key - The private key, or the secret for HS256
 * @param {string} kid - The key id in the header
 * @returns {string} The token
 */
export function sign(
  payload: Record<string, unknown>,
  alg: string,
  key: crypto.KeyObject | string,
  kid = "apso-test"
): string {
  const now = Math.floor(Date.now() / 1000);
  const body: Record<string, unknown> = { iat: now, exp: now + 600, ...payload };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  const head = `${b64url({ alg, typ: "JWT", kid })}.${b64url(body)}`;
  const data = Buffer.from(head);
  const hash = `sha${alg.slice(2)}`;
  let sig = "";
  if (alg === "HS256")
    sig = crypto.createHmac("sha256", key as string).update(head).digest("base64url");
  else if (alg === "EdDSA") sig = crypto.sign(null, data, key as crypto.KeyObject).toString("base64url");
  else if (alg.startsWith("RS")) sig = crypto.sign(hash, data, key as crypto.KeyObject).toString("base64url");
  else if (alg.startsWith("PS"))
    sig = crypto
      .sign(hash, data, {
        key: key as crypto.KeyObject,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      })
      .toString("base64url");
  else if (alg.startsWith("ES"))
    sig = crypto.sign(hash, data, { key: key as crypto.KeyObject, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${sig}`;
}

/** Auth0 namespaced claims are URLs with dots in them; any other dotted name is a path. */
export function setClaim(payload: Record<string, any>, path: string | undefined, value: unknown): void {
  if (!path || value === undefined) return;
  if (!path.includes(".") || path.includes("://")) {
    payload[path] = value;
    return;
  }
  const parts = path.split(".");
  let at = payload;
  for (const part of parts.slice(0, -1)) {
    at[part] = typeof at[part] === "object" && at[part] !== null ? at[part] : {};
    at = at[part];
  }
  at[parts[parts.length - 1]] = value;
}

export interface Caller {
  /** The tenant claim; leave out for a token with no tenant. */
  tenant?: string;
  roles?: string[];
}

export interface Issuer {
  /** Environment that points the service's token check at this issuer. */
  env: Record<string, string>;
  /** True when the auth block names a roles claim, so a token can carry roles. */
  roles: boolean;
  user(caller?: Caller): Headers;
  /** Tokens a service must refuse, each named for what is wrong with it. */
  badTokens(): { label: string; headers: Headers }[];
  close(): void;
}

/**
 * Start the issuer on a free local port.
 * @param {ResolvedJwtAuth} auth - The project's auth block, defaults filled in
 * @returns {Promise<Issuer>} The running issuer
 */
export async function startIssuer(auth: ResolvedJwtAuth): Promise<Issuer> {
  const alg = auth.algorithms[0];
  const keys = generate(alg);
  const impostor = generate(alg);
  const jwks = { keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "apso-test", alg, use: "sig" }] };
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(jwks));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as { port: number };
  const issuer = `http://127.0.0.1:${port}/`;

  const claims = ({ tenant, roles }: Caller = {}): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      iss: issuer,
      aud: auth.audience,
      azp: auth.authorizedParties[0],
      // Cognito access tokens carry client_id where others carry aud.
      // eslint-disable-next-line camelcase
      ...(auth.provider === "cognito" ? { client_id: auth.audience, token_use: "access" } : {}),
    };
    setClaim(payload, auth.claims.userId, `apso-test-user-${tenant ?? "none"}`);
    setClaim(payload, auth.claims.email, "access-test@example.com");
    setClaim(payload, auth.claims.workspaceId ?? auth.claims.organizationId, tenant);
    // Clerk's role claim (o.rol) is one role, not a list.
    if (roles && roles.length > 0)
      setClaim(payload, auth.claims.roles, auth.provider === "clerk" ? roles[0] : roles);
    return payload;
  };
  const valid = claims({ tenant: "1" });

  return {
    env: { AUTH_JWT_ISSUER: issuer, AUTH_JWKS_URI: `${issuer}jwks.json` },
    roles: Boolean(auth.claims.roles),
    user: (caller) => bearer(sign(claims(caller), alg, keys.privateKey)),
    badTokens: () => [
      bad("a token that is not a JWT", "not.a.jwt"),
      bad("an expired token", sign({ ...valid, exp: Math.floor(Date.now() / 1000) - 60 }, alg, keys.privateKey)),
      bad("a token from another issuer", sign({ ...valid, iss: "https://evil.example/" }, alg, keys.privateKey)),
      ...(auth.audience
        ? // eslint-disable-next-line camelcase
          [bad("a token for another audience", sign({ ...valid, aud: "https://other.example", client_id: "other" }, alg, keys.privateKey))]
        : []),
      bad("a token signed by another key", sign(valid, alg, impostor.privateKey)),
      bad('a token with alg "none"', sign(valid, "none", "")),
      bad(
        "an HS256 token signed with the public key",
        sign(valid, "HS256", keys.publicKey.export({ type: "spki", format: "pem" }) as string)
      ),
    ],
    close: () => {
      server.close();
    },
  };
}
