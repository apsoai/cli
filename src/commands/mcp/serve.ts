import { Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
// eslint-disable-next-line node/no-missing-import -- eslint-plugin-node cannot resolve package "exports" subpaths
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// eslint-disable-next-line node/no-missing-import -- eslint-plugin-node cannot resolve package "exports" subpaths
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import BaseCommand from "../../lib/base-command";
import { parseApsorc, findConfigPath } from "../../lib/apsorc-parser";
import {
  createGenerator,
  isLanguageSupported,
  getImplementedLanguages,
} from "../../lib";
import { GeneratorConfig, TargetLanguage } from "../../lib/types";
import { DiagnosticContext } from "../../lib/doctor/types";
import {
  runDiagnostics,
  formatFindings,
  isGhAvailable,
  searchExistingIssues,
  fileIssue,
} from "../../lib/doctor/runner";
import { createFile } from "../../lib/utils/file-system";
import { apsorcToServiceSchema } from "../../lib/utils/schema-convert";
import { performance } from "perf_hooks";

export default class McpServe extends BaseCommand {
  static description =
    "Start an MCP server exposing Apso tools over stdio. Used by AI coding agents (Claude Code, Cursor, etc.) to design schemas, generate APIs, and deploy backends.";

  static examples = [
    `$ apso mcp serve`,
    `# In Claude Code settings:`,
    `# { "mcpServers": { "api-tools": { "command": "apso", "args": ["mcp", "serve"] } } }`,
  ];

  static flags = {
    help: Flags.help({ char: "h" }),
  };

  async run(): Promise<void> {
    await this.parse(McpServe);

    const server = new McpServer({
      name: "apso",
      version: "0.10.2",
    });

    this.registerTools(server);
    this.registerResources(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  private registerTools(server: McpServer): void {
    // ── design_schema ──────────────────────────────────────────────
    server.tool(
      "design_schema",
      "Design a database schema from application requirements. Takes a description of entities, relationships, and business rules. Returns a validated .apsorc schema definition ready for code generation.",
      {
        requirements: z
          .string()
          .describe(
            "Description of the application's data model: entities, fields, relationships, and business rules"
          ),
        language: z
          .enum(["typescript", "python", "go"])
          .optional()
          .describe("Target language for code generation (default: typescript)"),
        multi_tenant: z
          .boolean()
          .optional()
          .describe(
            "Whether to add organization-scoped multi-tenancy (default: true)"
          ),
        auth_provider: z
          .enum([
            "better-auth",
            "auth0",
            "clerk",
            "cognito",
            "api-key",
            "custom-db-session",
            "none",
          ])
          .optional()
          .describe("Authentication provider (default: none)"),
      },
      async ({ requirements, language, multi_tenant, auth_provider }) => {
        const lang = language || "typescript";
        const tenant = multi_tenant !== false;
        const auth = auth_provider && auth_provider !== "none" ? auth_provider : undefined;

        // Load the schema guide for the agent to reference
        const guideLocations = [
          path.join(__dirname, "../../references/apso-schema-guide.md"),
          path.join(process.cwd(), ".claude/skills/schema-architect/references/apso-schema-guide.md"),
        ];

        let guideContent = "";
        for (const loc of guideLocations) {
          if (fs.existsSync(loc)) {
            guideContent = fs.readFileSync(loc, "utf-8");
            break;
          }
        }

        const schemaTemplate: Record<string, unknown> = {
          version: 2,
          rootFolder: "src",
          language: lang,
          entities: [],
          relationships: [],
        };

        if (auth) {
          schemaTemplate.auth = { provider: auth };
        }

        const instructions = [
          "# Schema Design Request",
          "",
          "## Requirements",
          requirements,
          "",
          "## Configuration",
          `- Language: ${lang}`,
          `- Multi-tenancy: ${tenant ? "yes (use scopeBy: \"organizationId\" on business entities)" : "no"}`,
          `- Auth provider: ${auth || "none"}`,
          "",
          "## Schema Template",
          "Start from this template and populate entities, fields, and relationships:",
          "```json",
          JSON.stringify(schemaTemplate, null, 2),
          "```",
          "",
          "## Field Type Reference",
          "Valid types: text, integer, float, decimal, numeric, boolean, date, enum, json, json-plain, array",
          "",
          "## Rules",
          '- Entity names in PascalCase (e.g., "Project", "TaskComment")',
          '- Use "text" not "string". Use "date" not "timestamp".',
          "- Fields are required by default. Use `nullable: true` for optional fields.",
          "- Relationships go in the top-level `relationships` array, not inline on entities.",
          '- Relationship types: OneToMany, ManyToOne, ManyToMany, OneToOne.',
          '- Use `to_name` when an entity has multiple relationships to the same target.',
          "- Add composite indexes for common query patterns: `{ fields: [\"orgId\", \"status\"] }`.",
          "",
        ];

        if (guideContent) {
          instructions.push(
            "## Full Schema Reference",
            guideContent
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: instructions.join("\n"),
            },
          ],
        };
      }
    );

    // ── validate_schema ────────────────────────────────────────────
    server.tool(
      "validate_schema",
      "Check a schema definition for errors. Validates field types, relationships, indexes, and constraints. Operates on the .apsorc file in the current project directory.",
      {
        schema_json: z
          .string()
          .optional()
          .describe(
            "Optional: JSON string of a schema to validate. If not provided, reads .apsorc from the current directory."
          ),
      },
      async ({ schema_json }) => {
        try {
          if (schema_json) {
            // Validate the provided JSON
            const schema = JSON.parse(schema_json);
            const errors = validateSchemaObject(schema);
            if (errors.length > 0) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Validation failed with ${errors.length} error(s):\n${errors.map((e) => `  - ${e}`).join("\n")}`,
                  },
                ],
                isError: true,
              };
            }
            const entityCount = schema.entities?.length || 0;
            const fieldCount = (schema.entities || []).reduce(
              (sum: number, e: { fields?: unknown[] }) => sum + (e.fields?.length || 0),
              0
            );
            const relCount = schema.relationships?.length || 0;
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Validation passed. ${entityCount} entities, ${fieldCount} fields, ${relCount} relationships.`,
                },
              ],
            };
          }

          // Validate from .apsorc file
          const configPath = findConfigPath();
          if (!configPath) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No .apsorc file found in the current directory or parent directories.",
                },
              ],
              isError: true,
            };
          }

          const parsed = parseApsorc();
          const schema = apsorcToServiceSchema(parsed);

          const entityCount = schema.entities.length;
          let fieldCount = 0;
          let relationshipCount = 0;
          const errors: string[] = [];

          for (const entity of schema.entities) {
            fieldCount += entity.fields.length;
            relationshipCount += entity.relationships?.length || 0;
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

          if (errors.length > 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Schema: ${entityCount} entities, ${fieldCount} fields, ${relationshipCount} relationships\n\nValidation failed with ${errors.length} error(s):\n${errors.map((e) => `  - ${e}`).join("\n")}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Schema: ${entityCount} entities, ${fieldCount} fields, ${relationshipCount} relationships\nValidation passed.`,
              },
            ],
          };
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Validation error: ${msg}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ── scaffold_api ───────────────────────────────────────────────
    server.tool(
      "scaffold_api",
      "Generate a production-ready REST API from a schema. Creates endpoints, models, validation, DTOs, and OpenAPI docs. Requires an .apsorc file in the current directory.",
      {
        language: z
          .enum(["typescript", "python", "go"])
          .optional()
          .describe(
            "Target language for code generation (default: uses .apsorc config or typescript)"
          ),
        skip_format: z
          .boolean()
          .optional()
          .describe("Skip code formatting after generation (default: false)"),
      },
      async ({ language }) => {
        try {
          const configPath = findConfigPath();
          if (!configPath) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No .apsorc file found. Create a schema first using design_schema, or run `apso init` to create a project.",
                },
              ],
              isError: true,
            };
          }

          const {
            rootFolder,
            entities,
            relationshipMap,
            apiType,
            auth,
            language: configLanguage,
          } = parseApsorc();

          // Resolve language
          let lang: TargetLanguage;
          if (language) {
            lang = language as TargetLanguage;
          } else if (configLanguage && isLanguageSupported(configLanguage)) {
            lang = configLanguage;
          } else {
            lang = "typescript";
          }

          const implementedLanguages = getImplementedLanguages();
          if (!implementedLanguages.includes(lang)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Language '${lang}' is not yet implemented. Available: ${implementedLanguages.join(", ")}`,
                },
              ],
              isError: true,
            };
          }

          const rootPath = path.join(process.cwd(), rootFolder);
          const autogenPath = path.join(rootPath, "autogen");
          const lowerCaseApiType = apiType.toLowerCase();

          const generatorConfig: GeneratorConfig = {
            language: lang,
            rootFolder,
            apiType: lowerCaseApiType,
            entities,
            relationshipMap,
            auth,
          };

          const generator = createGenerator(generatorConfig);
          const validationResult = generator.validateConfig(generatorConfig);

          if (!validationResult.valid) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Configuration validation failed:\n${validationResult.errors.join("\n")}`,
                },
              ],
              isError: true,
            };
          }

          const totalStart = performance.now();
          const filesGenerated: string[] = [];

          // Generate enums
          const enumFiles = await generator.generateEnums(
            entities,
            lowerCaseApiType
          );
          for (const file of enumFiles) {
            const fullPath = path.join(autogenPath, file.path);
            // eslint-disable-next-line no-await-in-loop
            await createFile(fullPath, file.content);
            filesGenerated.push(file.path);
          }

          // Generate per-entity files
          for (const entity of entities) {
            const entityRelationships = relationshipMap[entity.name] || [];
            // eslint-disable-next-line no-await-in-loop
            const allFiles = await Promise.all([
              generator.generateEntity({
                entity,
                relationships: entityRelationships,
                allEntities: entities,
                apiType: lowerCaseApiType,
              }),
              generator.generateDto({
                entity,
                relationships: entityRelationships,
                allEntities: entities,
                apiType: lowerCaseApiType,
              }),
              generator.generateService({
                entity,
                relationships: entityRelationships,
                allEntities: entities,
                apiType: lowerCaseApiType,
                relationshipMap,
              }),
              generator.generateController({
                entity,
                relationships: entityRelationships,
                allEntities: entities,
                apiType: lowerCaseApiType,
                relationshipMap,
              }),
              generator.generateModule({
                entity,
                relationships: entityRelationships,
                allEntities: entities,
                apiType: lowerCaseApiType,
              }),
            ]);
            for (const files of allFiles) {
              for (const file of files) {
                const fullPath = path.join(autogenPath, file.path);
                // eslint-disable-next-line no-await-in-loop
                await createFile(fullPath, file.content);
                filesGenerated.push(file.path);
              }
            }
          }

          // Generate guards
          const guardFiles = await generator.generateGuards(entities, auth);
          for (const file of guardFiles) {
            const fullPath = path.join(autogenPath, file.path);
            // eslint-disable-next-line no-await-in-loop
            await createFile(fullPath, file.content);
            filesGenerated.push(file.path);
          }

          // Generate index module
          const indexFiles = await generator.generateIndexModule(
            entities,
            lowerCaseApiType
          );
          for (const file of indexFiles) {
            const fullPath = path.join(autogenPath, file.path);
            // eslint-disable-next-line no-await-in-loop
            await createFile(fullPath, file.content);
            filesGenerated.push(file.path);
          }

          const elapsed = (performance.now() - totalStart).toFixed(0);

          let warnings = "";
          if (validationResult.warnings.length > 0) {
            warnings = `\n\nWarnings:\n${validationResult.warnings.join("\n")}`;
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Generated ${lang} REST API for ${entities.length} entities (${filesGenerated.length} files) in ${elapsed}ms.\n\nOutput: ${autogenPath}\n\nEntities: ${entities.map((e) => e.name).join(", ")}${warnings}\n\nNext steps:\n1. Run \`npm install\` to install dependencies\n2. Run \`apso dev\` to start the local development server\n3. Open http://localhost:3001/api/docs for OpenAPI documentation`,
              },
            ],
          };
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Code generation failed: ${msg}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ── setup_auth ─────────────────────────────────────────────────
    server.tool(
      "setup_auth",
      "Add authentication and multi-tenancy to an API. Returns the auth entity definitions and configuration to add to your .apsorc schema. After updating the schema, run scaffold_api to regenerate the code.",
      {
        provider: z
          .enum([
            "better-auth",
            "auth0",
            "clerk",
            "cognito",
            "api-key",
            "custom-db-session",
          ])
          .optional()
          .describe("Authentication provider (default: better-auth)"),
      },
      async ({ provider }) => {
        const authProvider = provider || "better-auth";

        const authConfigs: Record<string, object> = {
          "better-auth": {
            auth: { provider: "better-auth" },
            entities: [
              {
                name: "User",
                created_at: true,
                updated_at: true,
                fields: [
                  { name: "email", type: "text", length: 255, is_email: true },
                  { name: "name", type: "text", length: 100, nullable: true },
                  { name: "avatar_url", type: "text", nullable: true },
                  { name: "email_verified", type: "boolean", default: "false" },
                ],
              },
              {
                name: "account",
                created_at: true,
                updated_at: true,
                fields: [
                  { name: "providerId", type: "text", length: 50 },
                  { name: "accountId", type: "text", length: 255 },
                  { name: "password", type: "text", nullable: true },
                ],
              },
              {
                name: "session",
                created_at: true,
                updated_at: true,
                fields: [
                  { name: "token", type: "text", length: 255, unique: true },
                  { name: "expiresAt", type: "date" },
                  { name: "ipAddress", type: "text", length: 45, nullable: true },
                  { name: "userAgent", type: "text", nullable: true },
                ],
              },
              {
                name: "verification",
                created_at: true,
                updated_at: true,
                fields: [
                  { name: "identifier", type: "text", length: 255 },
                  { name: "value", type: "text", length: 255 },
                  { name: "expiresAt", type: "date" },
                ],
              },
            ],
            relationships: [
              { from: "User", to: "account", type: "OneToMany" },
              { from: "account", to: "User", type: "ManyToOne" },
              { from: "User", to: "session", type: "OneToMany" },
              { from: "session", to: "User", type: "ManyToOne" },
            ],
          },
          "auth0": {
            auth: {
              provider: "auth0",
              jwt: {
                issuer: "https://YOUR_TENANT.auth0.com/",
                audience: "https://api.yourapp.com",
              },
              claims: {
                userId: "sub",
                email: "email",
                roles: "roles",
                organizationId: "org_id",
              },
            },
            entities: [],
            relationships: [],
          },
          clerk: {
            auth: {
              provider: "clerk",
              jwt: {
                issuer: "https://YOUR_CLERK_FRONTEND_API",
                audience: "",
              },
              claims: {
                userId: "sub",
                email: "email",
                roles: "roles",
                organizationId: "org_id",
              },
            },
            entities: [],
            relationships: [],
          },
          cognito: {
            auth: {
              provider: "cognito",
              jwt: {
                issuer: "https://cognito-idp.REGION.amazonaws.com/POOL_ID",
                audience: "YOUR_CLIENT_ID",
              },
              claims: {
                userId: "sub",
                email: "email",
                roles: "cognito:groups",
                organizationId: "custom:org_id",
              },
            },
            entities: [],
            relationships: [],
          },
          "api-key": {
            auth: {
              provider: "api-key",
              apiKeyHeader: "x-api-key",
              apiKeyEntity: "ApiKey",
            },
            entities: [
              {
                name: "ApiKey",
                created_at: true,
                updated_at: true,
                scopeBy: "organizationId",
                fields: [
                  { name: "name", type: "text", length: 100 },
                  { name: "keyHash", type: "text", length: 255 },
                  { name: "prefix", type: "text", length: 10 },
                  { name: "scopes", type: "json-plain", nullable: true },
                  { name: "expiresAt", type: "date", nullable: true },
                  { name: "lastUsedAt", type: "date", nullable: true },
                  { name: "status", type: "enum", values: ["active", "revoked"], default: "active" },
                ],
              },
            ],
            relationships: [
              { from: "Organization", to: "ApiKey", type: "OneToMany" },
              { from: "ApiKey", to: "Organization", type: "ManyToOne" },
            ],
          },
          "custom-db-session": {
            auth: { provider: "custom-db-session" },
            entities: [],
            relationships: [],
          },
        };

        const config = authConfigs[authProvider] || authConfigs["better-auth"];

        return {
          content: [
            {
              type: "text" as const,
              text: `# Auth Setup: ${authProvider}\n\nMerge the following into your .apsorc file:\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n\nAfter updating .apsorc:\n1. Run \`apso generate\` (or use the scaffold_api tool) to regenerate code\n2. Run \`npm install\` if new dependencies are needed\n3. Run \`apso dev\` to start the server and create auth tables\n\n${authProvider === "better-auth" ? "**Important:** BetterAuth stores passwords in the `account` table (not User). The `providerId` field must be set to \"credential\" for email/password login to work. Use `@apso/better-auth-adapter@latest` in your frontend." : "Configure the JWT issuer and audience values for your " + authProvider + " tenant."}`,
            },
          ],
        };
      }
    );

    // ── start_dev_server ───────────────────────────────────────────
    server.tool(
      "start_dev_server",
      "Start the local development environment. Launches PostgreSQL via Docker Compose and starts the API server with hot reload.",
      {
        detach: z
          .boolean()
          .optional()
          .describe("Run containers in the background (default: false)"),
        build: z
          .boolean()
          .optional()
          .describe("Rebuild images before starting (default: false)"),
      },
      async ({ detach, build }) => {
        if (!fs.existsSync(path.join(process.cwd(), "docker-compose.yml"))) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No docker-compose.yml found in the current directory. Make sure you are in an Apso project root. Run `apso init` to create a project first.",
              },
            ],
            isError: true,
          };
        }

        const args = ["dev"];
        if (build) args.push("--build");
        if (detach) args.push("--detach");

        return {
          content: [
            {
              type: "text" as const,
              text: `To start the dev server, run:\n\n\`\`\`bash\napso ${args.join(" ")}\n\`\`\`\n\nThis will:\n1. Start PostgreSQL via Docker Compose\n2. Create database tables from your schema\n3. Start the NestJS server with hot reload\n\nThe API will be available at:\n- API: http://localhost:3001\n- OpenAPI docs: http://localhost:3001/api/docs\n- Health check: http://localhost:3001/health\n\nAlternatively, run these commands individually:\n\`\`\`bash\nnpm run compose      # Start PostgreSQL\nnpm run provision    # Create tables\nnpm run start:dev    # Start API server\n\`\`\``,
            },
          ],
        };
      }
    );

    // ── deploy_api ─────────────────────────────────────────────────
    server.tool(
      "deploy_api",
      "Deploy the API to production. Handles build, database migration, and infrastructure provisioning on AWS.",
      {
        skip_migrate: z
          .boolean()
          .optional()
          .describe("Skip migration check (default: false)"),
        yes: z
          .boolean()
          .optional()
          .describe("Skip confirmation prompt (default: false)"),
      },
      async ({ skip_migrate, yes }) => {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No .apsorc file found. Create and generate a project first.",
              },
            ],
            isError: true,
          };
        }

        const args = ["deploy"];
        if (skip_migrate) args.push("--skip-migrate");
        if (yes) args.push("--yes");

        return {
          content: [
            {
              type: "text" as const,
              text: `To deploy, run:\n\n\`\`\`bash\napso ${args.join(" ")}\n\`\`\`\n\nPrerequisites:\n1. Authenticate: \`apso login\`\n2. Link project: \`apso link\`\n3. Test migrations locally: \`apso migrate\`\n\nThe deploy command will:\n1. Validate the schema\n2. Run migration sandbox\n3. Show SQL preview for pending migrations\n4. Build and deploy to AWS (Lambda + RDS + API Gateway)\n\nAfter deployment:\n- \`apso status\` — Check deployment status\n- \`apso logs\` — View build logs\n- \`apso open\` — Open service dashboard`,
            },
          ],
        };
      }
    );

    // ── diagnose ──────────────────────────────────────────────────
    server.tool(
      "diagnose",
      "Run diagnostic checks on the current project's generated code. Detects issues like missing PK generation strategies, unused imports, unrecognized field types, broken relationships, and migration failures.",
      {},
      async () => {
        try {
          const configPath = findConfigPath();
          if (!configPath) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No .apsorc file found in the current directory or parent directories.",
                },
              ],
              isError: true,
            };
          }

          const parsed = parseApsorc();
          const projectRoot = path.dirname(configPath);
          const language: TargetLanguage = parsed.language || "typescript";

          const ctx: DiagnosticContext = {
            entities: parsed.entities,
            relationshipMap: parsed.relationshipMap,
            rootFolder: parsed.rootFolder || "src",
            language,
            projectRoot,
          };

          const findings = await runDiagnostics(ctx);

          if (findings.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "All diagnostic checks passed. No issues found.",
                },
              ],
            };
          }

          const text = formatFindings(findings);
          const errors = findings.filter((f) => f.severity === "error").length;
          const warnings = findings.filter((f) => f.severity === "warning").length;

          return {
            content: [
              {
                type: "text" as const,
                text: `${text}\n${findings.length} finding(s): ${errors} error(s), ${warnings} warning(s)\n\nUse the report_issue tool to file a GitHub issue with these findings.`,
              },
            ],
            isError: errors > 0,
          };
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Diagnostic error: ${msg}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ── report_issue ──────────────────────────────────────────────
    server.tool(
      "report_issue",
      "File a GitHub issue against apsoai/cli with diagnostic findings or a custom description. Deduplicates against open issues. Requires the gh CLI to be installed and authenticated.",
      {
        title: z.string().describe("Issue title"),
        body: z.string().describe("Issue body (markdown)"),
        confirm: z
          .boolean()
          .default(false)
          .describe(
            "Set to true to actually create the issue. When false, returns a preview and any duplicate issues found."
          ),
      },
      async ({ title, body, confirm }) => {
        try {
          if (!isGhAvailable()) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "GitHub CLI (gh) is not installed or not authenticated.\nInstall: https://cli.github.com\nAuthenticate: gh auth login",
                },
              ],
              isError: true,
            };
          }

          // Check for duplicates
          const existing = searchExistingIssues(title);
          const dupeInfo =
            existing.length > 0
              ? `\n\nPotentially related open issues:\n${existing.map((i) => `  #${i.number}: ${i.title} (${i.url})`).join("\n")}`
              : "";

          if (!confirm) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Issue preview:\n\nTitle: ${title}\n\n${body}${dupeInfo}\n\nCall report_issue again with confirm: true to file this issue.`,
                },
              ],
            };
          }

          // File the issue. fileIssue passes the title as a discrete argv
          // element and the body via a temp file (execFile, shell: false), so
          // backticks / $() / quotes in user-supplied content are never
          // shell-evaluated (no command injection).
          const url = fileIssue(title, body);

          return {
            content: [
              {
                type: "text" as const,
                text: `Issue filed: ${url}${dupeInfo}`,
              },
            ],
          };
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to file issue: ${msg}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  private registerResources(server: McpServer): void {
    // ── Schema guide resource ──────────────────────────────────────
    server.resource(
      "schema-reference",
      "apso://schema-guide",
      {
        description:
          "Complete reference for .apsorc schema format: field types, entity definitions, relationship patterns, auth configuration, and working examples.",
        mimeType: "text/markdown",
      },
      async () => {
        // Try to find the schema guide
        const locations = [
          path.join(__dirname, "../../references/apso-schema-guide.md"),
          path.join(
            process.cwd(),
            ".claude/skills/schema-architect/references/apso-schema-guide.md"
          ),
        ];

        for (const loc of locations) {
          if (fs.existsSync(loc)) {
            const content = fs.readFileSync(loc, "utf-8");
            return {
              contents: [
                {
                  uri: "apso://schema-guide",
                  mimeType: "text/markdown" as const,
                  text: content,
                },
              ],
            };
          }
        }

        // Inline minimal reference
        return {
          contents: [
            {
              uri: "apso://schema-guide",
              mimeType: "text/markdown" as const,
              text: INLINE_SCHEMA_REFERENCE,
            },
          ],
        };
      }
    );

    // ── Current schema resource ────────────────────────────────────
    server.resource(
      "current-schema",
      "apso://current-schema",
      {
        description:
          "The .apsorc schema file from the current project directory.",
        mimeType: "application/json",
      },
      async () => {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            contents: [
              {
                uri: "apso://current-schema",
                mimeType: "text/plain" as const,
                text: "No .apsorc file found in the current directory or parent directories.",
              },
            ],
          };
        }

        const content = fs.readFileSync(configPath, "utf-8");
        return {
          contents: [
            {
              uri: "apso://current-schema",
              mimeType: "application/json" as const,
              text: content,
            },
          ],
        };
      }
    );
  }
}

// ── Validation helper ──────────────────────────────────────────────
function validateSchemaObject(schema: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!schema.version) {
    errors.push('Missing "version" field. Use version: 2.');
  } else if (schema.version !== 2) {
    errors.push(`Version ${schema.version} is not recommended. Use version: 2.`);
  }

  if (!schema.entities || !Array.isArray(schema.entities)) {
    errors.push('"entities" must be an array.');
    return errors;
  }

  const validFieldTypes = [
    "text", "string", "varchar", "integer", "float", "decimal", "numeric",
    "boolean", "date", "timestamptz", "timestamp", "datetime", "uuid", "enum",
    "json", "json-plain", "array",
  ];
  const validRelTypes = ["OneToMany", "ManyToOne", "ManyToMany", "OneToOne"];
  const entityNames = new Set<string>();

  for (const entity of schema.entities as Record<string, unknown>[]) {
    if (!entity.name || typeof entity.name !== "string") {
      errors.push("Entity found with missing or empty name.");
      continue;
    }
    if (entityNames.has(entity.name as string)) {
      errors.push(`Duplicate entity name: "${entity.name}".`);
    }
    entityNames.add(entity.name as string);

    if (entity.fields && Array.isArray(entity.fields)) {
      for (const field of entity.fields as Record<string, unknown>[]) {
        if (!field.name) {
          errors.push(`Entity "${entity.name}": field with missing name.`);
        }
        if (!field.type) {
          errors.push(`Entity "${entity.name}": field "${field.name}" has no type.`);
        } else if (!validFieldTypes.includes(field.type as string)) {
          errors.push(
            `Entity "${entity.name}": field "${field.name}" has invalid type "${field.type}". Valid: ${validFieldTypes.join(", ")}.`
          );
        }
        if (field.type === "enum" && (!field.values || !Array.isArray(field.values))) {
          errors.push(
            `Entity "${entity.name}": enum field "${field.name}" requires a "values" array.`
          );
        }
      }
    }
  }

  if (schema.relationships && Array.isArray(schema.relationships)) {
    for (const rel of schema.relationships as Record<string, unknown>[]) {
      if (!rel.from || !entityNames.has(rel.from as string)) {
        errors.push(
          `Relationship "from" entity "${rel.from}" does not exist.`
        );
      }
      if (!rel.to || !entityNames.has(rel.to as string)) {
        errors.push(
          `Relationship "to" entity "${rel.to}" does not exist.`
        );
      }
      if (!rel.type || !validRelTypes.includes(rel.type as string)) {
        errors.push(
          `Relationship ${rel.from} -> ${rel.to}: invalid type "${rel.type}". Valid: ${validRelTypes.join(", ")}.`
        );
      }
    }
  }

  return errors;
}

// ── Inline schema reference (fallback when guide file not found) ──
const INLINE_SCHEMA_REFERENCE = `# Schema Quick Reference

## Field Types
| Type | Description |
|------|-------------|
| text | String/varchar (use \`length\` for max) |
| integer | Integer number |
| float | Floating point |
| decimal | Fixed precision (\`precision\`, \`scale\`) |
| numeric | Alias for decimal |
| boolean | True/false |
| date | Date column |
| enum | Enumerated values (requires \`values\` array) |
| json | JSON (TypeORM simple-json) |
| json-plain | JSON (raw jsonb) |
| array | Array column |

## Entity Structure
\`\`\`json
{
  "name": "EntityName",
  "created_at": true,
  "updated_at": true,
  "primaryKeyType": "serial",
  "scopeBy": "organizationId",
  "emitEvents": true,
  "http": false,
  "fields": [
    { "name": "fieldName", "type": "text", "length": 100 }
  ],
  "indexes": [
    { "fields": ["field1", "field2"], "unique": false }
  ]
}
\`\`\`

## Domain Events (emitEvents)
Set \`emitEvents: true\` (per-entity or as a top-level default) to durably log
state changes. A top-level \`emitEvents: true\` enables it for every entity; an
individual entity can opt out with \`emitEvents: false\` (effective value is
\`entity.emitEvents ?? <top-level emitEvents> ?? false\`).

When at least one entity opts in, the generator emits a single schema-derived
manifest at \`autogen/events/event-emitting.entities.ts\` exporting
\`EVENT_EMITTING_ENTITIES\` (the opted-in entity classes) and
\`EVENT_EMITTING_ENTITY_NAMES\`. The domain-event engine itself ships in the
\`@apso/domain-events\` library and is wired by the \`domain-events\` skill; the
CLI no longer generates the engine code.

## HTTP controllers (http)
Controllers are generated by default. Set \`http: false\` on an entity (or a
top-level \`http: false\` default) to NOT generate/mount its HTTP controller while
still generating the entity, service, DTOs, and module (\`TypeOrmModule.forFeature\`
+ the service). Use this when a hand-written extension controller owns the route
for that entity (e.g. a custom/Stripe-shaped surface), avoiding a route collision
with the generated CRUD. Effective value is \`entity.http ?? <top-level http> ?? true\`.

## Relationship Types
- OneToMany: parent has many children
- ManyToOne: child belongs to parent
- ManyToMany: join table between entities
- OneToOne: one-to-one link

## Relationship Structure
\`\`\`json
{
  "from": "EntityA",
  "to": "EntityB",
  "type": "ManyToOne",
  "to_name": "customName",
  "nullable": false,
  "index": true
}
\`\`\`
`;
