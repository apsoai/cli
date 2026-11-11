import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { credentials, projectLink } from "../../lib/config";
import { schemaApi } from "../../lib/api/services";
import { formatLintReport, lintSchema } from "@apso/schema-tools";
import {
  ParsedApsorc,
  parseApsorc,
  readApsorcFile,
} from "../../lib/apsorc-parser";
import { createGenerator } from "../../lib/generators";
import { GeneratorConfig } from "../../lib/types";
import { apsorcToServiceSchema } from "../../lib/utils/schema-convert";

/**
 * What `apso generate` would stop on for auth, permissions and mcp. It runs
 * the generator's own checks and writes nothing, so the two cannot disagree.
 *
 * @param {ParsedApsorc} parsed - The parsed .apsorc.
 * @returns {Promise<string[]>} One message per problem; empty when there are none.
 */
export async function accessRuleErrors(
  parsed: Pick<
    ParsedApsorc,
    "rootFolder" | "apiType" | "entities" | "relationshipMap" | "auth" | "language"
  >
): Promise<string[]> {
  const { entities, relationshipMap, auth } = parsed;
  const config: GeneratorConfig = {
    language: parsed.language ?? "typescript",
    rootFolder: parsed.rootFolder,
    apiType: parsed.apiType.toLowerCase(),
    entities,
    relationshipMap,
    auth,
  };
  const generator = createGenerator(config);
  const errors: string[] = [];
  const attempt = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };
  // auth and permissions for every language; mcp for Python and Go.
  await attempt(() => generator.generateGuards(entities, auth, relationshipMap));
  // mcp in TypeScript is checked where the controller is generated.
  if (config.language === "typescript")
    for (const entity of entities)
      // eslint-disable-next-line no-await-in-loop -- one message per entity, in order
      await attempt(() =>
        generator.generateController({
          entity,
          relationships: relationshipMap[entity.name] || [],
          allEntities: entities,
          apiType: config.apiType,
          relationshipMap,
          auth,
        })
      );
  return [...new Set(errors)];
}

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

    // Lint first so every issue is listed, not just the first one parseApsorc throws on
    let file;
    try {
      file = readApsorcFile();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.error(`Failed to read .apsorc: ${msg}`);
    }
    if (file.apsorc.version === 2) {
      const lint = lintSchema(file.apsorc);
      if (lint.issues.length > 0) {
        this.log(formatLintReport(lint));
        this.log("");
      }
      if (lint.errorCount > 0) {
        this.error(
          `Validation failed with ${lint.errorCount} lint error(s). Run "apso schema lint --fix" to apply the safe fixes.`
        );
      }
    }

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

    // The rules apso generate enforces for auth, permissions and mcp
    errors.push(...(await accessRuleErrors(parsed)));

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
