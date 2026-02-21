import { Command, ux } from "@oclif/core";
import { spawn, spawnSync } from "child_process";
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

export interface GitPreflightResult {
  stashed: boolean;
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
   * Check for uncommitted Git changes in the given project root and optionally
   * stash them before proceeding.
   *
   * Behaviour:
   * - If not a Git repo: returns { stashed: false }.
   * - If clean: returns { stashed: false }.
   * - If dirty:
   *   - In interactive mode, prompts:
   *       1) Abort
   *       2) Continue without stash
   *       3) Stash changes before operation and auto-pop afterwards
   *   - In non-interactive mode (APSO_NON_INTERACTIVE=1/true), logs a warning
   *     and continues without stashing.
   *
   * The caller is responsible for invoking gitPostflight() afterwards to pop
   * the stash if stashed=true.
   */
  async gitPreflight(
    projectRoot: string,
    options: { operationName: string }
  ): Promise<GitPreflightResult> {
    const gitDir = `${projectRoot}/.git`;

    // Quick check: not a Git repo
    try {
      const fs = await import("fs");
      if (!fs.existsSync(projectRoot) || !fs.existsSync(gitDir)) {
        return { stashed: false };
      }
    } catch {
      return { stashed: false };
    }

    // Check for uncommitted changes: git status --porcelain
    const statusResult = spawnSync("git", ["status", "--porcelain"], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    if (statusResult.error) {
      // If git is not available, just continue
      return { stashed: false };
    }

    const output = (statusResult.stdout || "").trim();
    if (!output) {
      // Clean working tree
      return { stashed: false };
    }

    const nonInteractive =
      process.env.APSO_NON_INTERACTIVE === "1" ||
      process.env.APSO_NON_INTERACTIVE === "true";

    if (nonInteractive) {
      this.warn(
        [
          "Uncommitted Git changes detected in project root, but non-interactive mode is enabled.",
          `Project root: ${projectRoot}`,
          "Proceeding without stashing. This may result in merge conflicts or overwritten files.",
        ].join("\n")
      );
      return { stashed: false };
    }

    this.log("");
    this.log("Uncommitted Git changes detected in project root:");
    this.log(`  ${projectRoot}`);
    this.log("");
    this.log("Options:");
    this.log("  [1] Abort");
    this.log(
      "  [2] Continue without stashing (may overwrite/merge with local changes)"
    );
    this.log("  [3] Stash changes before operation and auto-pop afterwards");
    this.log("");

    const choice = await ux.prompt("Select an option (1-3)", {
      required: true,
    });

    if (choice === "1") {
      this.error("Operation aborted due to uncommitted Git changes.");
    }

    if (choice === "2") {
      this.log("Continuing without stashing Git changes.");
      return { stashed: false };
    }

    // Option 3: stash changes
    this.log("Stashing uncommitted changes before operation...");
    const stashMessage = `apso-cli-sync ${
      options.operationName
    } ${new Date().toISOString()}`;
    const stashResult = spawnSync(
      "git",
      ["stash", "push", "-u", "-m", stashMessage],
      {
        cwd: projectRoot,
        stdio: "inherit",
      }
    );

    if (stashResult.status !== 0) {
      this.warn("Failed to stash changes. Continuing without stashing.");
      return { stashed: false };
    }

    this.log("✓ Changes stashed successfully.");
    return { stashed: true };
  }

  /**
   * After an operation that modified files, attempt to pop the stash created
   * by gitPreflight() if stashed=true.
   */
  async gitPostflight(
    projectRoot: string,
    preflight: GitPreflightResult
  ): Promise<void> {
    if (!preflight.stashed) {
      return;
    }

    this.log("");
    this.log("Restoring stashed Git changes (git stash pop)...");

    const popResult = spawnSync("git", ["stash", "pop"], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    if (popResult.status !== 0) {
      this.warn(
        [
          "git stash pop exited with a non-zero status.",
          "You may need to resolve conflicts manually. Run:",
          `  cd "${projectRoot}"`,
          "  git status",
          "  git stash list",
        ].join("\n")
      );
      return;
    }

    this.log("✓ Stashed changes restored successfully.");
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
