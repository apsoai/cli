import { expect, jest } from "@jest/globals";

const post = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const get = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock("../../../src/lib/api/client", () => ({
  api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) },
}));

import { servicesApi } from "../../../src/lib/api/services";

// GET /api/workspaces answers with the caller's own membership rows, each with
// its workspace nested. The row id is the membership id.
const memberships = {
  data: [
    { id: 41, workspaceId: 7, role: "Owner", status: "Active", workspace: { id: 7, slug: "one", name: "One" } },
    { id: 42, workspaceId: 8, role: "Member", status: "Active", workspace: { id: 8, slug: "two", name: "Two" } },
  ],
};

beforeEach(() => {
  post.mockReset().mockResolvedValue({ id: 99, name: "orders", workspaceId: 8 });
  get.mockReset().mockResolvedValue(memberships);
});

test("create sends the body the web app sends: name, workspaceId and the caller's workspaceUserId", async () => {
  const service = await servicesApi.create("8", { name: "orders" });

  expect(get).toHaveBeenCalledWith("/api/workspaces");
  expect(post).toHaveBeenCalledWith(
    "/api/services",
    { name: "orders", workspaceId: 8, workspaceUserId: 42 },
    { headers: { "X-Workspace-Id": "8" } }
  );
  expect(service.id).toBe("99");
});

test("create still creates the service when the caller has no membership row for the workspace", async () => {
  await servicesApi.create("9", { name: "orders" });

  expect(post).toHaveBeenCalledWith(
    "/api/services",
    { name: "orders", workspaceId: 9, workspaceUserId: undefined },
    { headers: { "X-Workspace-Id": "9" } }
  );
  expect(JSON.parse(JSON.stringify(post.mock.calls[0][1]))).toEqual({ name: "orders", workspaceId: 9 });
});

test("create still creates the service when the membership lookup fails", async () => {
  get.mockRejectedValue(new Error("network down"));

  const service = await servicesApi.create("8", { name: "orders" });

  expect(JSON.parse(JSON.stringify(post.mock.calls[0][1]))).toEqual({ name: "orders", workspaceId: 8 });
  expect(service.id).toBe("99");
});

test("create without a workspace id sends the name alone and skips the lookup", async () => {
  await servicesApi.create("", { name: "orders" });

  expect(get).not.toHaveBeenCalled();
  expect(JSON.parse(JSON.stringify(post.mock.calls[0][1]))).toEqual({ name: "orders" });
  expect(post.mock.calls[0][2]).toEqual({ headers: undefined });
});

test("a workspace row without a nested workspace is never taken for a membership", async () => {
  // GET /api/workspaces/:id shape: the row id is the workspace id, not a membership id.
  get.mockResolvedValue([{ id: 8, slug: "two", name: "Two" }]);

  await servicesApi.create("8", { name: "orders" });

  expect(JSON.parse(JSON.stringify(post.mock.calls[0][1]))).toEqual({ name: "orders", workspaceId: 8 });
});
