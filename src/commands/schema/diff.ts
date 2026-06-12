import BaseCommand from "../../lib/base-command";
import { credentials, projectLink, globalConfig } from "../../lib/config";
import { schemaApi } from "../../lib/api/services";
import { parseApsorc } from "../../lib/apsorc-parser";
import { apsorcToServiceSchema } from "../../lib/utils/schema-convert";

// Inline ANSI color helpers (no dependency needed)
const useColor = (): boolean => !globalConfig.read().noColor;
const green = (s: string): string =>
  useColor() ? `\u001B[32m${s}\u001B[0m` : s;
const red = (s: string): string =>
  useColor() ? `\u001B[31m${s}\u001B[0m` : s;
const yellow = (s: string): string =>
  useColor() ? `\u001B[33m${s}\u001B[0m` : s;

export default class SchemaDiff extends BaseCommand {
  static description = "Show diff between local and remote schema";

  static examples = [`$ apso schema diff`];

  static flags = {};

  async run(): Promise<void> {
    // Auth guard
    if (!credentials.isValid()) {
      this.error("Not logged in. Run 'apso login' first.");
    }

    // Link guard
    const link = projectLink.read();
    if (!link) {
      this.error("Project not linked. Run 'apso link' first.");
    }

    // Parse local schema
    let parsed;
    try {
      parsed = parseApsorc();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.error(`Failed to parse .apsorc: ${msg}`);
    }

    const localSchema = apsorcToServiceSchema(parsed);

    // Get diff from platform
    const diff = await schemaApi.diff(
      link.workspaceSlug,
      link.serviceSlug,
      localSchema
    );

    if (!diff.hasChanges) {
      this.log("Local and remote schemas are in sync.");
      return;
    }

    this.log("Schema differences:\n");

    if (diff.added.length > 0) {
      for (const item of diff.added) {
        this.log(green(`  + ${item}`));
      }
    }

    if (diff.removed.length > 0) {
      for (const item of diff.removed) {
        this.log(red(`  - ${item}`));
      }
    }

    if (diff.modified.length > 0) {
      for (const item of diff.modified) {
        this.log(yellow(`  ~ ${item}`));
      }
    }

    this.log(
      `\n${green(String(diff.added.length) + " added")}, ${red(String(diff.removed.length) + " removed")}, ${yellow(String(diff.modified.length) + " modified")}`
    );
  }
}
