import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { credentials, projectLink } from "../../lib/config";
import { schemaApi } from "../../lib/api/services";
import { parseApsorc } from "../../lib/apsorc-parser";
import { apsorcToServiceSchema } from "../../lib/utils/schema-convert";

export default class SchemaValidate extends BaseCommand {
  static description = "Validate the local .apsorc schema";

  static examples = [
    `$ apso schema validate`,
    `$ apso schema validate --local`,
  ];

  static flags = {
    local: Flags.boolean({
      description: "Skip server validation even if linked",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaValidate);

    // Parse .apsorc
    let parsed;
    try {
      parsed = parseApsorc();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.error(`Failed to parse .apsorc: ${msg}`);
    }

    // Convert to platform schema format
    const schema = apsorcToServiceSchema(parsed);

    // Count stats
    const entityCount = schema.entities.length;
    let fieldCount = 0;
    let relationshipCount = 0;
    for (const entity of schema.entities) {
      fieldCount += entity.fields.length;
      relationshipCount += entity.relationships?.length || 0;
    }

    // Local validation
    const errors: string[] = [];
    for (const entity of schema.entities) {
      if (!entity.name || entity.name.trim() === "") {
        errors.push("Entity found with empty name");
      }
      if (entity.relationships) {
        for (const rel of entity.relationships) {
          const targetExists = schema.entities.some(
            (e) => e.name === rel.target
          );
          if (!targetExists) {
            errors.push(
              `Entity "${entity.name}": relationship target "${rel.target}" does not reference an existing entity`
            );
          }
        }
      }
    }

    // Server validation if linked and not --local
    const isLinked = projectLink.exists();
    const isAuthenticated = credentials.isValid();
    if (!flags.local && isLinked && isAuthenticated) {
      const link = projectLink.read()!;
      try {
        const result = await schemaApi.validate(
          link.workspaceSlug,
          link.serviceSlug,
          schema
        );
        if (!result.valid) {
          errors.push(...result.errors);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.warn(`Server validation failed: ${msg}`);
      }
    }

    // Print results
    this.log(`Schema: ${entityCount} entities, ${fieldCount} fields, ${relationshipCount} relationships`);

    if (errors.length > 0) {
      this.log("");
      this.log("Errors:");
      for (const err of errors) {
        this.log(`  - ${err}`);
      }
      this.error(`Validation failed with ${errors.length} error(s).`);
    } else {
      this.log("Validation passed.");
    }
  }
}
