import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { buildApi, envApi, type PromotePreview } from "../lib/api/services";
import { confirmOrExit, linkedService } from "../lib/environments";
import { createSpinner } from "../lib/utils/spinner";

export default class Promote extends BaseCommand {
  static description =
    "Promote staging to production. Production runs the image staging runs now, with no rebuild. Stops when the platform blocks the promote.";

  static examples = [
    `$ apso promote`,
    `$ apso promote --dry-run`,
    `$ apso promote --dry-run --json`,
    `$ apso promote --yes`,
  ];

  static flags = {
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
    "dry-run": Flags.boolean({ description: "Show what would be promoted and stop", default: false }),
    json: Flags.boolean({ description: "Print the preview as JSON", default: false }),
    "no-wait": Flags.boolean({ description: "Start the promote without waiting for it to finish", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Promote);
    const service = await linkedService(this);
    const preview = await envApi.promotePreview(service.id);

    if (flags.json) this.log(JSON.stringify(preview, null, 2));
    else this.log(describePreview(preview));

    if (preview.blocked) this.error(`Promote blocked: ${preview.blocked}`);
    if (flags["dry-run"]) return;

    const ok = await confirmOrExit(this, flags.yes, `Promote staging to production for "${service.name}"?`);
    if (!ok) return this.log("Cancelled.");

    await envApi.promote(service.id);
    if (flags["no-wait"]) {
      this.log("Promote started. Run 'apso status' to check progress.");
      return;
    }
    const spinner = await createSpinner("Promoting...");
    spinner.start();
    const result = await buildApi.waitForCompletion(service.id, {
      onProgress: (s) => {
        spinner.text = `Promote status: ${s.status}...`;
      },
    });
    if (result.status === "success") {
      spinner.succeed("Production now runs staging's build.");
    } else {
      spinner.fail("Promote failed. Production is unchanged.");
      this.exit(1);
    }
  }
}

export function describePreview(p: PromotePreview): string {
  const lines = [`Commits: ${p.commits.length}`];
  for (const c of p.commits.slice(0, 20)) lines.push(`  ${c.sha.slice(0, 7)} ${c.message.split("\n")[0]}`);
  lines.push(`Migrations: ${p.migrations.length > 0 ? p.migrations.join(", ") : "none"}`);
  if (p.missingEnvVars.length > 0) lines.push(`Missing in production: ${p.missingEnvVars.join(", ")}`);
  return lines.join("\n");
}
