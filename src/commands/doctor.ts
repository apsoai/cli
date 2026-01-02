import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { readProjectLink } from "../lib/project-link";
import { isAuthenticated, readCredentials } from "../lib/config/index";
import { isOnline, NetworkStatus, getNetworkStatus } from "../lib/network";
import { getAuthoritativeApsorcPath } from "../lib/project-link";
import * as fs from "fs";

interface DiagnosticResult {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  suggestion?: string;
}

export default class Doctor extends BaseCommand {
  static description = "Run diagnostics to check CLI and project health";

  static examples = ["$ apso doctor", "$ apso doctor --json"];

  static flags = {
    json: Flags.boolean({
      char: "j",
      description: "Output as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);
    const diagnostics: DiagnosticResult[] = [];

    // Check Node version
    diagnostics.push(this.checkNodeVersion());

    // Check CLI version
    diagnostics.push(this.checkCliVersion());

    // Check authentication
    diagnostics.push(await this.checkAuthentication());

    // Check project link
    diagnostics.push(this.checkProjectLink());

    // Check network reachability
    diagnostics.push(await this.checkNetworkReachability());

    // Check local schema file
    diagnostics.push(this.checkLocalSchema());

    // Output results
    if (flags.json) {
      this.outputJson(diagnostics);
    } else {
      this.outputHumanReadable(diagnostics);
    }

    // Exit with non-zero if there are errors
    const hasErrors = diagnostics.some((d) => d.status === "error");
    if (hasErrors) {
      this.exit(1);
    }
  }

  private checkNodeVersion(): DiagnosticResult {
    const nodeVersion = process.version;
    const majorVersion = Number.parseInt(nodeVersion.slice(1).split(".")[0], 10);
    const requiredVersion = 20; // Based on memory: Node.js version 20 or above

    return majorVersion >= requiredVersion
      ? {
          name: "Node.js Version",
          status: "ok",
          message: `Node.js ${nodeVersion} is installed`,
        }
      : {
          name: "Node.js Version",
          status: "error",
          message: `Node.js ${nodeVersion} is installed, but version ${requiredVersion} or above is required`,
          suggestion: `Please upgrade Node.js to version ${requiredVersion} or above. Visit https://nodejs.org/`,
        };
  }

  private checkCliVersion(): DiagnosticResult {
    const version = this.config.version;
    return {
      name: "CLI Version",
      status: "ok",
      message: `Apso CLI version ${version}`,
    };
  }

  private async checkAuthentication(): Promise<DiagnosticResult> {
    const authenticated = isAuthenticated();
    if (authenticated) {
      const creds = readCredentials();
      const email = creds?.user?.email || "unknown";
      return {
        name: "Authentication",
        status: "ok",
        message: `Authenticated as ${email}`,
      };
    }
    return {
      name: "Authentication",
      status: "error",
      message: "Not authenticated",
      suggestion: "Run 'apso login' to authenticate",
    };
  }

  private checkProjectLink(): DiagnosticResult {
    const linkInfo = readProjectLink();
    if (linkInfo) {
      return {
        name: "Project Link",
        status: "ok",
        message: `Linked to workspace "${linkInfo.link.workspaceSlug}" and service "${linkInfo.link.serviceSlug}"`,
      };
    }
    return {
      name: "Project Link",
      status: "warning",
      message: "Project is not linked to a service",
      suggestion:
        "Run 'apso link' to link this project to a workspace and service",
    };
  }

  private async checkNetworkReachability(): Promise<DiagnosticResult> {
    const networkStatus = getNetworkStatus();
    if (networkStatus === NetworkStatus.OFFLINE) {
      // Try to check online status
      const online = await isOnline({ timeout: 5000 });
      return online
        ? {
            name: "Network Reachability",
            status: "ok",
            message: "Network is reachable",
          }
        : {
            name: "Network Reachability",
            status: "warning",
            message: "Network appears to be offline",
            suggestion:
              "Check your internet connection. Some commands may use cached data or queue operations.",
          };
    }
    return {
      name: "Network Reachability",
      status: "ok",
      message: "Network is reachable",
    };
  }

  private checkLocalSchema(): DiagnosticResult {
    const apsorcPath = getAuthoritativeApsorcPath();
    if (!fs.existsSync(apsorcPath)) {
      return {
        name: "Local Schema",
        status: "warning",
        message: "No local .apsorc file found",
        suggestion: "Run 'apso pull' to fetch the schema from the platform",
      };
    }

    try {
      // eslint-disable-next-line unicorn/prefer-json-parse-buffer
      const content = fs.readFileSync(apsorcPath, { encoding: "utf8" });
      const schema = JSON.parse(content);

      if (!schema.version) {
        return {
          name: "Local Schema",
          status: "warning",
          message:
            ".apsorc file exists but is missing required 'version' field",
          suggestion:
            "The schema may be outdated. Consider running 'apso pull' to fetch the latest schema",
        };
      }

      const entityCount = schema.entities?.length || 0;
      return {
        name: "Local Schema",
        status: "ok",
        message: `.apsorc file found with ${entityCount} entity/entities`,
      };
    } catch (error) {
      return {
        name: "Local Schema",
        status: "error",
        message: `.apsorc file exists but is invalid: ${
          (error as Error).message
        }`,
        suggestion:
          "Fix the .apsorc file or run 'apso pull' to fetch a fresh schema",
      };
    }
  }

  private outputJson(diagnostics: DiagnosticResult[]): void {
    const summary = {
      total: diagnostics.length,
      ok: diagnostics.filter((d) => d.status === "ok").length,
      warnings: diagnostics.filter((d) => d.status === "warning").length,
      errors: diagnostics.filter((d) => d.status === "error").length,
      diagnostics,
    };

    this.log(JSON.stringify(summary, null, 2));
  }

  private outputHumanReadable(diagnostics: DiagnosticResult[]): void {
    this.log("");
    this.log("=== Apso CLI Diagnostics ===");
    this.log("");

    for (const diagnostic of diagnostics) {
      const icon = this.getStatusIcon(diagnostic.status);
      this.log(`${icon} ${diagnostic.name}: ${diagnostic.message}`);

      if (diagnostic.suggestion) {
        this.log(`   → ${diagnostic.suggestion}`);
      }
    }

    this.log("");
    this.log("=== Summary ===");
    const okCount = diagnostics.filter((d) => d.status === "ok").length;
    const warningCount = diagnostics.filter(
      (d) => d.status === "warning"
    ).length;
    const errorCount = diagnostics.filter((d) => d.status === "error").length;

    this.log(`✓ OK: ${okCount}`);
    if (warningCount > 0) {
      this.log(`⚠ Warnings: ${warningCount}`);
    }
    if (errorCount > 0) {
      this.log(`✗ Errors: ${errorCount}`);
    }

    if (errorCount > 0) {
      this.log("");
      this.log(
        "Some issues were found. Please address them before continuing."
      );
    } else if (warningCount > 0) {
      this.log("");
      this.log(
        "Some warnings were found, but the CLI should work. Consider addressing them."
      );
    } else {
      this.log("");
      this.log("All checks passed! ✓");
    }
  }

  private getStatusIcon(status: "ok" | "warning" | "error"): string {
    switch (status) {
      case "ok":
        return "✓";
      case "warning":
        return "⚠";
      case "error":
        return "✗";
      default:
        return "?";
    }
  }
}
