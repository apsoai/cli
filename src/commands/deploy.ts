import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { credentials, projectLink } from "../lib/config";
import { servicesApi, buildApi } from "../lib/api/services";
import { withUpgradeRetry } from "../lib/upgrade";
import { parseApsorc } from "../lib/apsorc-parser";
import { runMigrationSandbox } from "../lib/migrate/sandbox";
import { createSpinner } from "../lib/utils/spinner";

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

    // Determine source
    if (service.githubRepo) {
      this.log(
        `Deploying "${service.name}" from ${service.githubRepo}#${service.githubBranch || "main"}...`
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
}
