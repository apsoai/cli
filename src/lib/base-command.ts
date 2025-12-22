import { Command, ux } from "@oclif/core";
import { spawn } from "child_process";
import os from "os";
import { isAuthenticated } from "./config/index";

export interface AuthOptions {
  /**
   * If true, never prompt interactively.
   * - If already authenticated: proceed.
   * - If not authenticated: fail fast with a clear error.
   *
   * This is intended for CI / automation usage.
   */
  nonInteractive?: boolean;
}

/**
 * Base command for all Apso CLI commands.
 *
 * Provides:
 * - Cross-platform npm runner
 * - Shared authentication helper with consistent interactive / non-interactive behaviour
 */
export default abstract class BaseCommand extends Command {
  /**
   * Run an npm command (e.g. ["run", "build"]) in a cross-platform way.
   */
  async runNpmCommand(args: string[], silent = false): Promise<void> {
    return new Promise((resolve: any, reject) => {
      const isWindows = os.platform() === "win32";
      const command = isWindows ? "npm.cmd" : "npm";
      const stdio = silent ? "ignore" : "inherit";

      const cmdStr = `${command} ${args.join(" ")}`;
      this.log(`Running: ${cmdStr}`);

      const child = spawn(command, args, {
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

  /**
   * Ensure the user is authenticated before running a command.
   *
   * Behaviour:
   * - If already authenticated: returns immediately.
   * - If not authenticated and nonInteractive=true:
   *     throws an error with a clear, CI-friendly message.
   * - If not authenticated and nonInteractive=false (default):
   *     prompts the user to run `apso login` via oclif.
   *
   * This should be used by all commands that require an authenticated user.
   */
  async ensureAuthenticated(options: AuthOptions = {}): Promise<void> {
    const nonInteractive =
      options.nonInteractive ||
      process.env.APSO_NON_INTERACTIVE === "1" ||
      process.env.APSO_NON_INTERACTIVE === "true";

    if (isAuthenticated()) {
      return;
    }

    if (nonInteractive) {
      this.error(
        [
          "You are not logged in, and non-interactive mode is enabled.",
          "",
          "To authenticate, run:",
          "  apso login",
          "",
          "Then re-run this command without APSO_NON_INTERACTIVE,",
          "or ensure credentials are available in CI before invoking the CLI.",
        ].join("\n")
      );
    }

    this.log("You are not logged in.");

    const shouldLogin = await ux.confirm(
      "Do you want to run 'apso login' now? (y/n)"
    );

    if (!shouldLogin) {
      this.error("Authentication is required. Aborting.");
    }

    await this.config.runCommand("login", []);

    if (!isAuthenticated()) {
      this.error(
        "Login did not complete successfully. Please run 'apso login' and try again."
      );
    }
  }
}
