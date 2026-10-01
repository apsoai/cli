import { expect, describe, test, beforeEach, jest } from "@jest/globals";

// Telemetry must identify by Apso user id + workspace id, never by email/name.
const capture = jest.fn();
const alias = jest.fn();
const identify = jest.fn();
jest.mock("posthog-node", () => ({
  PostHog: jest.fn().mockImplementation(() => ({ capture, alias, identify, shutdown: jest.fn() })),
}));
const setUser = jest.fn();
const setTag = jest.fn();
jest.mock("@sentry/node", () => ({ init: jest.fn(), setUser, setTag, captureException: jest.fn(), close: jest.fn() }));

let cfg: Record<string, unknown> = {};
let creds: unknown = null;
let link: unknown = null;
const write = jest.fn((patch: Record<string, unknown>) => Object.assign(cfg, patch));
jest.mock("../../../src/lib/config", () => ({
  globalConfig: { read: () => cfg, write: (p: Record<string, unknown>) => write(p) },
  credentials: { read: () => creds },
  projectLink: { read: () => link },
}));

function load() {
  let mod: any;
  jest.isolateModules(() => {
    mod = require("../../../src/lib/telemetry/telemetry");
  });
  mod.initTelemetry();
  return mod;
}

describe("telemetry identity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APSO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    cfg = { installId: "install-1", telemetryNoticeShown: true, activeWorkspaceId: "77", activeWorkspaceSlug: "acme" };
    creds = { user: { id: 42, email: "someone@example.com", name: "Some One" } };
    link = null;
  });

  test("logged in: distinct id is the user id, workspace attached, no email anywhere", () => {
    const t = load();
    t.track("cli_command_started", { command: "generate" });
    const call: any = capture.mock.calls[0][0];
    expect(call.distinctId).toBe("42");
    expect(call.properties).toMatchObject({ workspace_id: "77", workspace_slug: "acme", authenticated: true });
    expect(call.groups).toEqual({ workspace: "77" });
    expect(identify).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith({ id: "42" });
    expect(JSON.stringify([capture.mock.calls, setUser.mock.calls, identify.mock.calls])).not.toContain("someone@example.com");
  });

  test("linked project workspace and service win over the active workspace", () => {
    link = { workspaceId: "9", workspaceSlug: "linked", serviceId: "123" };
    const t = load();
    t.track("cli_command_started", { command: "dev" });
    const call: any = capture.mock.calls[0][0];
    expect(call.properties).toMatchObject({ workspace_id: "9", service_id: "123" });
    expect(call.groups).toEqual({ workspace: "9" });
  });

  test("first logged-in run aliases the anonymous install id to the user once", () => {
    load();
    expect(alias).toHaveBeenCalledWith({ distinctId: "42", alias: "install-1" });
    alias.mockClear();
    load();
    expect(alias).not.toHaveBeenCalled();
  });

  test("logged out: falls back to the install id, no alias", () => {
    creds = null;
    const t = load();
    t.track("cli_command_started", { command: "init" });
    expect((capture.mock.calls[0][0] as any).distinctId).toBe("install-1");
    expect(alias).not.toHaveBeenCalled();
  });
});
