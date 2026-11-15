import { Flags } from "@oclif/core";
import inquirer from "inquirer";
import BaseCommand from "../../lib/base-command";
import { credentials, projectLink } from "../../lib/config";
import { schemaApi } from "../../lib/api/services";
import { parseApsorc, readApsorcFile } from "../../lib/apsorc-parser";
import { computeSchemaHash } from "../../lib/utils/schema-convert";

export default class SchemaPush extends BaseCommand {
  static description = "Push local schema to the platform";

  static examples = [
    `$ apso schema push`,
    `$ apso schema push --yes`,
  ];

  static flags = {
    yes: Flags.boolean({
      char: "y",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaPush);

    // Auth guard
    if (!credentials.isValid()) {
      this.error("Not logged in. Run 'apso login' first.");
    }

    // Link guard
    const link = projectLink.read();
    if (!link) {
      this.error("Project not linked. Run 'apso link' first.");
    }

    // Check the schema parses, then push the file as it is: the platform
    // stores the .apsorc whole, so nothing in it is lost on the way.
    let localSchema;
    try {
      parseApsorc();
      localSchema = readApsorcFile().apsorc;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.error(`Failed to parse .apsorc: ${msg}`);
    }

    // Check diff first
    const diff = await schemaApi.diff(
      link.workspaceSlug,
      link.serviceSlug,
      localSchema
    );

    if (!diff.hasChanges) {
      this.log("Already in sync. Nothing to push.");
      return;
    }

    // Show changes
    this.log("Changes to push:\n");
    if (diff.added.length > 0) {
      for (const item of diff.added) {
        this.log(`  + ${item}`);
      }
    }
    if (diff.removed.length > 0) {
      for (const item of diff.removed) {
        this.log(`  - ${item}`);
      }
    }
    if (diff.modified.length > 0) {
      for (const item of diff.modified) {
        this.log(`  ~ ${item}`);
      }
    }
    this.log(
      `\n${diff.added.length} added, ${diff.removed.length} removed, ${diff.modified.length} modified`
    );

    // Confirm
    if (!flags.yes) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: "confirm",
          name: "confirm",
          message: "Push these changes to the platform?",
          default: true,
        },
      ]);
      if (!confirm) {
        this.log("Push cancelled.");
        return;
      }
    }

    // Push
    const updatedSchema = await schemaApi.update(
      link.workspaceSlug,
      link.serviceSlug,
      localSchema
    );

    // Update sync metadata
    const localHash = computeSchemaHash(localSchema);
    const remoteHash = computeSchemaHash(updatedSchema ?? localSchema);
    projectLink.updateSyncMetadata({
      lastSyncedAt: new Date().toISOString(),
      localSchemaHash: localHash,
      remoteSchemaHash: remoteHash,
    });

    this.log("Schema pushed successfully.");
  }
}
