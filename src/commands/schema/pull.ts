import { Flags } from "@oclif/core";
import * as fs from "fs";
import inquirer from "inquirer";
import BaseCommand from "../../lib/base-command";
import { credentials, projectLink, createBackup } from "../../lib/config";
import { schemaApi } from "../../lib/api/services";
import { findConfigPath } from "../../lib/apsorc-parser";
import {
  serviceSchemaToApsorc,
  computeSchemaHash,
} from "../../lib/utils/schema-convert";

export default class SchemaPull extends BaseCommand {
  static description = "Pull remote schema to local .apsorc";

  static examples = [
    `$ apso schema pull`,
    `$ apso schema pull --yes`,
  ];

  static flags = {
    yes: Flags.boolean({
      char: "y",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaPull);

    // Auth guard
    if (!credentials.isValid()) {
      this.error("Not logged in. Run 'apso login' first.");
    }

    // Link guard
    const link = projectLink.read();
    if (!link) {
      this.error("Project not linked. Run 'apso link' first.");
    }

    // Fetch remote schema
    const remoteSchema = await schemaApi.get(
      link.workspaceSlug,
      link.serviceSlug
    );

    // Convert to .apsorc format
    const apsorcData = serviceSchemaToApsorc(remoteSchema);

    // Find local .apsorc path
    const configPath = findConfigPath();
    if (!configPath) {
      this.error("No .apsorc file found. Run 'apso init' first.");
    }

    // Show what will change
    const entityNames = apsorcData.entities.map((e) => e.name).join(", ");
    this.log(`Remote schema: ${apsorcData.entities.length} entities (${entityNames})`);
    this.log(`Relationships: ${apsorcData.relationships.length}`);
    this.log(`Target file: ${configPath}`);

    // Confirm
    if (!flags.yes) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: "confirm",
          name: "confirm",
          message: "Overwrite local .apsorc with remote schema?",
          default: false,
        },
      ]);
      if (!confirm) {
        this.log("Pull cancelled.");
        return;
      }
    }

    // Backup existing .apsorc
    const backupPath = createBackup(configPath);
    this.log(`Backup created: ${backupPath}`);

    // Write updated .apsorc
    fs.writeFileSync(configPath, JSON.stringify(apsorcData, null, 2), "utf-8");

    // Update sync metadata
    const remoteHash = computeSchemaHash(remoteSchema.entities);
    const localHash = computeSchemaHash(apsorcData);
    projectLink.updateSyncMetadata({
      lastSyncedAt: new Date().toISOString(),
      localSchemaHash: localHash,
      remoteSchemaHash: remoteHash,
    });

    this.log("Schema pulled successfully.");
  }
}
