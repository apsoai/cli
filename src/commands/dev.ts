import { Flags } from "@oclif/core";
import { spawn, execSync, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import shell from "shelljs";
import BaseCommand from "../lib/base-command";

export default class Dev extends BaseCommand {
  static description =
    "Start the local development server. Detects project language and database type from .apsorc and .env.";

  static examples = [
    `$ apso dev`,
    `$ apso dev --docker`,
    `$ apso dev --docker --build`,
  ];

  static flags = {
    docker: Flags.boolean({
      description: "Use Docker Compose instead of the native dev stack",
      default: false,
    }),
    detach: Flags.boolean({
      char: "d",
      description: "Run containers in the background (Docker mode only)",
      default: false,
    }),
    build: Flags.boolean({
      description: "Rebuild images before starting (Docker mode only)",
      default: false,
    }),
  };

  private children: ChildProcess[] = [];

  async run(): Promise<void> {
    const { flags } = await this.parse(Dev);

    if (flags.docker) {
      return this.runDocker(flags);
    }

    const language = this.detectLanguage();
    const databaseType = this.readDatabaseType();

    this.log(`Detected language: ${language}`);
    this.log(`Database type: ${databaseType}`);

    // Set up signal forwarding for clean shutdown
    const cleanup = () => {
      for (const child of this.children) {
        child.kill("SIGTERM");
      }
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    try {
      switch (language) {
        case "typescript":
          await this.runTypeScript();
          break;
        case "python":
          await this.runPython(databaseType);
          break;
        case "go":
          await this.runGo(databaseType);
          break;
        default:
          this.error(
            `Unsupported language: ${language}. Supported: typescript, python, go.`
          );
      }
    } finally {
      process.removeListener("SIGINT", cleanup);
      process.removeListener("SIGTERM", cleanup);
    }
  }

  /**
   * TypeScript: run `npm run dev` which reads DATABASE_TYPE from .env.
   * PGlite is handled natively by the NestJS app -- no sidecar needed.
   */
  private async runTypeScript(): Promise<void> {
    this.log("Starting TypeScript dev server...");
    await this.spawnAndWait("npm", ["run", "dev"]);
  }

  /**
   * Python: if pglite, start the pglite-server sidecar first, then uvicorn.
   */
  private async runPython(databaseType: string): Promise<void> {
    if (databaseType === "pglite") {
      this.log("Starting PGlite sidecar...");
      await this.ensureNodeModules();
      this.spawnBackground("npm", ["run", "db"]);
      // Give the sidecar a moment to bind the port
      await this.waitForPort(5432, 10_000);
    }

    this.log("Starting Python dev server...");
    await this.spawnAndWait("uvicorn", [
      "app.main:app",
      "--reload",
      "--host",
      "0.0.0.0",
      "--port",
      this.readEnvValue("PORT") || "3000",
    ]);
  }

  /**
   * Go: if pglite, start the pglite-server sidecar first, then go run.
   */
  private async runGo(databaseType: string): Promise<void> {
    if (databaseType === "pglite") {
      this.log("Starting PGlite sidecar...");
      await this.ensureNodeModules();
      this.spawnBackground("npm", ["run", "db"]);
      await this.waitForPort(5432, 10_000);
    }

    this.log("Starting Go dev server...");
    await this.spawnAndWait("go", ["run", "cmd/main.go"]);
  }

  /**
   * Fallback: run docker compose up (the old behavior).
   */
  private async runDocker(flags: {
    detach: boolean;
    build: boolean;
  }): Promise<void> {
    if (!shell.which("docker")) {
      this.error(
        "Docker is required but not found. Please install Docker and try again.\nhttps://docs.docker.com/get-docker/"
      );
    }

    const composeCmd = this.detectComposeVariant();

    if (!fs.existsSync("docker-compose.yml")) {
      this.error(
        "No docker-compose.yml found in the current directory.\nMake sure you are in an Apso project root."
      );
    }

    const args: string[] = [...composeCmd, "up"];
    if (flags.build) args.push("--build");
    if (flags.detach) args.push("-d");

    this.log(`Running: ${args.join(" ")}`);
    await this.spawnAndWait(args[0], args.slice(1), {
      AUTH_DISABLED: "true",
    });
  }

  // --- Helpers ---

  /**
   * Detect the project language from .apsorc.
   * Falls back to typescript if not specified.
   */
  private detectLanguage(): string {
    const apsorcPath = this.findApsorc();
    if (!apsorcPath) {
      this.log("No .apsorc found, defaulting to typescript.");
      return "typescript";
    }

    try {
      const content = fs.readFileSync(apsorcPath, "utf-8");
      const config = JSON.parse(content);
      return config.language || "typescript";
    } catch {
      this.log("Could not parse .apsorc, defaulting to typescript.");
      return "typescript";
    }
  }

  /**
   * Read DATABASE_TYPE from .env. Defaults to pglite.
   */
  private readDatabaseType(): string {
    return this.readEnvValue("DATABASE_TYPE") || "pglite";
  }

  /**
   * Read a single value from .env.
   */
  private readEnvValue(key: string): string | undefined {
    const envPath = path.resolve(".env");
    if (!fs.existsSync(envPath)) return undefined;

    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [k, ...rest] = trimmed.split("=");
      if (k.trim() === key) return rest.join("=").trim();
    }
    return undefined;
  }

  /**
   * Find .apsorc by walking up from cwd.
   */
  private findApsorc(): string | null {
    let dir = process.cwd();
    while (dir !== path.parse(dir).root) {
      const candidate = path.join(dir, ".apsorc");
      if (fs.existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
    return null;
  }

  /**
   * Run `npm install` if node_modules doesn't exist.
   * Needed for the pglite-server sidecar in Python/Go projects.
   */
  private async ensureNodeModules(): Promise<void> {
    if (!fs.existsSync("node_modules")) {
      this.log("Installing pglite-server dependencies...");
      await this.spawnAndWait("npm", ["install"]);
    }
  }

  /**
   * Wait for a TCP port to become reachable.
   */
  private waitForPort(port: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const net = require("net");
        const sock = net.createConnection({ port, host: "127.0.0.1" }, () => {
          sock.destroy();
          resolve();
        });
        sock.on("error", () => {
          sock.destroy();
          if (Date.now() - start > timeoutMs) {
            reject(
              new Error(`Port ${port} did not become available within ${timeoutMs}ms`)
            );
          } else {
            setTimeout(check, 250);
          }
        });
      };
      check();
    });
  }

  /**
   * Spawn a process in the background and track it for cleanup.
   */
  private spawnBackground(cmd: string, args: string[]): ChildProcess {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...process.env },
    });
    this.children.push(child);
    child.on("error", (err) => {
      this.warn(`Background process ${cmd} failed: ${err.message}`);
    });
    return child;
  }

  /**
   * Spawn a process and wait for it to exit.
   */
  private spawnAndWait(
    cmd: string,
    args: string[],
    extraEnv?: Record<string, string>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: "inherit",
        env: { ...process.env, ...extraEnv },
      });
      this.children.push(child);

      child.on("close", (code) => {
        this.children = this.children.filter((c) => c !== child);
        if (code !== 0 && code !== null) {
          reject(new Error(`${cmd} exited with code ${code}`));
          return;
        }
        resolve();
      });

      child.on("error", (err) => {
        this.error(`Failed to start ${cmd}: ${err.message}`);
      });
    });
  }

  /**
   * Detect whether to use `docker compose` (v2) or `docker-compose` (v1).
   */
  private detectComposeVariant(): string[] {
    try {
      execSync("docker compose version", { stdio: "ignore" });
      return ["docker", "compose"];
    } catch {
      if (shell.which("docker-compose")) {
        return ["docker-compose"];
      }
      this.error(
        "Docker Compose is required but not found.\nInstall the Docker Compose plugin or standalone docker-compose.\nhttps://docs.docker.com/compose/install/"
      );
    }
  }
}
