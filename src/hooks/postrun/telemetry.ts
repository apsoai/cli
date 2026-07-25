import { Hook } from "@oclif/core";
import {
  track,
  shutdownTelemetry,
  elapsedMs,
} from "../../lib/telemetry/telemetry";

/**
 * Runs after a command completes successfully. Records completion + duration,
 * then flushes both clients before the short-lived CLI process exits (posthog
 * batches, so an explicit flush is required or events are lost).
 */
const hook: Hook<"postrun"> = async function (opts) {
  track("cli_command_completed", {
    command: opts.Command?.id,
    duration_ms: elapsedMs(),
    success: true,
  });
  await shutdownTelemetry();
};

export default hook;
