import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { readProjectLink, getAuthoritativeApsorcPath } from "../lib/project-link";
import { createApiClient } from "../lib/api/client";
import { parseApsorc } from "../lib/apsorc-parser";
import { convertPlatformToLocal } from "../lib/schema-converter";
import { calculateSchemaHash } from "../lib/schema-hash";
import { detectConflict, ConflictType } from "../lib/conflict-detector";
import { LocalApsorcSchema } from "../lib/schema-converter/types";
import * as fs from "fs";

/**
 * Format a timestamp as a relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "Never";

  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) {
      return diffSecs === 0 ? "Just now" : diffSecs + " second" + (diffSecs === 1 ? "" : "s") + " ago";
    } if (diffMins < 60) {
      return diffMins + " minute" + (diffMins === 1 ? "" : "s") + " ago";
    } if (diffHours < 24) {
      return diffHours + " hour" + (diffHours === 1 ? "" : "s") + " ago";
    } if (diffDays < 7) {
      return diffDays + " day" + (diffDays === 1 ? "" : "s") + " ago";
    } 
      return date.toLocaleDateString();
    
  } catch {
    return timestamp;
  }
}

/**
 * Get sync status description from conflict type
 */
function getSyncStatusDescription(conflictType: ConflictType): {
  status: string;
  icon: string;
  description: string;
} {
  switch (conflictType) {
    case ConflictType.NO_CONFLICT:
      return {
        status: "In sync",
        icon: "✓",
        description: "Local and remote schemas are synchronized",
      };
    case ConflictType.LOCAL_CHANGED:
      return {
        status: "Local ahead",
        icon: "↑",
        description: "Local schema has changes not yet pushed to remote",
      };
    case ConflictType.REMOTE_CHANGED:
      return {
        status: "Remote ahead",
        icon: "↓",
        description: "Remote schema has changes not yet pulled locally",
      };
    case ConflictType.DIVERGED:
      return {
        status: "Diverged",
        icon: "⚠",
        description: "Local and remote schemas have diverged (both have changes)",
      };
    default:
      return {
        status: "Unknown",
        icon: "?",
        description: "Unable to determine sync status",
      };
  }
}

/**
 * Get suggested actions based on conflict type
 */
function getSuggestedActions(conflictType: ConflictType): string[] {
  switch (conflictType) {
    case ConflictType.NO_CONFLICT:
      return ["No action needed - schemas are in sync"];
    case ConflictType.LOCAL_CHANGED:
      return ["Run 'apso push' to push local changes to the platform", "Run 'apso sync' to sync changes"];
    case ConflictType.REMOTE_CHANGED:
      return ["Run 'apso pull' to pull remote changes locally", "Run 'apso sync' to sync changes"];
    case ConflictType.DIVERGED:
      return [
        "Run 'apso diff' to see detailed differences",
        "Run 'apso sync' to merge changes interactively",
        "Run 'apso push --force' to overwrite remote (with caution)",
        "Run 'apso pull --force' to overwrite local (with caution)",
      ];
    default:
      return ["Run 'apso sync' to check and resolve conflicts"];
  }
}

export default class Status extends BaseCommand {
  static description = "Show current project and sync status";

  static examples = [
    "$ apso status",
    "$ apso status --json",
    "$ apso status --check  # Exit with code 1 if out of sync",
  ];

  static flags = {
    json: Flags.boolean({
      char: "j",
      description: "Output as JSON",
      default: false,
    }),
    check: Flags.boolean({
      char: "c",
      description: "Exit with code 1 if schemas are out of sync",
      default: false,
    }),
    live: Flags.boolean({
      char: "l",
      description: "Fetch current live remote schema instead of using cached hash",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);

    // Check if project is linked
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      if (flags.json) {
        this.log(
          JSON.stringify({
            linked: false,
            message: "Project is not linked to a service",
          })
        );
      } else {
        this.error(
          "Project is not linked to a service.\n" +
            "Run 'apso link' first to associate this project with a platform service."
        );
      }
      if (flags.check) {
        this.exit(1);
      }
      return;
    }

    const { link } = linkInfo;

    // Try to read local schema
    let localSchema: LocalApsorcSchema | undefined;
    let localHash: string | null = null;
    const apsorcPath = getAuthoritativeApsorcPath();

    if (fs.existsSync(apsorcPath)) {
      try {
        parseApsorc(); // Validate schema
        const rawContent = fs.readFileSync(apsorcPath, "utf8");
        localSchema = JSON.parse(rawContent) as LocalApsorcSchema;
        localHash = calculateSchemaHash(localSchema);
      } catch (error) {
        // Schema exists but can't be parsed - that's okay, we'll show what we can
        if (!flags.json) {
          this.warn("Local .apsorc file exists but could not be parsed: " + (error as Error).message);
        }
      }
    }

    // Fetch remote schema if needed
    let remoteSchema: LocalApsorcSchema | undefined;
    let remoteHash: string | null = link.remoteSchemaHash || null;
    let remoteHashFetched = false;

    if (flags.live || !remoteHash) {
      try {
        await this.ensureAuthenticated({
          nonInteractive: process.env.APSO_NON_INTERACTIVE === "1" || process.env.APSO_NON_INTERACTIVE === "true",
        });

        const api = createApiClient();
        const remotePlatformSchema = await api.getLatestSchema(link.serviceId);
        const conversionResult = convertPlatformToLocal(remotePlatformSchema, {
          preserveUnsupported: true,
          warnUnsupported: false,
        });

        if (conversionResult.success) {
          remoteSchema = conversionResult.data;
          remoteHash = calculateSchemaHash(remoteSchema);
          remoteHashFetched = true;
        }
      } catch (error) {
        // Can't fetch remote - that's okay, we'll use cached hash
        if (!flags.json) {
          this.warn("Could not fetch remote schema: " + (error as Error).message);
        }
      }
    }

    // Detect conflict
    const conflict = detectConflict(localHash, remoteHash, localSchema, remoteSchema);
    const syncStatus = getSyncStatusDescription(conflict.type);
    const suggestedActions = getSuggestedActions(conflict.type);

    // Output results
    if (flags.json) {
      const output: any = {
        linked: true,
        workspace: {
          id: link.workspaceId,
          slug: link.workspaceSlug,
        },
        service: {
          id: link.serviceId,
          slug: link.serviceSlug,
        },
        github: link.githubRepo
          ? {
              repo: link.githubRepo,
              branch: link.githubBranch,
            }
          : null,
        sync: {
          status: syncStatus.status.toLowerCase().replace(/\s+/g, "_"),
          conflictType: conflict.type,
          localHash: localHash,
          remoteHash: remoteHash,
          localHashExists: localHash !== null,
          remoteHashExists: remoteHash !== null,
          remoteHashFetched: remoteHashFetched,
          lastSyncedAt: link.lastSyncedAt,
          lastSyncDirection: link.lastSyncDirection,
          lastSyncedRelative: formatRelativeTime(link.lastSyncedAt),
        },
        suggestedActions: suggestedActions,
      };

      if (conflict.affectedEntities && conflict.affectedEntities.length > 0) {
        output.sync.affectedEntities = conflict.affectedEntities;
      }

      this.log(JSON.stringify(output, null, 2));
    } else {
      // Human-readable output
      this.log("=== Project Status ===");
      this.log("");
      this.log("Linked to:");
      this.log(
        "  Workspace: " + link.workspaceSlug
      );
      this.log(
        "  Service:   " + link.serviceSlug
      );

      if (link.githubRepo) {
        this.log("");
        this.log("GitHub:");
        this.log("  Repository: " + link.githubRepo);
        if (link.githubBranch) {
          this.log("  Branch:     " + link.githubBranch);
        }
      }

      this.log("");
      this.log("=== Sync Status ===");
      this.log("");
      this.log("Status: " + syncStatus.icon + " " + syncStatus.status);
      this.log("  " + syncStatus.description);
      this.log("");

      if (localHash) {
        this.log("Local hash:  " + localHash);
      } else {
        this.log("Local hash:  (no local schema found)");
      }

      if (remoteHash) {
        this.log("Remote hash: " + remoteHash + (remoteHashFetched ? " (live)" : " (cached)"));
      } else {
        this.log("Remote hash: (unknown)");
      }

      this.log("");

      if (link.lastSyncedAt) {
        this.log("Last sync: " + formatRelativeTime(link.lastSyncedAt));
        if (link.lastSyncDirection) {
          this.log("  Direction: " + link.lastSyncDirection);
        }
      } else {
        this.log("Last sync: Never");
      }

      if (conflict.affectedEntities && conflict.affectedEntities.length > 0) {
        this.log("");
        this.log("Affected entities: " + conflict.affectedEntities.join(", "));
      }

      this.log("");
      this.log("=== Suggested Actions ===");
      for (const action of suggestedActions) {
        this.log("  • " + action);
      }
    }

    // Exit with code 1 if check flag is set and schemas are out of sync
    if (flags.check && conflict.type !== ConflictType.NO_CONFLICT) {
      this.exit(1);
    }
  }
}

