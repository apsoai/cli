import { Flags } from "@oclif/core";
import * as path from "path";
import inquirer from "inquirer";
import {
  parseApsorc,
  createGenerator,
  isLanguageSupported,
  getImplementedLanguages,
} from "../lib";
import { TargetLanguage, GeneratorConfig } from "../lib/types";
import BaseCommand from "../lib/base-command";
import { performance } from "perf_hooks";
import { createFile } from "../lib/utils/file-system";
import { installCoAuthorHook } from "../lib/utils/git-hooks";

export default class Generate extends BaseCommand {
  static description = "Generate code from .apsorc schema";
  static examples = [
    `$ apso generate`,
    `$ apso generate --skip-format`,
    `$ apso generate --language typescript`,
    `$ apso generate --language python`,
    `$ apso generate --language go`,
  ];

  static flags = {
    help: Flags.help({ char: "h" }),
    "skip-format": Flags.boolean({
      description: "Skip the formatting step (useful when prettier is not available)",
      default: false,
    }),
    language: Flags.string({
      char: "l",
      description: "Target language for code generation (typescript, python, go). If not specified, uses .apsorc config or prompts.",
      options: ["typescript", "python", "go"],
    }),
  };

  static args = {};

  async run(): Promise<void> {
    const { flags } = await this.parse(Generate);
    const skipFormat = flags["skip-format"];

    const totalBuildStart = performance.now();
    const { rootFolder, entities, relationshipMap, apiType, auth, emitEvents, http, coAuthor, language: configLanguage } = parseApsorc();

    // Resolve language: flag > .apsorc > prompt
    let language: TargetLanguage;
    if (flags.language) {
      language = flags.language as TargetLanguage;
    } else if (configLanguage && isLanguageSupported(configLanguage)) {
      language = configLanguage;
      console.log(`[apso] Using language from .apsorc: ${language}`);
    } else {
      const implementedLanguages = getImplementedLanguages();
      const { selectedLanguage } = await inquirer.prompt<{ selectedLanguage: TargetLanguage }>([
        {
          type: "list",
          name: "selectedLanguage",
          message: "Select target language for code generation:",
          choices: implementedLanguages.map((lang) => ({
            name: lang === "typescript" ? "TypeScript (NestJS + TypeORM)" :
                  lang === "python" ? "Python (FastAPI + SQLAlchemy)" :
                  "Go (Gin + GORM)",
            value: lang,
          })),
          default: "typescript",
        },
      ]);
      language = selectedLanguage;
    }

    if (!isLanguageSupported(language)) {
      this.error(`Unsupported language: ${language}. Supported: typescript, python, go`);
    }

    const implementedLanguages = getImplementedLanguages();
    if (!implementedLanguages.includes(language)) {
      this.error(
        `Language '${language}' is not yet implemented. Currently available: ${implementedLanguages.join(", ")}`
      );
    }

    const rootPath = path.join(process.cwd(), rootFolder);
    const autogenPath = path.join(rootPath, "autogen");
    const lowerCaseApiType = apiType.toLowerCase();

    console.log(`[apso] Generating ${language} code for ${entities.length} entities...`);

    if (entities.length === 0) {
      console.log(
        "[apso] No entities found in .apsorc — nothing to generate. Check that the file exists and defines an `entities` array."
      );
    }

    let generatedFileCount = 0;

    const generatorConfig: GeneratorConfig = {
      language,
      rootFolder,
      apiType: lowerCaseApiType,
      entities,
      relationshipMap,
      auth,
      emitEvents,
      http,
    };

    const generator = createGenerator(generatorConfig);

    const validationResult = generator.validateConfig(generatorConfig);
    if (!validationResult.valid) {
      this.error(`Configuration validation failed:\n${validationResult.errors.join("\n")}`);
    }
    if (validationResult.warnings.length > 0) {
      console.log(`[apso] Warnings:\n${validationResult.warnings.join("\n")}`);
    }

    // Generate enums
    const enumFiles = await generator.generateEnums(entities, lowerCaseApiType);
    for (const file of enumFiles) {
      const fullPath = path.join(autogenPath, file.path);
      // eslint-disable-next-line no-await-in-loop
      await createFile(fullPath, file.content);
    }
    generatedFileCount += enumFiles.length;

    // Generate shared query utilities
    const queryUtilFiles = await generator.generateQueryUtils(entities, lowerCaseApiType);
    for (const file of queryUtilFiles) {
      const fullPath = path.join(autogenPath, file.path);
      // eslint-disable-next-line no-await-in-loop
      await createFile(fullPath, file.content);
    }
    generatedFileCount += queryUtilFiles.length;

    // Generate per-entity files
    for (const entity of entities) {
      console.log(`[apso] Building... ${entity.name}`);
      const entityBuildStart = performance.now();
      const entityRelationships = relationshipMap[entity.name] || [];

      // Effective HTTP flag: entity overrides the top-level default, which
      // defaults to true. GraphQL uses resolvers, so the flag doesn't apply
      // there. The flag only does real suppression where a generated route
      // can't be cleanly overridden without removing it (see apsoai/cli#95):
      //   - TypeScript (NestJS): suppress the controller + its module wiring.
      //   - Go (Gin): suppress the handler + its route registration (Gin
      //     panics on a duplicate method+path, so overriding needs removal).
      //   - Python (FastAPI): NO-OP. FastAPI matches in registration order, so
      //     a hand-written APIRouter included before autogen_router in main.py
      //     shadows the generated route without removing it. We only emit an
      //     informational notice pointing at that pattern.
      const effectiveHttp = entity.http ?? http ?? true;
      const httpSuppressible =
        (language === "typescript" || language === "go") &&
        lowerCaseApiType === "rest";
      const includeController = httpSuppressible ? effectiveHttp : true;
      if (httpSuppressible && !includeController) {
        const artifact = language === "go" ? "handler + routes" : "controller";
        console.log(
          `[apso]   ${entity.name}: http=false — skipping generated ${artifact}`
        );
      } else if (
        language === "python" &&
        lowerCaseApiType === "rest" &&
        effectiveHttp === false
      ) {
        console.log(
          `[apso]   ${entity.name}: http=false is a no-op for FastAPI — to replace a ` +
            `generated route, include your own APIRouter before autogen_router in main.py ` +
            `(first match wins). See the custom-endpoints skill.`
        );
      }

      const generationTasks = [
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
        generator.generateModule({
          entity,
          relationships: entityRelationships,
          allEntities: entities,
          apiType: lowerCaseApiType,
          includeController,
        }),
      ];
      if (includeController) {
        generationTasks.push(
          generator.generateController({
            entity,
            relationships: entityRelationships,
            allEntities: entities,
            apiType: lowerCaseApiType,
            relationshipMap,
          })
        );
      }

      // eslint-disable-next-line no-await-in-loop
      const allFiles = await Promise.all(generationTasks);

      // eslint-disable-next-line no-await-in-loop
      for (const files of allFiles) {
        for (const file of files) {
          const fullPath = path.join(autogenPath, file.path);
          // eslint-disable-next-line no-await-in-loop
          await createFile(fullPath, file.content);
          generatedFileCount += 1;
        }
      }

      const entityBuildTime = performance.now() - entityBuildStart;
      console.log(
        `[apso] Finished building entity '${entity.name}' in ${entityBuildTime.toFixed(2)} ms`
      );
    }

    // Generate guards
    const guardFiles = await generator.generateGuards(entities, auth);
    for (const file of guardFiles) {
      const fullPath = path.join(autogenPath, file.path);
      // eslint-disable-next-line no-await-in-loop
      await createFile(fullPath, file.content);
    }
    generatedFileCount += guardFiles.length;

    // Generate domain-event spine (only when at least one entity opts in)
    const domainEventFiles = await generator.generateDomainEvents(
      entities,
      lowerCaseApiType,
      { emitEvents }
    );
    for (const file of domainEventFiles) {
      const fullPath = path.join(autogenPath, file.path);
      // eslint-disable-next-line no-await-in-loop
      await createFile(fullPath, file.content);
    }

    // Generate index module
    const indexFiles = await generator.generateIndexModule(entities, lowerCaseApiType, { emitEvents, http });
    for (const file of indexFiles) {
      const fullPath = path.join(autogenPath, file.path);
      // eslint-disable-next-line no-await-in-loop
      await createFile(fullPath, file.content);
    }
    generatedFileCount += indexFiles.length;

    // Format generated files (TypeScript only) with Biome — bundled with the
    // CLI and invoked directly, so it's a fast native pass (~ms) with no npx
    // download and no dependence on the project having a formatter installed.
    // Scoped to the autogen directory so we never touch hand-written code
    // elsewhere in the project tree.
    if (language === "typescript" && !skipFormat && generatedFileCount > 0) {
      const formatStart = performance.now();
      console.log("[apso] Formatting generated files...");
      try {
        const biomeBin = require.resolve("@biomejs/biome/bin/biome");
        // Use the CLI's bundled Biome config: 2-space style (Biome defaults to
        // tabs) and, critically, unsafeParameterDecoratorsEnabled so Biome can
        // parse NestJS parameter decorators (@Body(), @ParsedRequest(), ...);
        // without it Biome aborts with parse errors on the generated controllers.
        const biomeConfigDir = path.join(__dirname, "..", "lib", "biome");
        await this.runCommand(
          "node",
          [
            biomeBin,
            "format",
            "--write",
            `--config-path=${biomeConfigDir}`,
            autogenPath,
          ],
          true
        );
        const formatTime = performance.now() - formatStart;
        console.log(`[apso] Finished formatting in ${formatTime.toFixed(2)} ms`);
      } catch (error: unknown) {
        // Formatting is best-effort — never fail generation over it.
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[apso] Skipped formatting (${msg})`);
      }
    } else if (skipFormat) {
      console.log("[apso] Skipping formatting (--skip-format flag set)");
    } else if (generatedFileCount === 0) {
      console.log("[apso] Skipping formatting (no files were generated)");
    }

    const totalBuildTime = performance.now() - totalBuildStart;
    console.log(
      `[apso] Finished building all entities in ${totalBuildTime.toFixed(2)} ms`
    );

    // Best-effort: install the commit co-author hook so commits that include
    // Apso-generated files credit Apso as a co-author. Never fails the command.
    try {
      const result = installCoAuthorHook(process.cwd(), {
        disabled: coAuthor === false,
      });
      if (result.installed) {
        console.log("[apso] Commit co-author hook installed (.apso/hooks)");
      } else if (result.reason === "custom-hookspath") {
        console.log(
          "[apso] A custom git core.hooksPath is already configured (e.g. husky), so the Apso co-author hook was not installed.\n" +
            "[apso] To credit Apso on commits that include generated files, add this trailer to your existing prepare-commit-msg hook when the staged diff touches an `autogen/` path:\n" +
            '[apso]   git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Co-authored-by: Apso <bot@apso.ai>" "$1"'
        );
      }
    } catch {
      // Never let hook installation fail the generate command.
    }
  }
}
