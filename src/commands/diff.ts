import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { readProjectLink, getAuthoritativeApsorcPath, getRootApsorcPath } from "../lib/project-link";
import { createApiClient } from "../lib/api/client";
import { parseApsorc } from "../lib/apsorc-parser";
import { convertPlatformToLocal } from "../lib/schema-converter";
import { calculateSchemaHash } from "../lib/schema-hash";
import { detectConflict, ConflictType } from "../lib/conflict-detector";
import { LocalApsorcSchema } from "../lib/schema-converter/types";
import { Entity } from "../lib/types/entity";
import * as fs from "fs";

/**
 * Field type for comparison
 */
interface FieldType {
  name: string;
  type: string;
  nullable?: boolean;
}

/**
 * Format entity for display
 */
function formatEntity(entity: Entity): string {
  const fields = entity.fields || [];
  const fieldList = fields.map((f) => `    ${f.name}: ${f.type}${f.nullable ? "?" : ""}`).join("\n");
  return `${entity.name}:\n${fieldList}`;
}

/**
 * Compare two entities and return differences
 */
function compareEntities(
  localEntity: Entity,
  remoteEntity: Entity,
  useColor: boolean
): { hasChanges: boolean; diff: string[] } {
  const diff: string[] = [];
  let hasChanges = false;

  const green = useColor ? "\u001B[32m" : "";
  const red = useColor ? "\u001B[31m" : "";
  const yellow = useColor ? "\u001B[33m" : "";
  const reset = useColor ? "\u001B[0m" : "";

  // Compare fields
  const localFields = new Map<string, FieldType>(
    (localEntity.fields || []).map((f) => [f.name, { name: f.name, type: f.type, nullable: f.nullable }])
  );
  const remoteFields = new Map<string, FieldType>(
    (remoteEntity.fields || []).map((f) => [f.name, { name: f.name, type: f.type, nullable: f.nullable }])
  );

  // Find added fields
  for (const [fieldName, field] of localFields) {
    if (!remoteFields.has(fieldName)) {
      diff.push(`    ${green}+ ${fieldName}: ${field.type}${field.nullable ? "?" : ""}${reset}`);
      hasChanges = true;
    }
  }

  // Find removed fields
  for (const [fieldName, field] of remoteFields) {
    if (!localFields.has(fieldName)) {
      diff.push(`    ${red}- ${fieldName}: ${field.type}${field.nullable ? "?" : ""}${reset}`);
      hasChanges = true;
    }
  }

  // Find changed fields
  for (const [fieldName, localField] of localFields) {
    const remoteField = remoteFields.get(fieldName);
    if (remoteField) {
      const changes: string[] = [];
      if (localField.type !== remoteField.type) {
        changes.push(`type: ${remoteField.type} → ${localField.type}`);
      }
      if (localField.nullable !== remoteField.nullable) {
        changes.push(`nullable: ${remoteField.nullable} → ${localField.nullable}`);
      }
      if (changes.length > 0) {
        diff.push(`    ${yellow}~ ${fieldName}: ${changes.join(", ")}${reset}`);
        hasChanges = true;
      }
    }
  }

  return { hasChanges, diff };
}

/**
 * Generate detailed diff between local and remote schemas
 */
function generateDetailedDiff(
  localSchema: LocalApsorcSchema,
  remoteSchema: LocalApsorcSchema,
  useColor: boolean
): string[] {
  const output: string[] = [];
  const green = useColor ? "\u001B[32m" : "";
  const red = useColor ? "\u001B[31m" : "";
  const yellow = useColor ? "\u001B[33m" : "";
  const reset = useColor ? "\u001B[0m" : "";

  const localEntities = new Map(localSchema.entities.map((e) => [e.name, e]));
  const remoteEntities = new Map(remoteSchema.entities.map((e) => [e.name, e]));

  // Find added entities
  const addedEntities: string[] = [];
  for (const [entityName, entity] of localEntities) {
    if (!remoteEntities.has(entityName)) {
      addedEntities.push(entityName);
    }
  }

  // Find removed entities
  const removedEntities: string[] = [];
  for (const [entityName, entity] of remoteEntities) {
    if (!localEntities.has(entityName)) {
      removedEntities.push(entityName);
    }
  }

  // Find changed entities
  const changedEntities: Array<{ name: string; diff: string[] }> = [];
  for (const [entityName, localEntity] of localEntities) {
    const remoteEntity = remoteEntities.get(entityName);
    if (remoteEntity) {
      const { hasChanges, diff } = compareEntities(localEntity, remoteEntity, useColor);
      if (hasChanges) {
        changedEntities.push({ name: entityName, diff });
      }
    }
  }

  // Output added entities
  if (addedEntities.length > 0) {
    output.push("");
    output.push(`${green}Added Entities:${reset}`);
    for (const entityName of addedEntities) {
      const entity = localEntities.get(entityName)!;
      output.push(`  ${green}+ ${entityName}${reset}`);
      const fields = entity.fields || [];
      for (const field of fields) {
        output.push(`    ${green}+ ${field.name}: ${field.type}${field.nullable ? "?" : ""}${reset}`);
      }
    }
  }

  // Output removed entities
  if (removedEntities.length > 0) {
    output.push("");
    output.push(`${red}Removed Entities:${reset}`);
    for (const entityName of removedEntities) {
      const entity = remoteEntities.get(entityName)!;
      output.push(`  ${red}- ${entityName}${reset}`);
      const fields = entity.fields || [];
      for (const field of fields) {
        output.push(`    ${red}- ${field.name}: ${field.type}${field.nullable ? "?" : ""}${reset}`);
      }
    }
  }

  // Output changed entities
  if (changedEntities.length > 0) {
    output.push("");
    output.push(`${yellow}Changed Entities:${reset}`);
    for (const { name, diff } of changedEntities) {
      output.push(`  ${yellow}~ ${name}${reset}`);
      output.push(...diff);
    }
  }

  // Compare relationships
  const localRels = localSchema.relationships || [];
  const remoteRels = remoteSchema.relationships || [];

  const localRelSet = new Set(
    localRels.map((r) => `${r.from}→${r.to}:${r.type}`)
  );
  const remoteRelSet = new Set(
    remoteRels.map((r) => `${r.from}→${r.to}:${r.type}`)
  );

  const addedRels = localRels.filter(
    (r) => !remoteRelSet.has(`${r.from}→${r.to}:${r.type}`)
  );
  const removedRels = remoteRels.filter(
    (r) => !localRelSet.has(`${r.from}→${r.to}:${r.type}`)
  );

  if (addedRels.length > 0 || removedRels.length > 0) {
    output.push("");
    output.push(`${yellow}Relationships:${reset}`);
    for (const rel of addedRels) {
      output.push(`  ${green}+ ${rel.from} → ${rel.to} (${rel.type})${reset}`);
    }
    for (const rel of removedRels) {
      output.push(`  ${red}- ${rel.from} → ${rel.to} (${rel.type})${reset}`);
    }
  }

  return output;
}

export default class Diff extends BaseCommand {
  static description =
    "Show differences between local and remote schemas";

  static examples = [
    `$ apso diff                    # Compare local vs last-known remote`,
    `$ apso diff --live             # Compare local vs current live remote`,
    `$ apso diff --no-color         # Disable color output for CI/logs`,
  ];

  static flags = {
    live: Flags.boolean({
      char: "l",
      description: "Fetch current live remote schema instead of using cached hash",
      default: false,
    }),
    "no-color": Flags.boolean({
      description: "Disable colored output (useful for CI/logs)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Diff);

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
      `Comparing schemas for service: ${link.serviceSlug}`
    );
    this.log(`Workspace: ${link.workspaceSlug}`);
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
      const rawContent = fs.readFileSync(apsorcPath, "utf8");
      localSchema = JSON.parse(rawContent) as LocalApsorcSchema;
    } catch (error) {
      const err = error as Error;
      this.error(`Failed to read or parse local .apsorc: ${err.message}`);
    }

    const localHash = calculateSchemaHash(localSchema);

    // Fetch remote schema
    let remoteSchema: LocalApsorcSchema | undefined;
    let remoteHash: string | null = link.remoteSchemaHash || null;

    this.log(flags.live ? "Fetching current live remote schema..." : "Using cached remote schema hash...");

    if (flags.live || !remoteHash) {
      // Always fetch live if --live flag is set, or if we don't have a cached hash
      try {
        const api = createApiClient();
        const remotePlatformSchema = await api.getLatestSchema(link.serviceId);

        // Convert remote platform schema to local format
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
        this.error(
          `Failed to fetch remote schema: ${err.message}\n\n` +
            `Troubleshooting:\n` +
            `  - Check your authentication: run 'apso login'\n` +
            `  - Verify service: ${link.serviceSlug}\n` +
            `  - Run with DEBUG=1 for more details: $env:APSO_DEBUG='1'; apso diff`
        );
      }
    } else {
      // Use cached hash but we still need schema data for detailed diff
      // Try to fetch it anyway for detailed comparison
      try {
        const api = createApiClient();
        const remotePlatformSchema = await api.getLatestSchema(link.serviceId);
        const conversionResult = convertPlatformToLocal(remotePlatformSchema, {
          preserveUnsupported: true,
          warnUnsupported: false,
        });

        if (conversionResult.success) {
          remoteSchema = conversionResult.data;
        }
      } catch {
        // If we can't fetch, we can still show hash comparison
        this.warn("Could not fetch remote schema for detailed comparison. Showing hash comparison only.");
      }
    }

    // Detect conflict
    const conflict = detectConflict(
      localHash,
      remoteHash,
      localSchema,
      remoteSchema
    );

    const useColor = !flags["no-color"] && process.stdout.isTTY;

    // Show conflict summary
    this.log("=== Schema Comparison ===");
    this.log("");
    this.log(`Local hash:  ${localHash}`);
    this.log(`Remote hash: ${remoteHash || "(unknown)"}`);
    this.log("");
    this.log(`Status: ${conflict.type}`);
    this.log(`Severity: ${conflict.severity}`);
    this.log("");

    if (conflict.type === ConflictType.NO_CONFLICT) {
      this.log("✓ Local and remote schemas are in sync.");
      this.exit(0);
    }

    // Show detailed diff if we have both schemas
    if (localSchema && remoteSchema) {
      const diffLines = generateDetailedDiff(localSchema, remoteSchema, useColor);
      if (diffLines.length > 0) {
        this.log("=== Detailed Differences ===");
        // Print each line separately for proper formatting
        for (const line of diffLines) {
          this.log(line);
        }
      } else {
        this.log("No detailed differences found (schemas may differ in ordering or metadata).");
      }
    } else {
      this.log("Cannot show detailed diff: missing schema data.");
      this.log(`Conflict message: ${conflict.message}`);
    }

    this.log("");
    this.log("=== Recommended Actions ===");
    switch (conflict.type) {
    case ConflictType.DIVERGED: {
      this.log("  • Run 'apso sync' to merge changes interactively");
      this.log("  • Run 'apso pull' to update local with remote");
      this.log("  • Run 'apso push --force' to overwrite remote with local (with caution)");
    
    break;
    }
    case ConflictType.LOCAL_CHANGED: {
      this.log("  • Review local changes before pushing");
      this.log("  • Run 'apso push' to update remote with local changes");
    
    break;
    }
    case ConflictType.REMOTE_CHANGED: {
      this.log("  • Review remote changes before pulling");
      this.log("  • Run 'apso pull' to update local with remote changes");
    
    break;
    }
    // No default
    }

    // Exit with non-zero code since we have conflicts (NO_CONFLICT case already exited above)
    this.exit(1);
  }
}

