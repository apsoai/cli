/* eslint-disable camelcase */
import { expect, jest } from "@jest/globals";

const post = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const get = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock("../../../src/lib/api/client", () => ({
  api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) },
}));

import { buildApi, envApi } from "../../../src/lib/api/services";
import { describePreview } from "../../../src/commands/promote";

const rows = [
  { id: 1, workspaceServiceId: 7, environment_type: "production", deployment_status: "active", build_status: "Ready", deployment_url: "https://p.example" },
  { id: 2, workspaceServiceId: 7, environment_type: "staging", deployment_status: "deploying", build_status: "TriggeringCodeBuild", deployment_url: "https://s.example" },
];

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path) =>
    String(path).endsWith("/deployments") ? rows : { id: 7, build_status: "Ready" }
  );
});

test("deploy --env staging sends the environment and reads staging's own row", async () => {
  const status = await buildApi.trigger("ws", "7", "staging");
  expect(post).toHaveBeenCalledWith("/api/services/7/deploy", { target: "apso", environment: "staging" });
  expect(status.status).toBe("building"); // staging row, not production's "Ready"
});

test("deploy with no env still targets production", async () => {
  const status = await buildApi.trigger("ws", "7");
  expect(post).toHaveBeenCalledWith("/api/services/7/deploy", { target: "apso", environment: "production" });
  expect(status.status).toBe("success");
});

test("a service without staging gets a hint to add it", async () => {
  get.mockResolvedValue([rows[0]]);
  await expect(buildApi.getStatus("7", "staging")).rejects.toThrow("apso env add staging");
});

test("env list maps the platform rows", async () => {
  const envs = await envApi.list("7");
  expect(envs.map((e) => [e.environment, e.url])).toEqual([
    ["production", "https://p.example"],
    ["staging", "https://s.example"],
  ]);
});

test("promote preview names commits, migrations and missing variables", () => {
  const text = describePreview({
    blocked: null,
    commits: [{ sha: "abcdef1234", message: "fix: thing\n\nbody" }],
    migrations: ["1700-AddX"],
    missingEnvVars: ["GITHUB_APP_ID"],
  });
  expect(text).toContain("abcdef1 fix: thing");
  expect(text).toContain("Migrations: 1700-AddX");
  expect(text).toContain("Missing in production: GITHUB_APP_ID");
});
