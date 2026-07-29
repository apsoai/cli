import { expect, describe, test, beforeEach, afterEach } from "@jest/globals";
import { __testing } from "../../../src/lib/telemetry/telemetry";

const { isDisabled, getOrCreateInstallId } = __testing;

describe("telemetry opt-out resolution (cli#96)", () => {
  const saved = {
    DO_NOT_TRACK: process.env.DO_NOT_TRACK,
    APSO_TELEMETRY: process.env.APSO_TELEMETRY,
    APSO_TELEMETRY_DISABLED: process.env.APSO_TELEMETRY_DISABLED,
  };

  beforeEach(() => {
    delete process.env.DO_NOT_TRACK;
    delete process.env.APSO_TELEMETRY;
    delete process.env.APSO_TELEMETRY_DISABLED;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("enabled by default (config flag false, no env)", () => {
    expect(isDisabled(false)).toBe(false);
  });

  test("config flag disables", () => {
    expect(isDisabled(true)).toBe(true);
  });

  test("APSO_TELEMETRY=0 disables (issue's canonical env var)", () => {
    process.env.APSO_TELEMETRY = "0";
    expect(isDisabled(false)).toBe(true);
  });

  test("APSO_TELEMETRY=false disables", () => {
    process.env.APSO_TELEMETRY = "false";
    expect(isDisabled(false)).toBe(true);
  });

  test("DO_NOT_TRACK=1 disables", () => {
    process.env.DO_NOT_TRACK = "1";
    expect(isDisabled(false)).toBe(true);
  });

  test("APSO_TELEMETRY_DISABLED=1 disables (legacy alias)", () => {
    process.env.APSO_TELEMETRY_DISABLED = "1";
    expect(isDisabled(false)).toBe(true);
  });
});

describe("anonymous install id (cli#96)", () => {
  test("returns the persisted id unchanged when present (stable across runs)", () => {
    const existing = "11111111-2222-3333-4444-555555555555";
    expect(getOrCreateInstallId(existing)).toBe(existing);
  });
});
