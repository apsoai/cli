import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { credentials, projectLink } from "../lib/config";
import { servicesApi, buildApi, githubApi } from "../lib/api/services";
import { withUpgradeRetry } from "../lib/upgrade";
import * as git from "../lib/git";
import { parseApsorc } from "../lib/apsorc-parser";
import { runMigrationSandbox } from "../lib/migrate/sandbox";
import { createSpinner } from "../lib/utils/spinner";
import type { Service } from "../lib/api/types";

export default class Deploy extends BaseCommand {
  static description = "Deploy the linked service";

  static examples = [
    `$ apso deploy`,
    `$ apso deploy --yes`,
    `$ apso deploy --skip-migrate`,
    `$ apso deploy --no-wait`,
  ];

  static flags = {
    "no-wait": Flags.boolean({
      description: "Trigger deploy without waiting for completion",
      default: false,
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Skip confirmation prompt",
      default: false,
    }),
    "skip-migrate": Flags.boolean({
      description: "Skip local migration validation",
      default: false,
    }),
    "skip-push": Flags.boolean({
      description: "Skip uploading + pushing code (redeploy current code)",
      default: false,
    }),
    repo: Flags.string({
      description: "GitHub repo (owner/name) to connect when none is linked yet",
    }),
    branch: Flags.string({
      description: "Branch to push to",
      default: "main",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Deploy);

    // Auth guard
    if (!credentials.isValid()) {
      this.error("Not logged in. Run 'apso login' first.");
    }

    // Link guard
    const link = projectLink.read();
    if (!link) {
      this.error("Project not linked. Run 'apso link' first.");
    }

    // Fetch service
    const service = await servicesApi.get(link.workspaceSlug, link.serviceSlug);

    // Run migration sandbox (unless skipped)
    let migrationCount = 0;
    if (!flags["skip-migrate"]) {
      let parsed;
      try {
        parsed = parseApsorc();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.error(`Failed to parse .apsorc: ${msg}`);
      }

      this.log("Running migration check...");
      const result = await runMigrationSandbox({
        entities: parsed.entities,
        relationshipMap: parsed.relationshipMap,
      });

      if (result.needed) {
        if (!result.success) {
          this.log("");
          this.log("Migration FAILED locally. Deploy aborted.");
          if (result.error) {
            this.log(`Error: ${result.error}`);
          }
          this.log("Fix the schema issue before deploying.");
          this.log("Run 'apso migrate' for details.");
          this.exit(1);
        }

        migrationCount = result.upSql.length;
        this.log(`Migration validated: ${migrationCount} statement(s).`);

        // Show SQL preview
        this.log("");
        for (const sql of result.upSql) {
          this.log(`  ${sql};`);
        }
        this.log("");
      } else {
        this.log("No schema changes detected.");
      }
    }

    // Sync local code to the connected GitHub repo (the deploy builds from it).
    // Skip for redeploys of already-synced code.
    if (!flags["skip-push"]) {
      await this.syncCodeToGithub(service, flags.repo, flags.branch);
    }

    // Determine source
    if (service.githubRepo || flags.repo) {
      this.log(
        `Deploying "${service.name}" from ${service.githubRepo || flags.repo}#${flags.branch}...`
      );
    } else {
      this.log(`Deploying "${service.name}" via Apso Platform...`);
    }

    // Confirmation
    if (!flags.yes && migrationCount > 0) {
      const inquirer = await import("inquirer");
      const { confirm } = await inquirer.default.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `Deploy with ${migrationCount} migration statement(s)?`,
          default: true,
        },
      ]);
      if (!confirm) {
        this.log("Deploy cancelled.");
        return;
      }
    }

    // Trigger build
    const build = await withUpgradeRetry(() =>
      buildApi.trigger(link.workspaceSlug, link.serviceSlug)
    );
    this.log(`Build started: ${build.id}`);

    if (flags["no-wait"]) {
      this.log("Deploy triggered. Run 'apso status' to check progress.");
      return;
    }

    // Poll with spinner
    const spinner = await createSpinner("Deploying...");
    spinner.start();

    const finalStatus = await buildApi.waitForCompletion(build.id, {
      onProgress: (status) => {
        spinner.text = `Deploy status: ${status.status}...`;
      },
    });

    if (finalStatus.status === "success") {
      spinner.succeed("Deploy succeeded.");
      if (service.endpoint) {
        this.log(`Endpoint: ${service.endpoint}`);
      }
    } else {
      spinner.fail("Deploy failed.");
      if (finalStatus.error) {
        this.log(`Error: ${finalStatus.error}`);
      }
      this.log("Run 'apso logs' to view build logs.");
      this.exit(1);
    }
  }

  /**
   * Push the local scaffold to the service's GitHub repo with the user's own
   * git, and make sure the repo is connected to the service so the provisioner
   * can clone it at deploy time. No code passes through Apso — we read the local
   * git and push straight to GitHub.
   */
  private async syncCodeToGithub(
    service: Service,
    repoFlag: string | undefined,
    branch: string
  ): Promise<void> {
    const cwd = process.cwd();

    if (!git.gitAvailable()) {
      this.error("git is required to deploy. Install git and try again.");
    }
    git.initRepo(cwd);

    // Pick the repo: prefer what the local project is already wired to, then the
    // service's connected repo, then --repo, then ask.
    const conn = await githubApi.getConnection();
    if (!conn.connected || !conn.connectionId) {
      this.error(
        "GitHub is not connected. Run 'apso github connect' first, then re-run deploy."
      );
    }

    let repoFullName =
      git.localRepoFullName(cwd) || service.githubRepo || repoFlag;
    if (!repoFullName) {
      repoFullName = await this.promptRepoSelection(conn.connectionId);
    }

    // Connect the repo to the service (records ServiceRepository) unless the
    // service is already linked to this exact repo.
    if (service.githubRepo !== repoFullName) {
      this.log(`Connecting repository ${repoFullName}...`);
      await githubApi.connectRepo(service.id, conn.connectionId, repoFullName);
    }

    // Point the local repo at it and push with the user's git credentials.
    git.setOrigin(cwd, git.httpsUrlFor(repoFullName));
    const committed = git.commitAll(cwd, "Deploy via Apso CLI");
    this.log(
      committed
        ? `Committed local changes; pushing to ${repoFullName}#${branch}...`
        : `Pushing to ${repoFullName}#${branch}...`
    );
    try {
      git.pushHead(cwd, branch);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.error(
        `git push to ${repoFullName} failed. Ensure you have push access and your git credentials are set up.\n${msg}`
      );
    }
  }

  /** Let the user pick one of their GitHub repos to deploy from. */
  private async promptRepoSelection(connectionId: string): Promise<string> {
    const repos = await githubApi.listRepos("", { connectionId, pageSize: 100 });
    if (!repos.data.length) {
      this.error(
        "No GitHub repositories available. Create one on GitHub (or pass --repo owner/name)."
      );
    }
    const inquirer = await import("inquirer");
    const { repo } = await inquirer.default.prompt<{ repo: string }>([
      {
        type: "list",
        name: "repo",
        message: "Select a GitHub repository to deploy from:",
        choices: repos.data.map((r) => ({ name: r.fullName, value: r.fullName })),
      },
    ]);
    return repo;
  }
}
