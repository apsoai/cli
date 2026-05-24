import { Args } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { credentials, projectLink } from "../lib/config";
import { buildApi } from "../lib/api/services";

export default class Logs extends BaseCommand {
  static description = "View build logs for the linked service";

  static examples = [
    `$ apso logs`,
    `$ apso logs <build-id>`,
  ];

  static args = {
    buildId: Args.string({
      description: "Specific build ID (defaults to latest)",
      required: false,
    }),
  };

  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(Logs);

    // Auth guard
    if (!credentials.isValid()) {
      this.error("Not logged in. Run 'apso login' first.");
    }

    // Link guard
    const link = projectLink.read();
    if (!link) {
      this.error("Project not linked. Run 'apso link' first.");
    }

    let build;

    if (args.buildId) {
      build = await buildApi.getStatus(args.buildId);
    } else {
      build = await buildApi.getLatest(link.workspaceSlug, link.serviceSlug);
      if (!build) {
        this.log("No builds found. Run 'apso deploy' to trigger one.");
        return;
      }
    }

    this.log(`Build: ${build.id}`);
    this.log(`Status: ${build.status}`);
    this.log(`Started: ${new Date(build.startedAt).toLocaleString()}`);
    if (build.completedAt) {
      this.log(`Completed: ${new Date(build.completedAt).toLocaleString()}`);
    }
    if (build.error) {
      this.log(`Error: ${build.error}`);
    }

    this.log("\n--- Logs ---\n");

    if (build.logs) {
      this.log(build.logs);
    } else {
      this.log("No logs available.");
      if (build.status === "pending" || build.status === "building") {
        this.log("Build is still in progress. Try again when it completes.");
      }
    }
  }
}
