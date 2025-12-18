import { Flags, ux } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { isAuthenticated } from "../lib/config/index";
import {
  readProjectLink,
  writeProjectLink,
  updateSchemaHashes,
} from "../lib/project-link";
import { createApiClient } from "../lib/api/client";
import { parseApsorc, ApsorcType } from "../lib/apsorc-parser";
import { convertLocalToPlatform } from "../lib/schema-converter";
import { calculateSchemaHash } from "../lib/schema-hash";
import {
  detectConflict,
  getConflictSummary,
  ConflictType,
} from "../lib/conflict-detector";
import { LocalApsorcSchema } from "../lib/schema-converter/types";
import { getServiceCodeDir } from "../lib/project-link";
import * as fs from "fs";
import * as path from "path";
import * as AdmZip from "adm-zip";
import * as FormData from "form-data";

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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Push);

    // Check authentication
    if (!isAuthenticated()) {
      const shouldLogin = await ux.confirm(
        "You are not logged in. Would you like to log in now? (y/n)"
      );
      if (shouldLogin) {
        await this.config.runCommand("login", []);
        // Re-check after login
        if (!isAuthenticated()) {
          this.error(
            "Authentication failed. Please run 'apso login' manually and try again."
          );
        }
      } else {
        this.error("Please run 'apso login' first and try again.");
      }
    }

    // Read project link
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      this.error(
        "Project is not linked to a service.\n" +
          "Run 'apso link' first to associate this project with a platform service."
      );
    }

    const { link } = linkInfo;
    this.log(`Pushing schema for service: ${link.serviceSlug} (${link.serviceId})`);
    this.log(`Workspace: ${link.workspaceSlug} (${link.workspaceId})`);

    // Check if .apsorc exists
    const apsorcPath = path.join(process.cwd(), ".apsorc");
    if (!fs.existsSync(apsorcPath)) {
      this.error(
        ".apsorc file not found in the current directory.\n" +
          "Please create a .apsorc file first or run 'apso pull' to fetch the schema from the platform."
      );
    }

    // Read and parse local .apsorc
    let localSchema: LocalApsorcSchema;
    try {
      // First validate using parser
      parseApsorc();

      // Then read the raw file for conversion
      const rawContent = fs.readFileSync(apsorcPath, "utf8");
      localSchema = JSON.parse(rawContent) as LocalApsorcSchema;
    } catch (error) {
      const err = error as Error;
      this.error(
        `Failed to read or parse .apsorc file: ${err.message}\n` +
          "Please ensure the .apsorc file is valid JSON and follows the schema format."
      );
    }

    // Convert local schema to platform format
    this.log("Validating and converting local schema...");
    const conversionResult = convertLocalToPlatform(localSchema);

    if (!conversionResult.success) {
      const error = conversionResult.error;
      this.error(
        `Schema validation failed: ${error.message}\n` +
          (error.entity ? `Entity: ${error.entity}\n` : "") +
          (error.field ? `Field: ${error.field}\n` : "") +
          (error.relationship ? `Relationship: ${error.relationship}\n` : "") +
          "\nPlease fix the errors in your .apsorc file and try again."
      );
    }

    const platformSchema = conversionResult.data;

    // Calculate local schema hash
    const localHash = calculateSchemaHash(localSchema);

    // Fetch remote schema for conflict detection (unless dry-run or force)
    let remoteSchema: LocalApsorcSchema | undefined;
    let remoteHash: string | null = link.remoteSchemaHash || null;

    if (!flags["dry-run"] && !flags.force) {
      try {
        this.log("Checking for conflicts with remote schema...");
        const api = createApiClient();
        const remotePlatformSchema = await api.getLatestSchema(link.serviceId);

        // Convert remote platform schema to local format for comparison
        const { convertPlatformToLocal } = await import(
          "../lib/schema-converter"
        );
        const remoteToLocal = convertPlatformToLocal(remotePlatformSchema);
        if (remoteToLocal.success) {
          remoteSchema = remoteToLocal.data;
          remoteHash = calculateSchemaHash(remoteSchema);
        } else {
          this.warn(
            `Could not convert remote schema for comparison: ${remoteToLocal.error.message}`
          );
        }
      } catch (error) {
        // If we can't fetch remote schema, warn but continue
        const err = error as Error;
        this.warn(
          `Could not fetch remote schema for conflict detection: ${err.message}`
        );
        this.warn("Proceeding with push, but conflicts may occur.");
      }
    }

    // Detect conflicts
    if (!flags["dry-run"] && !flags.force) {
      const conflict = detectConflict(
        localHash,
        remoteHash,
        localSchema,
        remoteSchema
      );

      if (conflict.type !== ConflictType.NO_CONFLICT) {
        this.log("");
        this.warn("⚠️  Schema conflict detected!");
        this.log("");
        this.log(getConflictSummary(conflict));
        this.log("");

        const shouldContinue = await ux.confirm(
          "Do you want to proceed with push anyway? (y/n)"
        );
        if (!shouldContinue) {
          this.log("Push cancelled.");
          this.log("");
          this.log("Recommended actions:");
          this.log("  • Run 'apso diff' to see detailed differences");
          this.log("  • Run 'apso pull' to update local schema first");
          this.log("  • Use 'apso push --force' to force push (with caution)");
          this.exit(0);
        }
      }
    }

    // Show dry-run summary
    if (flags["dry-run"]) {
      this.log("");
      this.log("=== DRY RUN MODE ===");
      this.log("");
      this.log("Schema validation: ✓ Passed");
      this.log(`Local schema hash: ${localHash}`);
      if (remoteHash) {
        this.log(`Remote schema hash: ${remoteHash}`);
        if (localHash !== remoteHash) {
          this.warn("⚠️  Hashes differ - conflicts may occur");
        } else {
          this.log("✓ Hashes match - no conflicts");
        }
      }
      this.log("");
      this.log("Summary of changes that would be pushed:");
      this.log(`  • Entities: ${localSchema.entities.length}`);
      this.log(
        `  • Relationships: ${localSchema.relationships?.length || 0}`
      );
      this.log(`  • Root folder: ${localSchema.rootFolder}`);
      this.log(`  • API type: ${localSchema.apiType}`);
      this.log("");
      this.log("No changes were made to the platform.");
      this.exit(0);
    }

    // Push to platform
    try {
      this.log("Pushing schema to platform...");
      const api = createApiClient();
      const result = await api.pushSchema(link.serviceId, platformSchema);

      // Calculate new remote hash (should match local after push)
      const newRemoteHash = localHash;

      // Update link.json with sync info
      const updatedLink = updateSchemaHashes(
        {
          ...link,
          lastSyncedAt: new Date().toISOString(),
          lastSyncDirection: "push" as const,
        },
        localHash, // Local hash stays the same
        newRemoteHash // Remote hash now matches local
      );

      writeProjectLink(updatedLink);

      this.log("");
      this.log("✓ Schema pushed successfully to platform");
      if (result.id) {
        this.log(`  Schema ID: ${result.id}`);
      }
      if (result.version) {
        this.log(`  Version: ${result.version}`);
      }

      // Push code if it exists
      await this.pushServiceCode(api, link);

      this.log("");
      this.log("Next steps:");
      this.log("  • Review the schema on the platform");
      this.log("  • Run 'apso server scaffold' to regenerate code if needed");
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
    link: { workspaceId: string; serviceId: string; githubRepo?: string | null; githubBranch?: string | null }
  ): Promise<void> {
    const codeDir = getServiceCodeDir();
    if (!fs.existsSync(codeDir)) {
      // Code directory doesn't exist, skip code push
      return;
    }

    try {
      this.log("");
      this.log("Pushing service code to S3 and GitHub...");

      const workspaceId = Number(link.workspaceId);
      const serviceId = Number(link.serviceId);

      if (Number.isNaN(workspaceId) || Number.isNaN(serviceId)) {
        this.warn("Invalid workspace or service ID. Skipping code push.");
        return;
      }

      // Check if GitHub is connected
      if (!link.githubRepo || !link.githubBranch) {
        this.warn("Service is not connected to GitHub. Skipping code push.");
        this.warn("Run 'apso github:connect' first to connect the service to a GitHub repository.");
        return;
      }

      // Create zip from .apso/service-code/
      this.log("  Creating zip archive...");
      const zip = new AdmZip.default();
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
      const FormDataClass = FormData.default || FormData;
      const formData = new FormDataClass();
      
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
      if (uploadResp.size) {
        this.log(`    Size: ${(uploadResp.size / 1024).toFixed(2)} KB`);
      }

      // Push from S3 to GitHub
      this.log("  Pushing to GitHub repository...");
      const pushPath = `/github-connections/push-repository/${serviceId}`;
      const pushBody = {
        workspaceId: workspaceId,
        branch: link.githubBranch,
        message: "apso commit",
      };

      await api.rawRequest(pushPath, {
        method: "POST",
        body: JSON.stringify(pushBody),
      });

      this.log("");
      this.log("✓ Code pushed successfully to GitHub");
      this.log(`  Repository: ${link.githubRepo}`);
      this.log(`  Branch:     ${link.githubBranch}`);
    } catch (error) {
      const err = error as Error;
      this.warn(`Failed to push service code: ${err.message}`);
      this.warn("Schema push succeeded, but code push failed.");
    }
  }
}

