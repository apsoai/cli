import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import {
  getQueuedOperations,
  getQueueStats,
  clearQueue,
  formatQueueAge,
  QueueOperationType,
  hasQueuedOperations,
} from "../lib/queue";
import { isOnline } from "../lib/network";
import { createApiClient } from "../lib/api/client";
import {
  readProjectLink,
  writeProjectLink,
  updateSchemaHashes,
} from "../lib/project-link";
import {
  getAuthoritativeApsorcPath,
} from "../lib/project-link";
import { calculateSchemaHash } from "../lib/schema-hash";
import { convertLocalToPlatform } from "../lib/schema-converter";
import { LocalApsorcSchema } from "../lib/schema-converter/types";
import * as fs from "fs";
import { QueuedPushOperation, QueuedSyncOperation } from "../lib/queue";

export default class Queue extends BaseCommand {
  static description = "Manage queued offline operations";

  static examples = [
    "$ apso queue list        # List all queued operations",
    "$ apso queue flush       # Process all queued operations",
    "$ apso queue clear       # Clear all queued operations",
  ];

  static flags = {
    json: Flags.boolean({
      char: "j",
      description: "Output as JSON",
      default: false,
    }),
  };

  static strict = false; // Allow unknown arguments

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Queue);
    const action = (argv[0] as string) || "list";

    if (action === "clear") {
      await this.handleClear(flags.json);
    } else if (action === "flush") {
      await this.handleFlush(flags.json);
    } else {
      await this.handleList(flags.json);
    }
  }

  private async handleList(jsonOutput: boolean): Promise<void> {
    const operations = getQueuedOperations();
    const stats = getQueueStats();

    if (jsonOutput) {
      this.log(
        JSON.stringify({
          total: stats.total,
          byType: stats.byType,
          operations,
        })
      );
      return;
    }

    if (operations.length === 0) {
      this.log("No operations in queue.");
      return;
    }

    this.log("");
    this.log("=== Queued Operations ===");
    this.log("");
    this.log(`Total: ${stats.total}`);
    this.log(`  Push: ${stats.byType[QueueOperationType.PUSH]}`);
    this.log(`  Sync: ${stats.byType[QueueOperationType.SYNC]}`);
    if (stats.oldest && stats.oldest) {
        this.log(`Oldest: ${formatQueueAge(stats.oldest.timestamp)}`);
      }
    this.log("");

    for (const op of operations) {
      this.log(`[${op.id}] ${op.type.toUpperCase()}`);
      this.log(`  Queued: ${formatQueueAge(op.timestamp)}`);
      if (op.retryCount && op.retryCount > 0) {
        this.log(`  Retries: ${op.retryCount}`);
      }
      if (op.type === QueueOperationType.PUSH) {
        const pushOp = op as QueuedPushOperation;
        if (pushOp.schemaPath) {
          this.log(`  Schema: ${pushOp.schemaPath}`);
        }
        if (pushOp.payload.options) {
          const opts: string[] = [];
          if (pushOp.payload.options.force) opts.push("force");
          if (pushOp.payload.options.generateCode) opts.push("generate-code");
          if (pushOp.payload.options.gitPull) opts.push("git-pull");
          if (opts.length > 0) {
            this.log(`  Options: ${opts.join(", ")}`);
          }
        }
      } else if (op.type === QueueOperationType.SYNC) {
        const syncOp = op as QueuedSyncOperation;
        if (syncOp.payload.strategy) {
          this.log(`  Strategy: ${syncOp.payload.strategy}`);
        }
      }
      this.log("");
    }
  }

  private async handleClear(jsonOutput: boolean): Promise<void> {
    const count = getQueueStats().total;
    clearQueue();

    if (jsonOutput) {
      this.log(JSON.stringify({ success: true, cleared: count }));
    } else {
      this.log(`✓ Cleared ${count} operation(s) from queue`);
    }
  }

  private async handleFlush(jsonOutput: boolean): Promise<void> {
    if (!hasQueuedOperations()) {
      if (jsonOutput) {
        this.log(
          JSON.stringify({
            success: true,
            processed: 0,
            message: "Queue is empty",
          })
        );
      } else {
        this.log("Queue is empty. Nothing to process.");
      }
      return;
    }

    // Check network status
    const networkStatus = await isOnline({ timeout: 5000 });
    if (!networkStatus) {
      this.error(
        "Network is offline. Cannot process queue.\n" +
          "Please check your internet connection and try again."
      );
    }

    // Ensure authentication
    await this.ensureAuthenticated({
      nonInteractive:
        process.env.APSO_NON_INTERACTIVE === "1" ||
        process.env.APSO_NON_INTERACTIVE === "true",
    });

    const operations = getQueuedOperations();
    const api = createApiClient();
    let processed = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    if (!jsonOutput) {
      this.log("");
      this.log(`Processing ${operations.length} queued operation(s)...`);
      this.log("");
    }

    for (const op of operations) {
      try {
        if (!jsonOutput) {
          this.log(`Processing [${op.id}] ${op.type.toUpperCase()}...`);
        }

        if (op.type === QueueOperationType.PUSH) {
          // eslint-disable-next-line no-await-in-loop
          await this.processPushOperation(
            api,
            op as QueuedPushOperation,
            jsonOutput
          );
        } else if (op.type === QueueOperationType.SYNC) {
          // eslint-disable-next-line no-await-in-loop
          await this.processSyncOperation(
            api,
            op as QueuedSyncOperation,
            jsonOutput
          );
        }

        // Remove from queue on success
        // eslint-disable-next-line no-await-in-loop
        const { dequeueOperation } = await import("../lib/queue");
        dequeueOperation(op.id);
        processed++;

        if (!jsonOutput) {
          this.log(`✓ Processed [${op.id}]`);
          this.log("");
        }
      } catch (error) {
        failed++;
        const errorMsg = (error as Error).message;
        errors.push({ id: op.id, error: errorMsg });

        // Increment retry count
        // eslint-disable-next-line no-await-in-loop
        const { incrementRetryCount } = await import("../lib/queue");
        incrementRetryCount(op.id);

        if (!jsonOutput) {
          this.warn(`✗ Failed to process [${op.id}]: ${errorMsg}`);
          this.log("");
        }
      }
    }

    if (jsonOutput) {
      this.log(
        JSON.stringify({
          success: failed === 0,
          processed,
          failed,
          errors,
        })
      );
    } else {
      this.log("");
      this.log("=== Queue Processing Complete ===");
      this.log(`Processed: ${processed}`);
      if (failed > 0) {
        this.log(`Failed: ${failed}`);
        this.log("");
        this.log("Failed operations remain in queue and can be retried.");
      }
    }
  }

  private async processPushOperation(
    api: ReturnType<typeof createApiClient>,
    operation: QueuedPushOperation,
    jsonOutput: boolean
  ): Promise<void> {
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      throw new Error("Project is not linked. Cannot process queued push.");
    }

    const { link } = linkInfo;
    const apsorcPath = operation.schemaPath || getAuthoritativeApsorcPath();

    if (!fs.existsSync(apsorcPath)) {
      throw new Error(`Schema file not found: ${apsorcPath}`);
    }

    // Read schema
    const rawContent = fs.readFileSync(apsorcPath);
    // eslint-disable-next-line unicorn/prefer-json-parse-buffer
    const localSchema: LocalApsorcSchema = JSON.parse(rawContent.toString("utf8"));
    const localHash = calculateSchemaHash(localSchema);

    // Convert to platform format
    const conversionResult = convertLocalToPlatform(localSchema);
    if (!conversionResult.success) {
      throw new Error(
        `Schema conversion failed: ${conversionResult.error.message}`
      );
    }

    const platformSchema = conversionResult.data;

    // Push to platform
    if (!jsonOutput) {
      this.log(`  Pushing schema to platform...`);
    }
    const result = await api.pushSchema(link.serviceId, platformSchema);

    // Update link.json
    const newRemoteHash = localHash;
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

    if (!jsonOutput) {
      this.log(`  ✓ Schema pushed successfully`);
      if (result.id) {
        this.log(`    Schema ID: ${result.id}`);
      }
    }

    // Handle code generation if requested
    if (operation.payload.options?.generateCode) {
      if (!jsonOutput) {
        this.log(`  Triggering code generation...`);
      }
      // Note: Code generation is handled by the push command's triggerAndPollCodeGeneration
      // For queue processing, we skip code generation polling to keep it simple
      // Users can manually trigger code generation after queue flush if needed
      if (!jsonOutput) {
        this.log(`  ⚠ Code generation not triggered automatically from queue`);
        this.log(
          `  Run 'apso push --generate-code' after queue flush if needed`
        );
      }
    }
  }

  private async processSyncOperation(
    api: ReturnType<typeof createApiClient>,
    operation: QueuedSyncOperation,
    jsonOutput: boolean
  ): Promise<void> {
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      throw new Error("Project is not linked. Cannot process queued sync.");
    }

    const { link } = linkInfo;
    const strategy = operation.payload.strategy || "local-wins";

    // Read local schema
    const apsorcPath = getAuthoritativeApsorcPath();
    if (!fs.existsSync(apsorcPath)) {
      throw new Error(".apsorc file not found");
    }

    const rawContent = fs.readFileSync(apsorcPath);
    // eslint-disable-next-line unicorn/prefer-json-parse-buffer
    const localSchema: LocalApsorcSchema = JSON.parse(rawContent.toString("utf8"));
    const localHash = calculateSchemaHash(localSchema);

    if (strategy === "local-wins") {
      // Push local to remote
      if (!jsonOutput) {
        this.log(`  Applying local-wins strategy...`);
      }
      const conversionResult = convertLocalToPlatform(localSchema);
      if (!conversionResult.success) {
        throw new Error(
          `Schema conversion failed: ${conversionResult.error.message}`
        );
      }

      await api.pushSchema(
        link.serviceId,
        conversionResult.data
      );
      const newRemoteHash = localHash;

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

      if (!jsonOutput) {
        this.log(`  ✓ Sync completed (local-wins)`);
      }
    } else if (strategy === "remote-wins") {
      // Pull remote to local
      if (!jsonOutput) {
        this.log(`  Applying remote-wins strategy...`);
      }
      const remoteSchema = await api.getLatestSchema(link.serviceId);
      const { convertPlatformToLocal } = await import(
        "../lib/schema-converter"
      );
      const conversionResult = convertPlatformToLocal(remoteSchema, {
        preserveUnsupported: true,
        warnUnsupported: false,
      });

      if (!conversionResult.success) {
        throw new Error(
          `Schema conversion failed: ${conversionResult.error.message}`
        );
      }

      const convertedSchema = conversionResult.data;
      const remoteHash = calculateSchemaHash(convertedSchema);

      // Write to .apsorc
      fs.writeFileSync(
        apsorcPath,
        JSON.stringify(convertedSchema, null, 2),
        "utf8"
      );

      const updatedLink = updateSchemaHashes(
        {
          ...link,
          lastSyncedAt: new Date().toISOString(),
          lastSyncDirection: "pull" as const,
        },
        remoteHash,
        remoteHash
      );
      writeProjectLink(updatedLink);

      if (!jsonOutput) {
        this.log(`  ✓ Sync completed (remote-wins)`);
      }
    } else {
      // Interactive strategy - not supported in queue, use local-wins as fallback
      if (!jsonOutput) {
        this.warn(
          `  Interactive strategy not supported in queue, using local-wins`
        );
      }
      await this.processSyncOperation(
        api,
        {
          ...operation,
          payload: { ...operation.payload, strategy: "local-wins" },
        },
        jsonOutput
      );
    }
  }
}
