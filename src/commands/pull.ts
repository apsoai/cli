import { Flags, ux } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import {
  readProjectLink,
  writeProjectLink,
  updateSchemaHashes,
} from "../lib/project-link";
import { createApiClient } from "../lib/api/client";
import { parseApsorc } from "../lib/apsorc-parser";
import { convertPlatformToLocal } from "../lib/schema-converter";
import { calculateSchemaHash } from "../lib/schema-hash";
import { detectConflict, getConflictSummary, ConflictType } from "../lib/conflict-detector";
import { LocalApsorcSchema } from "../lib/schema-converter/types";
import { getServiceCodeDir, syncApsorcToRoot, syncApsorcToCodeBundle, getProjectRoot } from "../lib/project-link";
import * as fs from "fs";
import * as path from "path";
import * as AdmZip from "adm-zip";

/**
 * Sort entities by name for deterministic output
 */
function sortEntities(entities: any[]): any[] {
  return [...entities].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Sort relationships for deterministic output:
 * 1. By 'from' entity name
 * 2. Then by 'to' entity name
 */
function sortRelationships(relationships: any[]): any[] {
  return [...relationships].sort((a, b) => {
    const fromCompare = (a.from || "").localeCompare(b.from || "");
    if (fromCompare !== 0) return fromCompare;
    return (a.to || "").localeCompare(b.to || "");
  });
}

/**
 * Sort fields within entities by name for deterministic output
 */
function sortFields(fields: any[] | undefined): any[] | undefined {
  if (!fields) return undefined;
  return [...fields].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/**
 * Ensure deterministic ordering of .apsorc structure
 */
function normalizeApsorc(apsorc: any): any {
  const normalized = {
    ...apsorc,
  };

  // Sort entities and their fields
  if (normalized.entities) {
    normalized.entities = sortEntities(normalized.entities).map((entity) => ({
      ...entity,
      fields: sortFields(entity.fields),
    }));
  }

  // Sort relationships
  if (normalized.relationships) {
    normalized.relationships = sortRelationships(normalized.relationships);
  }

  return normalized;
}

/**
 * Write .apsorc file with proper formatting
 */
function writeApsorcFile(apsorc: any, targetPath: string): void {
  const normalized = normalizeApsorc(apsorc);
  const json = JSON.stringify(normalized, null, 2);
  fs.writeFileSync(targetPath, json, "utf8");
}

export default class Pull extends BaseCommand {
  static description =
    "Pull the latest schema from the platform and update local .apsorc";

  static examples = [
    `$ apso pull  # Pull both schema and code`,
    `$ apso pull --force  # Overwrite existing .apsorc without prompt`,
    `$ apso pull --schema-only  # Only pull schema, skip code`,
  ];

  static flags = {
    force: Flags.boolean({
      char: "f",
      description: "Overwrite existing .apsorc without confirmation and skip conflict checks",
      default: false,
    }),
    output: Flags.string({
      char: "o",
      description: "Write to alternative file instead of .apsorc (e.g., .apsorc.remote)",
    }),
    "schema-only": Flags.boolean({
      char: "s",
      description: "Only pull schema, skip code download",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Pull);

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

    // Git pre-flight: detect uncommitted changes before modifying files
    // (applies to pull since it can overwrite .apsorc and code).
    const projectRoot = getProjectRoot();
    const gitContext = await this.gitPreflight(projectRoot, {
      operationName: "pull",
    });
    this.log(`Pulling schema for service: ${link.serviceSlug} (${link.serviceId})`);
    this.log(`Workspace: ${link.workspaceSlug} (${link.workspaceId})`);

    // Fetch latest schema from platform
    const api = createApiClient();
    let platformSchema: any;
    try {
      this.log("Fetching latest schema from platform...");
      platformSchema = await api.getLatestSchema(link.serviceId);
    } catch (error) {
      const err = error as Error;
      // Show full error details
      this.error(
        `Failed to fetch schema: ${err.message}\n\n` +
          `Troubleshooting:\n` +
          `  - Check if the service has schemas on the platform\n` +
          `  - Verify service ID: ${link.serviceId}\n` +
          `  - Run with DEBUG=1 for more details: $env:APSO_DEBUG='1'; apso pull`
      );
    }

    // Convert platform schema to local format
    const conversionResult = convertPlatformToLocal(platformSchema, {
      preserveUnsupported: true,
      warnUnsupported: false, // Don't log warnings during conversion
    });

    if (!conversionResult.success) {
      this.error(
        `Failed to convert platform schema: ${conversionResult.error.message}\n` +
          (conversionResult.error.entity
            ? `Entity: ${conversionResult.error.entity}\n`
            : "") +
          (conversionResult.error.field
            ? `Field: ${conversionResult.error.field}\n`
            : "") +
          (conversionResult.error.relationship
            ? `Relationship: ${conversionResult.error.relationship}\n`
            : "")
      );
    }

    const convertedSchema = conversionResult.data;

    // Determine output path
    const apsorcPath = flags.output
      ? path.resolve(flags.output)
      : path.join(process.cwd(), ".apsorc");
    const apsorcExists = fs.existsSync(apsorcPath);

    // Calculate remote schema hash
    const remoteHash = calculateSchemaHash(convertedSchema);

    // Check for conflicts if .apsorc exists and we're not forcing
    if (apsorcExists && !flags.force && !flags.output) {
      try {
        // Read existing local schema
        const existingContent = fs.readFileSync(apsorcPath, "utf8");
        const existingSchema = JSON.parse(existingContent) as LocalApsorcSchema;
        const localHash = calculateSchemaHash(existingSchema);

        // Detect conflicts
        const conflict = detectConflict(
          localHash,
          link.remoteSchemaHash || null,
          existingSchema,
          convertedSchema
        );

        // If there's a conflict, warn the user
        if (conflict.type !== ConflictType.NO_CONFLICT) {
          this.log("");
          this.warn("⚠️  Schema conflict detected!");
          this.log("");
          this.log(getConflictSummary(conflict));
          this.log("");

          if (!flags.force) {
            const action = await ux.prompt(
              "How would you like to proceed?\n" +
                "  [a]bort - Cancel the pull\n" +
                "  [w]rite to .apsorc.remote - Save remote schema to separate file\n" +
                "  [o]verwrite - Overwrite local .apsorc with remote schema\n" +
                "  [f]orce - Overwrite without further prompts\n",
              { default: "a" }
            );

            const choice = action.toLowerCase().trim();
            switch (choice) {
            case "a": 
            case "abort": {
              this.log("Pull cancelled. No changes made.");
              this.exit(0);
            
            break;
            }
            case "w": 
            case "write": {
              // Write to .apsorc.remote instead
              const remotePath = path.join(process.cwd(), ".apsorc.remote");
              writeApsorcFile(convertedSchema, remotePath);
              this.log(`✓ Remote schema written to .apsorc.remote`);
              this.log("");
              this.log("You can now:");
              this.log("  • Compare the files: diff .apsorc .apsorc.remote");
              this.log("  • Manually merge changes");
              this.log("  • Or use 'apso pull --force' to overwrite");
              this.exit(0);
            
            break;
            }
            case "o": 
            case "overwrite": {
              // Continue with overwrite
              this.log("Overwriting local .apsorc with remote schema...");
            
            break;
            }
            case "f": 
            case "force": {
              // Force overwrite
              this.log("Force overwriting local .apsorc...");
            
            break;
            }
            default: {
              this.log("Invalid choice. Pull cancelled.");
              this.exit(0);
            }
            }
          }
        }
      } catch (error) {
        // If we can't read/parse existing .apsorc, warn but continue
        const err = error as Error;
        this.warn(
          `Could not read existing .apsorc for conflict detection: ${err.message}`
        );
        if (!flags.force) {
          const shouldContinue = await ux.confirm(
            "Continue with pull? (y/n)"
          );
          if (!shouldContinue) {
            this.log("Pull cancelled.");
            this.exit(0);
          }
        }
      }
    } else if (apsorcExists && !flags.force && flags.output) {
      // Writing to alternative file, no conflict check needed
      this.log(`Writing remote schema to ${flags.output}...`);
    } else if (apsorcExists && flags.force) {
      this.log("Force flag set. Skipping conflict checks and overwriting .apsorc...");
    }

    // Backup existing .apsorc if it exists
    let backupPath: string | null = null;
    if (apsorcExists) {
      backupPath = `${apsorcPath}.backup.${Date.now()}`;
      fs.copyFileSync(apsorcPath, backupPath);
    }

    // Write converted .apsorc
    try {
      writeApsorcFile(convertedSchema, apsorcPath);

      // Validate the written file using the parser
      try {
        parseApsorc();
        // If we get here, validation succeeded
        this.log(`✓ Schema pulled successfully and written to .apsorc`);

        // Clean up backup on success
        if (backupPath && fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
      } catch (parseError) {
        // Restore backup on validation failure
        if (backupPath && fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, apsorcPath);
          fs.unlinkSync(backupPath);
        }
        const err = parseError as Error;
        this.error(
          `Schema validation failed: ${err.message}\n` +
            `The schema from the platform may be invalid or incompatible.\n` +
            (apsorcExists ? "Original .apsorc has been restored." : "")
        );
      }

      // Update link.json with sync info and hashes
      // After pull, local and remote should match
      const updatedLink = updateSchemaHashes(
        {
          ...link,
          lastSyncedAt: new Date().toISOString(),
          lastSyncDirection: "pull" as const,
        },
        remoteHash, // Local hash = remote hash after pull
        remoteHash  // Remote hash
      );

      writeProjectLink(updatedLink);

      // If schema-only, also sync to code bundle if it exists (for consistency)
      if (flags["schema-only"]) {
        const codeBundleDir = getServiceCodeDir();
        if (fs.existsSync(codeBundleDir)) {
          const syncedPath = syncApsorcToCodeBundle();
          if (syncedPath) {
            this.log("");
            this.log(`✓ Synced .apsorc to code bundle (${syncedPath})`);
          }
        }
      } else {
        // Download code (which includes .apsorc in the bundle)
        await this.downloadServiceCode(api, link);
        
        // After downloading code, sync .apsorc from code bundle to root
        // Code bundle .apsorc is authoritative (matches the generated code)
        const syncedPath = syncApsorcToRoot();
        if (syncedPath) {
          this.log("");
          this.log(`✓ Synced .apsorc from code bundle to root`);
          this.log(`  Code bundle .apsorc is the authoritative version (matches generated code)`);
        }
      }

      this.log("");
      this.log("Next steps:");
      this.log("  • Review the updated .apsorc file");
      if (!flags["schema-only"]) {
        this.log("  • Review the downloaded code in .apso/service-code/");
        this.log("  • Note: .apso/service-code/.apsorc is the authoritative version");
      }
      this.log("  • Run 'apso server scaffold' to regenerate code from the schema");
    } catch (error) {
      // Restore backup on write failure
      if (backupPath && fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, apsorcPath);
        fs.unlinkSync(backupPath);
      }
      const err = error as Error;
      this.error(`Failed to write .apsorc: ${err.message}`);
    } finally {
      // After modifying files, restore any stashed changes (if applicable)
      await this.gitPostflight(projectRoot, gitContext);
    }
  }

  private async downloadServiceCode(
    api: ReturnType<typeof createApiClient>,
    link: { workspaceId: string; serviceId: string }
  ): Promise<void> {
    try {
      this.log("");
      this.log("Downloading service code from S3...");

      const workspaceId = Number(link.workspaceId);
      const serviceId = Number(link.serviceId);

      if (Number.isNaN(workspaceId) || Number.isNaN(serviceId)) {
        this.error("Invalid workspace or service ID");
      }

      // Check if code exists
      const existsPath = `/WorkspaceServices/${workspaceId}/${serviceId}/code/exists`;
      const existsResp = await api.rawRequest<{ exists: boolean }>(existsPath);

      if (!existsResp.exists) {
        this.warn("No code found in S3 for this service. Skipping code download.");
        return;
      }

      // Get download URL
      const downloadUrlPath = `/WorkspaceServices/${workspaceId}/${serviceId}/code/download-url`;
      const downloadResp = await api.rawRequest<{ url: string }>(downloadUrlPath);

      // Download zip
      const zipResponse = await fetch(downloadResp.url);
      if (!zipResponse.ok) {
        throw new Error(`Failed to download code: ${zipResponse.status} ${zipResponse.statusText}`);
      }

      const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
      const zip = new AdmZip.default(zipBuffer);

      // Extract to .apso/service-code/
      const codeDir = getServiceCodeDir();
      if (fs.existsSync(codeDir)) {
        // Remove existing code directory
        fs.rmSync(codeDir, { recursive: true, force: true });
      }
      fs.mkdirSync(codeDir, { recursive: true });

      zip.extractAllTo(codeDir, true);

      const entries = zip.getEntries();
      const fileCount = entries.filter((e) => !e.isDirectory).length;

      this.log(`✓ Code downloaded successfully (${fileCount} files)`);
      this.log(`  Location: ${codeDir}`);
    } catch (error) {
      const err = error as Error;
      this.warn(`Failed to download service code: ${err.message}`);
      this.warn("You can still use 'apso push' to push schema changes.");
    }
  }
}

