import { expect, describe, test } from "@jest/globals";
import { Errors } from "@oclif/core";
import { isUserError } from "../../../src/lib/base-command";

// Sentry received every `this.error("No entity named X")` as a crash. Only
// unexpected exceptions should reach Sentry; deliberate oclif errors are
// user-facing messages and go to PostHog only.
describe("isUserError", () => {
  test("deliberate oclif errors are user errors", () => {
    expect(isUserError(new Errors.CLIError('No entity named "Ghost" in .apsorc'))).toBe(true);
    expect(isUserError(new Errors.ExitError(1))).toBe(true); // this.exit(1) -> "EEXIT: 1"
  });

  test("unexpected exceptions are not", () => {
    expect(isUserError(new Error("ENOENT: no such file"))).toBe(false);
    expect(isUserError(new TypeError("cannot read properties of undefined"))).toBe(false);
    expect(isUserError(undefined)).toBe(false);
  });
});
