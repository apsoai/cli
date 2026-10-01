import { Command } from "@oclif/core";
import { spawn } from "child_process";
import os from "os";
import {
  captureException,
  track,
  shutdownTelemetry,
  elapsedMs,
} from "./telemetry/telemetry";

/** True for errors oclif raised deliberately (this.error, this.exit, parse errors). */
export function isUserError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "oclif" in err);
}

export default abstract class BaseCommand extends Command {
  /**
   * Report failures to Sentry + PostHog before oclif exits. The postrun hook
   * does not fire on error, so the flush has to happen here.
   */
  async catch(
    err: Error & { exitCode?: number; code?: string; oclif?: { exit?: number } }
  ): Promise<any> {
    try {
      // oclif marks errors it raised on purpose (this.error, this.exit, flag
      // and arg parse failures) with an `oclif` property. Those are messages
      // we chose to show the user, e.g. "No entity named X", not crashes, so
      // they go to PostHog only. Everything else is a real bug for Sentry.
      const userError = isUserError(err);
      if (!userError) {
        captureException(err, { command: this.id });
      }
      track("cli_command_failed", {
        command: this.id,
        duration_ms: elapsedMs(),
        error: err?.message,
        error_code: err?.code,
        user_error: userError,
      });
      await shutdownTelemetry();
    } catch {
      // never mask the original error with a telemetry failure
    }
    return super.catch(err);
  }

  async runCommand(
    command: string,
    args: string[],
    silent = false
  ): Promise<void> {
    return new Promise((resolve: any, reject) => {
      const isWindows = os.platform() === "win32";
      const resolvedCommand = isWindows ? `${command}.cmd` : command;
      const stdio = silent ? "ignore" : "inherit";

      const cmdStr = `${resolvedCommand} ${args.join(" ")}`;
      this.log(`Running: ${cmdStr}`);

      const child = spawn(resolvedCommand, args, {
        stdio,
        shell: isWindows,
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject({ command: cmdStr, exitCode: code });
          return;
        }
        resolve();
      });

      child.on("error", () => {
        this.error(`Failed to run: ${cmdStr}`);
      });
    });
  }

  async runNpmCommand(args: string[], silent = false): Promise<void> {
    return this.runCommand("npm", args, silent);
  }
}
