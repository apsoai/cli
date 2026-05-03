import { Flags } from "@oclif/core";
import { spawn, execSync } from "child_process";
import * as fs from "fs";
import shell from "shelljs";
import BaseCommand from "../lib/base-command";

export default class Dev extends BaseCommand {
  static description = "Start the local development server using Docker Compose";

  static examples = [
    `$ apso dev`,
    `$ apso dev --build`,
    `$ apso dev --detach`,
    `$ apso dev --build --detach`,
  ];

  static flags = {
    detach: Flags.boolean({
      char: "d",
      description: "Run containers in the background",
      default: false,
    }),
    build: Flags.boolean({
      description: "Rebuild images before starting",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Dev);

    // Check Docker is installed
    if (!shell.which("docker")) {
      this.error(
        "Docker is required but not found. Please install Docker and try again.\nhttps://docs.docker.com/get-docker/"
      );
    }

    // Detect compose variant (v2 plugin vs v1 standalone)
    const composeCmd = this.detectComposeVariant();

    // Verify docker-compose.yml exists
    if (!fs.existsSync("docker-compose.yml")) {
      this.error(
        "No docker-compose.yml found in the current directory.\nMake sure you are in an Apso project root."
      );
    }

    // Build the command args
    const args: string[] = [...composeCmd, "up"];
    if (flags.build) {
      args.push("--build");
    }
    if (flags.detach) {
      args.push("-d");
    }

    this.log(`Running: ${args.join(" ")}`);

    const child = spawn(args[0], args.slice(1), {
      stdio: "inherit",
      env: {
        ...process.env,
        AUTH_DISABLED: "true",
      },
    });

    // Forward signals for clean shutdown
    const forwardSignal = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };
    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);

    return new Promise((resolve, reject) => {
      child.on("close", (code) => {
        process.removeListener("SIGINT", forwardSignal);
        process.removeListener("SIGTERM", forwardSignal);
        if (code !== 0 && code !== null) {
          reject(new Error(`docker compose exited with code ${code}`));
          return;
        }
        resolve();
      });

      child.on("error", (err) => {
        this.error(`Failed to start Docker Compose: ${err.message}`);
      });
    });
  }

  /**
   * Detect whether to use `docker compose` (v2 plugin) or `docker-compose` (v1).
   * Returns the command parts as an array.
   */
  private detectComposeVariant(): string[] {
    try {
      execSync("docker compose version", { stdio: "ignore" });
      return ["docker", "compose"];
    } catch {
      // Fall back to v1
      if (shell.which("docker-compose")) {
        return ["docker-compose"];
      }
      this.error(
        "Docker Compose is required but not found.\nInstall the Docker Compose plugin or standalone docker-compose.\nhttps://docs.docker.com/compose/install/"
      );
    }
  }
}
