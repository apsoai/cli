import { Hook } from "@oclif/core";
import { initTelemetry, track } from "../../lib/telemetry/telemetry";

/**
 * Runs before any command. Initializes PostHog + Sentry and records that a
 * command was invoked. Best-effort: never blocks or fails the command.
 */
const hook: Hook<"init"> = async function (opts) {
  initTelemetry();
  if (opts.id) {
    track("cli_command_started", { command: opts.id });
  }
};

export default hook;
