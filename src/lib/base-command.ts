import { Command } from "@oclif/core";
import { spawn } from "child_process";
import os from "os";

export default abstract class BaseCommand extends Command {
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
