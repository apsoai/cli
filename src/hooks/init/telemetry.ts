import { Hook } from "@oclif/core";
import {
  initTelemetry,
  track,
  shouldShowFirstRunNotice,
  markFirstRunNoticeShown,
  FIRST_RUN_NOTICE,
} from "../../lib/telemetry/telemetry";

/**
 * Runs before any command. Initializes PostHog + Sentry and records that a
 * command was invoked. Best-effort: never blocks or fails the command.
 */
const hook: Hook<"init"> = async function (opts) {
  initTelemetry();

  // First-run transparency notice (issue #96). Printed to stderr so it never
  // pollutes stdout / piped output, shown once per install.
  if (shouldShowFirstRunNotice()) {
    process.stderr.write(`\n${FIRST_RUN_NOTICE}\n\n`);
    markFirstRunNoticeShown();
  }

  if (opts.id) {
    track("cli_command_started", { command: opts.id });
  }
};

export default hook;
