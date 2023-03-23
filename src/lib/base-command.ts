import { Command } from "@oclif/core";
import { spawn } from "child_process";

export default abstract class BaseCommand extends Command {
  async runNpmCommand(args: string[]): Promise<void> {
    return new Promise((resolve: any, reject) => {
      const command = "npm";

      const cmdStr = `${command} ${args.join(" ")}`;
      this.log(cmdStr);
      const child = spawn(command, args, { stdio: "inherit" });
      child.on("close", (code) => {
        if (code !== 0) {
          reject({
            command: cmdStr,
          });
          return;
        }
        resolve();
      });
    });
  }
}
