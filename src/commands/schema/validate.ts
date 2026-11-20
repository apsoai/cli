import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { tenantClaimWarnings } from "../../lib/guards";
import { credentials, projectLink } from "../../lib/config";
import { schemaApi } from "../../lib/api/services";
import { formatLintReport, lintSchema } from "@apso/schema-tools";
import {
  ParsedApsorc,
  parseApsorc,
  readApsorcFile,
} from "../../lib/apsorc-parser";
import { createGenerator } from "../../lib/generators";
import { schemaModel } from "../../lib/ddl";
import { GeneratorConfig } from "../../lib/types";
import { apsorcToServiceSchema } from "../../lib/utils/schema-convert";

/**
 * What `apso generate` would stop on: its configuration checks and the auth,
 * permissions and mcp rules. It runs the generator's own checks
 * and writes nothing, so the two cannot disagree.
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
  // What generate checks before it writes anything (for example a GraphQL API type).
  const errors: string[] = [...generator.validateConfig(config).errors];
  const attempt = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };
  // auth and permissions for every language; mcp for Python and Go.
  await attempt(() => generator.generateGuards(entities, auth, relationshipMap));
  // Python and Go build the database with the DDL writer, which refuses a
  // field type it cannot write. apso generate fails on the same schema.
  if (config.language !== "typescript")
    await attempt(async () => schemaModel({ entities, relationshipMap }));
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

export interface LocalSchemaCheck {
  /** The lint report, empty when the linter found nothing. */
  lintReport: string;
  errors: string[];
  warnings: string[];
  /** Set once the file parsed; absent when lint errors stopped the check first. */
  parsed?: ParsedApsorc;
  stats?: { entities: number; fields: number; relationships: number };
}

/**
 * Every check `apso schema validate --local` runs on the project's .apsorc.
 * The CLI command and the MCP validate_schema tool both call this, so an
 * agent gets the same answer from either.
 *
 * @returns {Promise<LocalSchemaCheck>} The lint report, errors and warnings.
 */
export async function localSchemaCheck(): Promise<LocalSchemaCheck> {
  const result: LocalSchemaCheck = { lintReport: "", errors: [], warnings: [] };
  // Lint first so every issue is listed, not just the first one parseApsorc throws on
  const file = readApsorcFile();
  if (file.apsorc.version === 2) {
    const lint = lintSchema(file.apsorc);
    if (lint.issues.length > 0) result.lintReport = formatLintReport(lint);
    if (lint.errorCount > 0) {
      result.errors.push(
        `${lint.errorCount} lint error(s). Run "apso schema lint --fix" to apply the safe fixes.`
      );
      return result;
    }
  }

  const parsed = parseApsorc();
  result.parsed = parsed;
  result.warnings.push(...tenantClaimWarnings(parsed.entities, parsed.auth));

  const schema = apsorcToServiceSchema(parsed);
  let fields = 0;
  let relationships = 0;
  for (const entity of schema.entities) {
    fields += entity.fields.length;
    relationships += entity.relationships?.length || 0;
    if (!entity.name || entity.name.trim() === "") {
      result.errors.push("Entity found with empty name");
    }
    for (const rel of entity.relationships ?? []) {
      if (!schema.entities.some((e) => e.name === rel.target)) {
        result.errors.push(
          `Entity "${entity.name}": relationship target "${rel.target}" does not reference an existing entity`
        );
      }
    }
  }
  result.stats = { entities: schema.entities.length, fields, relationships };

  // The rules apso generate enforces for auth, permissions and mcp
  result.errors.push(...(await accessRuleErrors(parsed)));
  return result;
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

    let check: LocalSchemaCheck;
    try {
      check = await localSchemaCheck();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.error(`Failed to read or parse .apsorc: ${msg}`);
    }
    if (check.lintReport) {
      this.log(check.lintReport);
      this.log("");
    }
    if (!check.parsed) this.error(`Validation failed with ${check.errors[0]}`);
    for (const warning of check.warnings) this.warn(warning);

    const { errors, parsed } = check;
    const schema = apsorcToServiceSchema(parsed);
    const { entities: entityCount, fields: fieldCount, relationships: relationshipCount } = check.stats!;

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
