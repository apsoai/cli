import BaseCommand from "../lib/base-command";
import { credentials, projectLink } from "../lib/config";
import { servicesApi, buildApi, githubApi, envApi } from "../lib/api/services";
import { asEnv, envFlag } from "../lib/environments";

export default class Status extends BaseCommand {
  static description = "Show the current service and latest build status";

  static examples = [`$ apso status`, `$ apso status --env staging`];

  static flags = { env: envFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const env = asEnv(flags.env);
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
    const service = await servicesApi.get(link.workspaceId, link.serviceSlug);

    this.log(`Service: ${service.name} (${service.slug})`);
    this.log(`Workspace: ${link.workspaceSlug}`);
    this.log(`Environment: ${env}`);

    // Staging is its own row (stack, URL, build): show it and stop.
    if (env !== "production") {
      const row = await envApi.get(service.id, env);
      if (!row) {
        this.error(`"${service.name}" has no ${env} environment. Run 'apso env add ${env}'.`);
      }
      this.log(`Status: ${row.status || "-"}`);
      this.log(`Build: ${row.buildStatus || "-"}`);
      if (row.url) this.log(`Endpoint: ${row.url}`);
      if (row.lastDeployedAt) this.log(`Last deployed: ${new Date(row.lastDeployedAt).toLocaleString()}`);
      return;
    }
    this.log(`Status: ${service.status}`);
    // Distinguish the account-level GitHub connection from this service's repo:
    // "GitHub: not connected" was misleading when the account WAS connected but
    // the service had no repo yet (the repo is created on the first deploy).
    const conn = await githubApi
      .getConnection()
      .catch(() => ({ connected: false }));
    this.log(
      `GitHub account: ${
        conn.connected ? "connected" : "not connected (run 'apso github connect')"
      }`
    );
    this.log(
      `Repo: ${service.githubRepo || "none yet (created on first deploy)"}`
    );
    if (service.endpoint) {
      this.log(`Endpoint: ${service.endpoint}`);
    }
    if (service.lastDeployedAt) {
      this.log(`Last deployed: ${new Date(service.lastDeployedAt).toLocaleString()}`);
    }

    // Fetch latest build
    const latestBuild = await buildApi.getLatest(
      link.workspaceSlug,
      link.serviceSlug
    );

    if (latestBuild) {
      this.log("");
      this.log("Latest build:");
      this.log(`  ID: ${latestBuild.id}`);
      this.log(`  Status: ${latestBuild.status}`);
      this.log(`  Started: ${new Date(latestBuild.startedAt).toLocaleString()}`);
      if (latestBuild.completedAt) {
        this.log(
          `  Completed: ${new Date(latestBuild.completedAt).toLocaleString()}`
        );
      }
      if (latestBuild.error) {
        this.log(`  Error: ${latestBuild.error}`);
      }
    } else {
      this.log("\nNo builds found. Run 'apso deploy' to trigger one.");
    }
  }
}
