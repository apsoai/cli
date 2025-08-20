
import { Command } from "@oclif/core";
import { spawn } from "child_process";
import os from "os";

export default abstract class BaseCommand extends Command {
  async runNpmCommand(args: string[], silent = false): Promise<void> {
    return new Promise((resolve: any, reject) => {
      const isWindows = os.platform() === "win32";
      const command = isWindows ? "npm.cmd" : "npm";

      const cmdStr = `${command} ${args.join(" ")}`;
      this.log(`Running: ${cmdStr}`);

      const child = spawn(command, args, {
        stdio: "inherit",
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
}






