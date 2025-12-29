import { Flags, ux } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import {
  readProjectLink,
  writeProjectLink,
  updateSchemaHashes,
  getAuthoritativeApsorcPath,
  getProjectRoot,
} from "../lib/project-link";
import { createApiClient } from "../lib/api/client";
import { parseApsorc } from "../lib/apsorc-parser";
import {
  convertPlatformToLocal,
  convertLocalToPlatform,
} from "../lib/schema-converter";
import { calculateSchemaHash } from "../lib/schema-hash";
import {
  detectConflict,
  getConflictSummary,
  ConflictType,
} from "../lib/conflict-detector";
import { resolveConflictsInteractively } from "../lib/conflict-resolver";
import { LocalApsorcSchema } from "../lib/schema-converter/types";
import * as fs from "fs";
import { NetworkStatus, getNetworkStatus } from "../lib/network";
import {
  enqueueOperation,
  QueueOperationType,
  isQueueFull,
} from "../lib/queue";

type SyncStrategy = "local-wins" | "remote-wins" | "interactive";

export default class Sync extends BaseCommand {
  static description =
    "Synchronize local and remote schemas with configurable merge strategies";

  static examples = [
    `$ apso sync                    # Interactive sync (default)`,
    `$ apso sync --strategy local-wins    # Use local schema, overwrite remote`,
    `$ apso sync --strategy remote-wins   # Use remote schema, overwrite local`,
    `$ apso sync --strategy interactive   # Interactive conflict resolution`,
  ];

  static flags = {
    strategy: Flags.string({
      char: "s",
      description: "Sync strategy: local-wins, remote-wins, or interactive",
      options: ["local-wins", "remote-wins", "interactive"],
      default: "interactive",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Sync);

    // Ensure authentication
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
    this.log(
      `Syncing schemas for service: ${link.serviceSlug} (${link.serviceId})`
    );
    this.log(`Workspace: ${link.workspaceSlug} (${link.workspaceId})`);
    this.log("");

    // Read local schema
    const apsorcPath = getAuthoritativeApsorcPath();
    if (!fs.existsSync(apsorcPath)) {
      this.error(
        ".apsorc file not found.\n" +
          "Please create a .apsorc file first or run 'apso pull' to fetch the schema from the platform."
      );
    }

    let localSchema: LocalApsorcSchema;
    try {
      parseApsorc(); // Validate schema
      const rawContent = fs.readFileSync(apsorcPath);
      // eslint-disable-next-line unicorn/prefer-json-parse-buffer
      localSchema = JSON.parse(rawContent.toString("utf8")) as LocalApsorcSchema;
    } catch (error) {
      const err = error as Error;
      this.error(`Failed to read or parse local .apsorc: ${err.message}`);
    }

    const localHash = calculateSchemaHash(localSchema);

    // Fetch remote schema
    this.log("Fetching remote schema...");

    // Check network status before attempting sync
    const networkStatus = getNetworkStatus();
    if (networkStatus === NetworkStatus.OFFLINE) {
      // Queue the operation for later
      if (isQueueFull()) {
        this.error(
          "Network is offline and queue is full. Please flush the queue or wait for network to be restored."
        );
      }

      const strategy = (flags.strategy || "interactive") as SyncStrategy;
      enqueueOperation({
        type: QueueOperationType.SYNC,
        payload: {
          serviceId: link.serviceId,
          workspaceId: link.workspaceId,
          strategy: strategy === "interactive" ? "local-wins" : strategy, // Interactive not supported in queue
        },
      });

      this.log("");
      this.warn("⚠ Network is offline. Operation has been queued.");
      this.log("");
      this.log("When network is restored, run:");
      this.log("  apso queue flush");
      this.log("");
      this.exit(0);
    }

    const api = createApiClient();
    let remoteSchema: LocalApsorcSchema | undefined;
    let remoteHash: string | null = link.remoteSchemaHash || null;

    try {
      const remotePlatformSchema = await api.getLatestSchema(link.serviceId);
      const conversionResult = convertPlatformToLocal(remotePlatformSchema, {
        preserveUnsupported: true,
        warnUnsupported: false,
      });

      if (!conversionResult.success) {
        this.error(
          `Failed to convert remote schema: ${conversionResult.error.message}`
        );
      }

      remoteSchema = conversionResult.data;
      remoteHash = calculateSchemaHash(remoteSchema);
    } catch (error) {
      const err = error as Error;

      // Check if error is due to network being offline
      if (err.message.includes("offline") || err.message.includes("Network")) {
        // Queue the operation for later
        if (isQueueFull()) {
          this.error(
            "Network is offline and queue is full. Please flush the queue or wait for network to be restored."
          );
        } else {
          const strategy = (flags.strategy || "interactive") as SyncStrategy;
          enqueueOperation({
            type: QueueOperationType.SYNC,
            payload: {
              serviceId: link.serviceId,
              workspaceId: link.workspaceId,
              strategy: strategy === "interactive" ? "local-wins" : strategy,
            },
          });

          this.log("");
          this.warn("⚠ Network is offline. Operation has been queued.");
          this.log("");
          this.log("When network is restored, run:");
          this.log("  apso queue flush");
          this.log("");
          this.exit(0);
        }
      }

      this.error(
        `Failed to fetch remote schema: ${err.message}\n\n` +
          `Troubleshooting:\n` +
          `  - Check your authentication: run 'apso login'\n` +
          `  - Verify service ID: ${link.serviceId}\n` +
          `  - Run with DEBUG=1 for more details: $env:APSO_DEBUG='1'; apso sync`
      );
    }

    // Detect conflict
    const conflict = detectConflict(
      localHash,
      remoteHash,
      localSchema,
      remoteSchema
    );

    this.log("=== Sync Status ===");
    this.log("");
    this.log(`Local hash:  ${localHash}`);
    this.log(`Remote hash: ${remoteHash || "(unknown)"}`);
    this.log(`Status: ${conflict.type}`);
    this.log("");

    // If no conflict, we're already in sync
    if (conflict.type === ConflictType.NO_CONFLICT) {
      this.log("✓ Schemas are in sync - no conflicts detected");
      this.log("");
      this.exit(0);
    }

    // Show conflict summary
    this.log("=== Conflict Detected ===");
    this.log("");
    this.log(getConflictSummary(conflict));
    this.log("");

    // Determine strategy
    const strategy = (flags.strategy || "interactive") as SyncStrategy;

    // Present plan
    this.log("=== Sync Plan ===");
    this.log("");
    if (strategy === "local-wins") {
      this.log("Strategy: local-wins");
      this.log("  → Local schema will overwrite remote schema");
      this.log("  → This will push your local changes to the platform");
    } else if (strategy === "remote-wins") {
      this.log("Strategy: remote-wins");
      this.log("  → Remote schema will overwrite local schema");
      this.log(
        "  → This will pull remote changes and update your local .apsorc"
      );
    } else {
      this.log("Strategy: interactive");
      this.log("  → You will be prompted to choose for each conflict");
    }
    this.log("");

    // Confirm before proceeding
    const shouldProceed = await ux.confirm(
      "Do you want to proceed with this sync? (y/n)"
    );

    if (!shouldProceed) {
      this.log("Sync cancelled.");
      this.exit(0);
    }

    // Execute sync based on strategy
    if (strategy === "local-wins") {
      await this.syncLocalWins(api, link, localSchema, localHash);
    } else if (strategy === "remote-wins") {
      await this.syncRemoteWins(link, remoteSchema!, remoteHash!);
    } else {
      // Interactive strategy - full per-entity/field resolution (CLI-014)
      await this.syncInteractive(
        api,
        link,
        localSchema,
        remoteSchema!,
        localHash
      );
    }

    this.log("");
    this.log("✓ Sync completed successfully");
  }

  private async syncLocalWins(
    api: ReturnType<typeof createApiClient>,
    link: any,
    localSchema: LocalApsorcSchema,
    localHash: string
  ): Promise<void> {
    this.log("");
    this.log(
      "Applying local-wins strategy: pushing local schema to platform..."
    );

    // Convert local to platform format
    const conversionResult = convertLocalToPlatform(localSchema);
    if (!conversionResult.success) {
      this.error(
        `Failed to convert local schema: ${conversionResult.error.message}`
      );
    }

    const platformSchema = conversionResult.data;

    // Push to platform
    try {
      const result = await api.pushSchema(link.serviceId, platformSchema);
      const newRemoteHash = localHash;

      // Update link.json
      const updatedLink = updateSchemaHashes(
        {
          ...link,
          lastSyncedAt: new Date().toISOString(),
          lastSyncDirection: "push" as const,
        },
        localHash,
        newRemoteHash
      );

      writeProjectLink(updatedLink);

      this.log("✓ Local schema pushed to platform successfully");
      if (result.id) {
        this.log(`  Schema ID: ${result.id}`);
      }
      if (result.version) {
        this.log(`  Version: ${result.version}`);
      }
    } catch (error) {
      const err = error as Error;
      this.error(`Failed to push schema: ${err.message}`);
    }
  }

  private async syncRemoteWins(
    link: any,
    remoteSchema: LocalApsorcSchema,
    remoteHash: string
  ): Promise<void> {
    this.log("");
    this.log(
      "Applying remote-wins strategy: pulling remote schema to local..."
    );

    // Git pre-flight check
    const projectRoot = getProjectRoot();
    const gitContext = await this.gitPreflight(projectRoot, {
      operationName: "sync (remote-wins)",
    });

    try {
      // Write remote schema to local .apsorc
      const apsorcPath = getAuthoritativeApsorcPath();
      const normalized = JSON.stringify(remoteSchema, null, 2);
      fs.writeFileSync(apsorcPath, normalized, "utf8");

      // Validate the written file
      parseApsorc();

      // Update link.json
      const updatedLink = updateSchemaHashes(
        {
          ...link,
          lastSyncedAt: new Date().toISOString(),
          lastSyncDirection: "pull" as const,
        },
        remoteHash, // Local hash now matches remote
        remoteHash
      );

      writeProjectLink(updatedLink);

      this.log("✓ Remote schema pulled to local successfully");
      this.log(`  Updated: ${apsorcPath}`);

      // Git post-flight: pop stash if needed
      await this.gitPostflight(projectRoot, gitContext);
    } catch (error) {
      const err = error as Error;
      this.error(`Failed to write local schema: ${err.message}`);
    }
  }

  private async syncInteractive(
    api: ReturnType<typeof createApiClient>,
    link: any,
    localSchema: LocalApsorcSchema,
    remoteSchema: LocalApsorcSchema,
    _localHash: string
  ): Promise<void> {
    this.log("");
    this.log("Starting interactive conflict resolution...");
    this.log("You will be prompted to resolve each conflict individually.");
    this.log("");

    // Resolve conflicts interactively
    const resolution = await resolveConflictsInteractively(
      localSchema,
      remoteSchema,
      (message: string) => this.log(message)
    );

    // Show summary
    this.log("");
    this.log("=== Resolution Summary ===");
    this.log("");
    this.log(
      `Resolved ${resolution.entityResolutions.length} entity conflict(s)`
    );
    this.log("");

    // Confirm final resolution
    const shouldApply = await ux.confirm(
      "Do you want to apply this resolution? (y/n)"
    );

    if (!shouldApply) {
      this.log("Resolution cancelled. No changes made.");
      this.exit(0);
    }

    // Validate resolved schema
    try {
      // Write to a temp file to validate
      const tempPath = getAuthoritativeApsorcPath() + ".tmp";
      fs.writeFileSync(
        tempPath,
        JSON.stringify(resolution.resolvedSchema, null, 2),
        "utf8"
      );

      // Change to project root temporarily to validate
      const originalCwd = process.cwd();
      const projectRoot = getProjectRoot();
      process.chdir(projectRoot);

      try {
        // Validate using parser
        parseApsorc();
      } finally {
        process.chdir(originalCwd);
        // Clean up temp file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      }
    } catch (error) {
      const err = error as Error;
      this.error(
        `Resolved schema validation failed: ${err.message}\n` +
          "Please review your resolution choices and try again."
      );
    }

    // Ask user: push to platform or save locally?
    this.log("");
    this.log("How would you like to apply the resolution?");
    this.log("");
    this.log("[1] Push resolved schema to platform (update remote)");
    this.log("[2] Save resolved schema locally only (update local .apsorc)");
    this.log("");

    const applyChoice = await ux.prompt("Select option (1 or 2)", {
      required: true,
      default: "1",
    });

    // Git pre-flight check for local writes
    const projectRoot = getProjectRoot();
    let gitContext: any = null;
    if (applyChoice === "2") {
      gitContext = await this.gitPreflight(projectRoot, {
        operationName: "sync (interactive - local)",
      });
    }

    try {
      if (applyChoice === "1") {
        // Push to platform
        this.log("");
        this.log("Pushing resolved schema to platform...");

        const conversionResult = convertLocalToPlatform(
          resolution.resolvedSchema
        );
        if (!conversionResult.success) {
          this.error(
            `Failed to convert resolved schema: ${conversionResult.error.message}`
          );
        }

        const platformSchema = conversionResult.data;
        const result = await api.pushSchema(link.serviceId, platformSchema);

        // Also update local .apsorc to match
        const apsorcPath = getAuthoritativeApsorcPath();
        fs.writeFileSync(
          apsorcPath,
          JSON.stringify(resolution.resolvedSchema, null, 2),
          "utf8"
        );

        // Validate the written file
        parseApsorc();

        const resolvedHash = calculateSchemaHash(resolution.resolvedSchema);

        // Update link.json
        const updatedLink = updateSchemaHashes(
          {
            ...link,
            lastSyncedAt: new Date().toISOString(),
            lastSyncDirection: "push" as const,
          },
          resolvedHash,
          resolvedHash
        );

        writeProjectLink(updatedLink);

        this.log("✓ Resolved schema pushed to platform successfully");
        this.log(`  Updated local .apsorc: ${apsorcPath}`);
        if (result.id) {
          this.log(`  Schema ID: ${result.id}`);
        }
        if (result.version) {
          this.log(`  Version: ${result.version}`);
        }
      } else if (applyChoice === "2") {
        // Save locally only
        this.log("");
        this.log("Saving resolved schema locally...");

        const apsorcPath = getAuthoritativeApsorcPath();
        fs.writeFileSync(
          apsorcPath,
          JSON.stringify(resolution.resolvedSchema, null, 2),
          "utf8"
        );

        // Validate the written file
        parseApsorc();

        const resolvedHash = calculateSchemaHash(resolution.resolvedSchema);

        // Update link.json (local hash changes, remote stays the same)
        const updatedLink = updateSchemaHashes(
          {
            ...link,
            lastSyncedAt: new Date().toISOString(),
            lastSyncDirection: null, // Local-only change, not a sync direction
          },
          resolvedHash,
          link.remoteSchemaHash || null
        );

        writeProjectLink(updatedLink);

        this.log("✓ Resolved schema saved locally");
        this.log(`  Updated: ${apsorcPath}`);
        this.log("");
        this.log("Note: Remote schema has not been updated.");
        this.log(
          "Run 'apso push' to push the resolved schema to the platform."
        );
      } else {
        this.error("Invalid choice. Sync cancelled.");
      }

      // Git post-flight: pop stash if needed
      if (gitContext) {
        await this.gitPostflight(projectRoot, gitContext);
      }
    } catch (error) {
      const err = error as Error;
      this.error(`Failed to apply resolution: ${err.message}`);
    }
  }
}
