import { LocalApsorcSchema } from "../schema-converter/types";
import {
  calculateSchemaHash,
  isHashDiverged,
  hashesMatch,
} from "../schema-hash";

/**
 * Types of conflicts that can occur
 */
export enum ConflictType {
  NO_CONFLICT = "NO_CONFLICT",
  LOCAL_CHANGED = "LOCAL_CHANGED",
  REMOTE_CHANGED = "REMOTE_CHANGED",
  DIVERGED = "DIVERGED",
}

/**
 * Information about a detected conflict
 */
export interface ConflictInfo {
  type: ConflictType;
  localHash: string | null;
  remoteHash: string | null;
  message: string;
  severity: "none" | "low" | "medium" | "high";
  affectedEntities?: string[];
}

/**
 * Detect conflicts between local and remote schemas
 */
export function detectConflict(
  localHash: string | null,
  remoteHash: string | null,
  localSchema?: LocalApsorcSchema,
  remoteSchema?: LocalApsorcSchema
): ConflictInfo {
  // If no hashes exist, we can't determine conflict status
  if (!localHash && !remoteHash) {
    return {
      type: ConflictType.NO_CONFLICT,
      localHash: null,
      remoteHash: null,
      message: "No previous sync information available. This appears to be a fresh sync.",
      severity: "none",
    };
  }

  // If only one hash exists, we have a partial sync
  if (!localHash && remoteHash) {
    return {
      type: ConflictType.REMOTE_CHANGED,
      localHash: null,
      remoteHash,
      message:
        "Local schema hash is missing. Remote schema exists. This may indicate the local schema was modified outside of sync.",
      severity: "medium",
    };
  }

  if (localHash && !remoteHash) {
    return {
      type: ConflictType.LOCAL_CHANGED,
      localHash,
      remoteHash: null,
      message:
        "Remote schema hash is missing. Local schema exists. This may indicate the remote schema was reset or recreated.",
      severity: "medium",
    };
  }

  // Both hashes exist - check if they match
  if (hashesMatch(localHash, remoteHash)) {
    return {
      type: ConflictType.NO_CONFLICT,
      localHash: localHash!,
      remoteHash: remoteHash!,
      message: "Local and remote schemas are in sync.",
      severity: "none",
    };
  }

  // Hashes don't match - determine conflict type
  // If we have schema data, we can analyze what changed
  if (localSchema && remoteSchema) {
    return analyzeDivergence(localHash!, remoteHash!, localSchema, remoteSchema);
  }

  // Without schema data, we can only report divergence
  return {
    type: ConflictType.DIVERGED,
    localHash: localHash!,
    remoteHash: remoteHash!,
    message:
      "Local and remote schemas have diverged. Both have been modified since the last sync.",
    severity: "high",
  };
}

/**
 * Analyze divergence between two schemas to provide detailed conflict information
 */
function analyzeDivergence(
  localHash: string,
  remoteHash: string,
  localSchema: LocalApsorcSchema,
  remoteSchema: LocalApsorcSchema
): ConflictInfo {
  const localEntityNames = new Set(localSchema.entities.map((e) => e.name));
  const remoteEntityNames = new Set(remoteSchema.entities.map((e) => e.name));

  // Find entities that exist in one but not the other
  const onlyInLocal = Array.from(localEntityNames).filter(
    (name) => !remoteEntityNames.has(name)
  );
  const onlyInRemote = Array.from(remoteEntityNames).filter(
    (name) => !localEntityNames.has(name)
  );

  // Find entities that exist in both but may have differences
  const commonEntities = Array.from(localEntityNames).filter((name) =>
    remoteEntityNames.has(name)
  );

  const affectedEntities: string[] = [
    ...onlyInLocal,
    ...onlyInRemote,
    ...commonEntities,
  ];

  // Determine severity based on changes
  let severity: "low" | "medium" | "high" = "low";
  if (onlyInLocal.length > 0 || onlyInRemote.length > 0) {
    severity = "high"; // Structural changes (entities added/removed)
  } else if (commonEntities.length > 0) {
    severity = "medium"; // Field-level changes
  }

  // Build detailed message
  const changes: string[] = [];
  if (onlyInLocal.length > 0) {
    changes.push(
      `Local has ${onlyInLocal.length} additional entity/entities: ${onlyInLocal.join(", ")}`
    );
  }
  if (onlyInRemote.length > 0) {
    changes.push(
      `Remote has ${onlyInRemote.length} additional entity/entities: ${onlyInRemote.join(", ")}`
    );
  }
  if (commonEntities.length > 0 && onlyInLocal.length === 0 && onlyInRemote.length === 0) {
    changes.push(
      `${commonEntities.length} common entity/entities have field-level differences`
    );
  }

  const message =
    changes.length > 0
      ? `Schemas have diverged: ${changes.join("; ")}.`
      : "Local and remote schemas have diverged. Both have been modified since the last sync.";

  return {
    type: ConflictType.DIVERGED,
    localHash,
    remoteHash,
    message,
    severity,
    affectedEntities: affectedEntities.length > 0 ? affectedEntities : undefined,
  };
}

/**
 * Get a user-friendly conflict summary message
 */
export function getConflictSummary(conflict: ConflictInfo): string {
  const parts: string[] = [];

  parts.push(`Conflict Type: ${conflict.type}`);
  parts.push(`Severity: ${conflict.severity}`);
  parts.push("");
  parts.push(conflict.message);

  if (conflict.affectedEntities && conflict.affectedEntities.length > 0) {
    parts.push("");
    parts.push(`Affected entities: ${conflict.affectedEntities.join(", ")}`);
  }

  parts.push("");
  parts.push("Recommended actions:");
  if (conflict.type === ConflictType.DIVERGED) {
    parts.push("  • Run 'apso diff' to see detailed differences");
    parts.push("  • Run 'apso sync' to merge changes interactively");
    parts.push("  • Use '--force' flag to overwrite (with caution)");
  } else if (conflict.type === ConflictType.LOCAL_CHANGED) {
    parts.push("  • Review local changes before pushing");
    parts.push("  • Use 'apso push --force' to push local changes");
  } else if (conflict.type === ConflictType.REMOTE_CHANGED) {
    parts.push("  • Review remote changes before pulling");
    parts.push("  • Use 'apso pull --force' to overwrite local with remote");
  }

  return parts.join("\n");
}

