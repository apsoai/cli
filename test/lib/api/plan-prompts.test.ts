import { expect, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// A throwaway config dir: default webUrl, a fake session, no real credentials touched.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-cli-test-"));
process.env.APSO_CONFIG_DIR = dir;
fs.writeFileSync(
  path.join(dir, "credentials.json"),
  JSON.stringify({
    tokens: { accessToken: "x", refreshToken: "y", expiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" },
    user: { id: "1", email: "t@example.com" },
  })
);

import { api, ApiClientError } from "../../../src/lib/api/client";
import { fixPage } from "../../../src/lib/upgrade";

const web = "https://app.apso.cloud";
const err = (code: string, status = 402) => {
  const e = new ApiClientError("msg", status);
  e.code = code;
  return e;
};

test("a 4xx from an app route shows the route's own sentence, not 'Request failed'", async () => {
  const body = { error: "Staging needs a paid service size (Small, Medium or Large)", code: "STAGING_REQUIRES_PAID_SERVICE" };
  global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status: 402 })) as unknown as typeof fetch;
  const thrown = await api.post("/api/services/55/environments/staging").catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(ApiClientError);
  expect((thrown as ApiClientError).message).toBe(body.error);
  expect((thrown as ApiClientError).code).toBe("STAGING_REQUIRES_PAID_SERVICE");
  expect((thrown as ApiClientError).isLimitError()).toBe(true);
});

test("staging refusals point at the service's Deployments page", () => {
  expect(fixPage(err("STAGING_REQUIRES_PAID_SERVICE"), { workspaceSlug: "33469873", serviceId: "55" }).url).toBe(
    `${web}/33469873/services/55/deployments`
  );
});

test("a suspended service points at Billing", () => {
  expect(fixPage(err("SERVICE_SUSPENDED"), { workspaceSlug: "33469873" }).url).toBe(`${web}/33469873/billing`);
});

test("plan limits keep their upgrade page", () => {
  const e = err("SERVICE_LIMIT_REACHED", 403);
  expect(e.isLimitError()).toBe(true);
  expect(fixPage(e).url).toBe(`${web}/billing/upgrade`);
});

test("an unrelated 402 is not treated as fixable in the app", () => {
  expect(new ApiClientError("x", 402).isLimitError()).toBe(false);
});
