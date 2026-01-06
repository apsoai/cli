import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { getWebBaseUrlSync } from "../lib/config/index";
import {
  readProjectLink,
} from "../lib/project-link";
import { createApiClient } from "../lib/api/client";

import { getServiceCodeDir, getAuthoritativeApsorcPath, syncApsorcToCodeBundle, getProjectRoot } from "../lib/project-link";
import * as fs from "fs";
import * as path from "path";
import shell from "shelljs";
import {
  createDecipheriv,
  CipherKey,
  BinaryLike,
} from "crypto";
import AdmZip from "adm-zip";
import FormData from "form-data";

export default class Push extends BaseCommand {
  static description =
    "Push local .apsorc schema to the platform";

  static examples = [
    `$ apso push`,
    `$ apso push --dry-run  # Show what would change without pushing`,
    `$ apso push --force     # Push even if conflicts are detected`,
  ];

  static flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Force push even if conflicts are detected (use with caution)",
      default: false,
    }),
    "dry-run": Flags.boolean({
      char: "d",
      description: "Validate and show what would change without actually pushing",
      default: false,
    }),
    "generate-code": Flags.boolean({
      char: "g",
      description: "Trigger code generation after schema push and poll until completion",
      default: false,
    }),
    "git-pull": Flags.boolean({
      description:
        "After successful code push to GitHub, run 'git pull' in the project root to fetch latest remote changes",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Push);

    // Ensure authentication (supports non-interactive mode via APSO_NON_INTERACTIVE).
    await this.ensureAuthenticated({
      nonInteractive:
        process.env.APSO_NON_INTERACTIVE === "1" ||
        process.env.APSO_NON_INTERACTIVE === "true",
    });

    // Read project link
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      this.error(
        "Project is not linked to a service.\n" +
        "Run 'apso link' first to associate this project with a platform service."
      );
    }

    const { link } = linkInfo;
    this.log(
      `Pushing schema for service: ${link.serviceName}`
    );
    this.log(`Workspace: ${link.workspaceName}`);

    // Get authoritative .apsorc path.
    const apsorcPath = getAuthoritativeApsorcPath();
    if (!fs.existsSync(apsorcPath)) {
      this.error(
        ".apsorc file not found.\n" +
        "Please create a .apsorc file first or run 'apso pull' to fetch the schema from the platform."
      );
    }
    // Push to platform
    try {
      this.log("Pushing schema to platform...");
      const api = createApiClient();

      // Push code if it exists
      await this.zipServiceCode(getServiceCodeDir(), link.workspaceId, link.serviceId, api);
      await this.pushServiceCode(api, link, flags);

      this.log("");
      this.log("Next steps:");
      this.log("  • Review the schema on the platform");
      this.log("  • Run 'apso server scaffold' to regenerate code locally if needed");
    } catch (error) {
      const err = error as Error;
      this.error(
        `Failed to push schema: ${err.message}\n` +
        "\nTroubleshooting:" +
        "\n  • Check your authentication: run 'apso login'" +
        "\n  • Verify the service ID is correct" +
        "\n  • Check if you have permission to update schemas" +
        "\n  • Run with DEBUG=1 for more details: $env:APSO_DEBUG='1'; apso push"
      );
    }
  }

  private async pushServiceCode(
    api: ReturnType<typeof createApiClient>,
    link: { workspaceId: string; serviceId: string; connectionId?: number; githubOwner?: string; repoName?: string; githubRepo?: string | null; githubBranch?: string | null },
    _flags: { [name: string]: any }
  ): Promise<void> {
    const projectRoot = getProjectRoot();
    const expectedCodeDir = getServiceCodeDir();
    const resolvedExpectedDir = path.resolve(expectedCodeDir);
    const currentDir = process.cwd();
    const resolvedCurrentDir = path.resolve(currentDir);

    // Determine the actual code directory (same logic as pull)
    let resolvedCodeDir: string;

    const currentDirGit = path.join(resolvedCurrentDir, ".git");
    const expectedDirGit = path.join(resolvedExpectedDir, ".git");

    if (resolvedCurrentDir === resolvedExpectedDir && fs.existsSync(currentDirGit)) {
      resolvedCodeDir = resolvedCurrentDir;
    } else if (fs.existsSync(resolvedExpectedDir) && fs.existsSync(expectedDirGit)) {
      resolvedCodeDir = resolvedExpectedDir;
    } else if (resolvedCurrentDir === projectRoot && fs.existsSync(currentDirGit)) {
      resolvedCodeDir = resolvedCurrentDir;
    } else {
      // Code directory not found
      this.log("");
      this.warn("Code repository not found locally. Skipping code push.");
      this.log("");
      this.log("Please clone your repository first:");
      this.log(`  Run: apso clone`);
      return;
    }

    // Ensure code bundle .apsorc is up to date before pushing
    // This ensures the code bundle always has the latest schema
    const syncedPath = syncApsorcToCodeBundle();
    if (syncedPath) {
      this.log("");
      this.log("✓ Ensured code bundle .apsorc is up to date");
    }

    try {
      this.log("");
      this.log("Pushing service code to GitHub...");

      // Check if GitHub connection is available
      if (!link.connectionId) {
        this.warn("GitHub connection not found. Skipping code push.");
        this.warn("Run 'apso github:connect' first to connect the service to a GitHub repository.");
        return;
      }

      // Check if repository info is available
      if (!link.githubOwner || !link.repoName) {
        this.warn("GitHub repository information not found. Skipping code push.");
        this.warn("Run 'apso github:connect' first to connect the service to a GitHub repository.");
        return;
      }

      // Fetch GitHub connection details
      this.log("  Fetching GitHub connection details...");
      /* eslint-disable camelcase */
      interface GithubConnection {
        id: number;
        accessToken: string;
        github_username: string;
      }
      /* eslint-enable camelcase */

      let githubConnection: GithubConnection;
      try {
        githubConnection = await api.rawRequest<GithubConnection>(
          `/GithubConnections/${link.connectionId}`
        );
      } catch (error) {
        const err = error as Error;
        this.warn(`Failed to fetch GitHub connection: ${err.message}`);
        this.warn("Skipping code push.");
        return;
      }

      // Determine branch
      const branch = link.githubBranch || "main";

      // Decrypt token for authentication
      const decryptedToken = this.decrypt(githubConnection.accessToken);
      const authenticatedRepoUrl = `https://x-access-token:${decryptedToken}@github.com/${link.githubOwner}/${link.repoName}.git`;

      this.log(`  Repository: ${link.githubOwner}/${link.repoName}`);
      this.log(`  Branch: ${branch}`);

      // Set environment variable to prevent git from prompting for credentials
      const env = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      };

      // Change to code directory and push
      const originalCwd = process.cwd();
      try {
        process.chdir(resolvedCodeDir);

        // Update remote URL with authenticated URL to ensure authentication works
        const remoteUpdateResult = shell.exec(
          `git remote set-url origin "${authenticatedRepoUrl}"`,
          { silent: true, env }
        );

        if (remoteUpdateResult.code !== 0) {
          this.warn("Failed to update git remote URL. Continuing with existing remote...");
        }

        // Check if there are changes to commit
        const statusResult = shell.exec(
          `git status --porcelain`,
          { silent: true, env }
        );

        const hasChanges = statusResult.stdout.trim().length > 0;

        if (hasChanges) {
          // Stage all changes
          this.log("  Staging changes...");
          const addResult = shell.exec(
            `git add -A`,
            { silent: true, env }
          );

          if (addResult.code !== 0) {
            const errorOutput = addResult.stderr || addResult.stdout || "Unknown error";
            this.error(
              `Failed to stage changes.\n` +
              `Error: ${errorOutput}`
            );
            return;
          }

          // Commit changes
          this.log("  Committing changes...");
          const commitResult = shell.exec(
            `git commit -m "local cli commit"`,
            { silent: true, env }
          );

          if (commitResult.code !== 0) {
            const errorOutput = commitResult.stderr || commitResult.stdout || "Unknown error";
            // If commit fails because there's nothing to commit, that's okay
            if (!errorOutput.includes("nothing to commit")) {
              this.error(
                `Failed to commit changes.\n` +
                `Error: ${errorOutput}`
              );
              return;
            }
          }
        }

        // Push to GitHub
        this.log("  Pushing to GitHub...");
        const pushResult = shell.exec(
          `git push origin ${branch}`,
          { silent: false, env } // Set to false to show git output
        );

        if (pushResult.code !== 0) {
          const errorOutput = pushResult.stderr || pushResult.stdout || "Unknown error";
          this.error(
            `Failed to push code to GitHub.\n` +
            `Error: ${errorOutput}\n\n` +
            `Troubleshooting:\n` +
            `  - Check your network connection\n` +
            `  - Verify you have push access to the repository\n` +
            `  - Check if there are conflicts that need to be resolved\n` +
            `  - Verify the branch exists: ${branch}`
          );
          return;
        }

        this.log("");
        this.log("✓ Code pushed successfully to GitHub");
        this.log(`  Repository: ${link.githubOwner}/${link.repoName}`);
        this.log(`  Branch: ${branch}`);
      } finally {
        process.chdir(originalCwd);
      }
    } catch (error) {
      const err = error as Error;
      this.warn(`Failed to push service code: ${err.message}`);
      this.warn("Schema push succeeded, but code push failed.");
    }
  }

  /**
   * Decrypt GitHub access token
   * TODO: Move this to a shared utility
   */
  private decrypt(token: string): string {
    const aesKeyB64 =
      process.env.AES_KEY_B64 ||
      "7N0eyS0YaZXKlXBK+tSY+3i/tKrKWqjrwaK++XtJSn8=";
    const key = Buffer.from(aesKeyB64, "base64");
    const [ivB64, dataB64, tagB64] = token.split(".");
    if (!ivB64 || !dataB64 || !tagB64) throw new Error("Invalid token format");

    const iv = Buffer.from(ivB64, "base64url");
    const encrypted = Buffer.from(dataB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key as CipherKey,
      iv as BinaryLike,
      {
        authTagLength: 16,
      }
    );

    decipher.setAuthTag(tag as NodeJS.ArrayBufferView);

    const decrypted = Buffer.concat([
      decipher.update(encrypted as any),
      decipher.final(),
    ] as any);
    return decrypted.toString("utf8");
  }

  private async zipServiceCode(codeDir: string, workspaceId: string, serviceId: string, api: ReturnType<typeof createApiClient>): Promise<void> {
    // Create zip from service code directory
    this.log("  Creating zip archive...");
    const zip = new AdmZip();
    zip.addLocalFolder(codeDir, "", (filename: string) => {
      // Exclude common files/folders
      return !(
        filename.includes(".git") ||
        filename.includes("node_modules") ||
        filename.includes(".DS_Store") ||
        filename.includes(".idea") ||
        filename.includes(".vscode") ||
        filename.includes(".zip")
      );
    });

    const zipBuffer = zip.toBuffer();

    // Upload to S3
    this.log("  Uploading to S3...");

    // Use form-data package for Node.js compatibility
    const formData = new FormData();

    // Append file with proper options
    formData.append("file", zipBuffer, {
      filename: "code.zip",
      contentType: "application/zip",
      knownLength: zipBuffer.length, // Help form-data calculate content-length
    });

    const uploadPath = `/WorkspaceServices/${workspaceId}/${serviceId}/code/upload`;
    const uploadResp = await api.uploadFile<{
      success: boolean;
      version?: string;
      size?: number;
      bucket?: string;
      key?: string;
    }>(uploadPath, formData);

    if (!uploadResp.success) {
      throw new Error("S3 upload returned success=false");
    }

    this.log(`  ✓ Code uploaded to S3 successfully`);
    if (uploadResp?.size && uploadResp?.size > 0) {
      this.log(`    Size: ${(uploadResp.size / 1024).toFixed(2)} KB`);
    }

  }

  private async triggerAndPollCodeGeneration(
    api: ReturnType<typeof createApiClient>,
    link: { serviceId: string }
  ): Promise<void> {
    try {
      const serviceId = Number(link.serviceId);
      if (Number.isNaN(serviceId)) {
        this.warn("Invalid service ID. Skipping code generation.");
        return;
      }

      this.log("");
      this.log("Triggering code generation...");

      // Trigger code generation via the API
      // Note: This calls the Next.js API route which triggers AWS Step Functions
      // The endpoint is on the frontend, so we need to use the web base URL
      let triggerResponse: { success?: boolean; executionArn?: string } | null = null;

      try {
        const webBaseUrl = getWebBaseUrlSync();
        const token = await (api as any).getAccessToken();

        const response = await fetch(`${webBaseUrl}/api/triggerServiceDeploy/${serviceId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        triggerResponse = await response.json();
      } catch (error) {
        // If trigger fails, we'll still poll (code generation might be triggered automatically)
        const err = error as Error;
        if (process.env.DEBUG || process.env.APSO_DEBUG) {
          this.log(`[DEBUG] Trigger endpoint error (will continue polling): ${err.message}`);
        }
        this.warn("Could not trigger code generation endpoint. Polling anyway (it may have been auto-triggered)...");
      }

      if (triggerResponse && !triggerResponse.success && !triggerResponse.executionArn) {
        this.warn("Code generation trigger returned unexpected response. Polling anyway...");
      }

      this.log("✓ Code generation started");
      this.log("  Polling for completion...");

      // Poll for build status
      await this.pollBuildStatus(api, serviceId);
    } catch (error) {
      const err = error as Error;
      this.warn(`Failed to trigger code generation: ${err.message}`);
      this.warn("Schema push succeeded, but code generation failed.");
    }
  }

  private async pollBuildStatus(
    api: ReturnType<typeof createApiClient>,
    serviceId: number,
    maxAttempts = 120, // 10 minutes max (5 second intervals)
    intervalMs = 5000
  ): Promise<void> {
    const statusMessages: Record<string, string> = {
      New: "Initializing...",
      ProvisioningDatabase: "Provisioning database...",
      DatabaseProvisioned: "Database provisioned",
      ProvisioningCodebase: "Provisioning codebase...",
      CodebaseProvisioned: "Codebase provisioned",
      InitializingService: "Initializing service...",
      ServiceInitialized: "Service initialized",
      Scaffolding: "Scaffolding code...",
      Scaffolded: "Code scaffolded",
      Building: "Building service...",
      BuildDone: "Build complete",
      Ready: "Ready",
      TriggeringCodeBuild: "Triggering code build...",
      CodeBuildTriggered: "Code build triggered",
      GeneratingMigrations: "Generating migrations...",
      MigrationsGenerated: "Migrations generated",
      RunningMigrations: "Running migrations...",
      MigrationsCompleted: "Migrations completed",
    };

    const errorStatuses = new Set([
      "ErrorProvisioningDatabase",
      "ErrorProvisioningCodebase",
      "ErrorInitializingService",
      "ErrorScaffolding",
      "ErrorBuilding",
      "ErrorTriggeringCodeBuild",
      "ErrorGeneratingMigrations",
      "ErrorRunningMigrations",
      "ErrorUpdatingStack",
      "ErrorCreatingStack",
    ]);

    const successStatuses = new Set(["Ready", "BuildDone", "MigrationsCompleted", "StackUpdated", "StackCreated"]);

    let lastStatus: string | null = null;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        // Fetch service to get build_status
        // eslint-disable-next-line no-await-in-loop, camelcase
        const service = await api.rawRequest<{ build_status?: string }>(
          `/WorkspaceServices/${serviceId}`
        );

        const currentStatus = service.build_status || "Unknown";

        // Show status change
        // eslint-disable-next-line no-negated-condition
        if (currentStatus !== lastStatus) {
          const statusMessage = statusMessages[currentStatus] || currentStatus;
          this.log(`  ${statusMessage} (${currentStatus})`);
          lastStatus = currentStatus;
        } else {
          // Show spinner for same status
          process.stdout.write(".");
        }

        // Check for completion
        if (successStatuses.has(currentStatus)) {
          this.log("");
          this.log("✓ Code generation completed successfully!");
          this.log(`  Final status: ${currentStatus}`);
          return;
        }

        // Check for errors
        if (errorStatuses.has(currentStatus)) {
          this.log("");
          this.error(`Code generation failed with status: ${currentStatus}`);
          return;
        }

        attempts++;
        // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (error) {
        const err = error as Error;
        // If it's a 404 or auth error, stop polling
        if (err.message.includes("404") || err.message.includes("401")) {
          this.log("");
          this.warn(`Polling stopped: ${err.message}`);
          return;
        }
        // For other errors, continue polling
        attempts++;
        // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    // Timeout
    this.log("");
    this.warn(`Code generation polling timed out after ${maxAttempts * intervalMs / 1000} seconds`);
    this.warn("The code generation may still be in progress. Check the platform for status.");
  }
}

