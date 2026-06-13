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
    const { rootFolder, entities, relationshipMap, apiType, auth, emitEvents, language: configLanguage } = parseApsorc();

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

    const generatorConfig: GeneratorConfig = {
      language,
      rootFolder,
      apiType: lowerCaseApiType,
      entities,
      relationshipMap,
      auth,
      emitEvents,
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

    // Generate shared query utilities
    const queryUtilFiles = await generator.generateQueryUtils(entities, lowerCaseApiType);
    for (const file of queryUtilFiles) {
      const fullPath = path.join(autogenPath, file.path);
      // eslint-disable-next-line no-await-in-loop
      await createFile(fullPath, file.content);
    }

    // Generate per-entity files
    for (const entity of entities) {
      console.log(`[apso] Building... ${entity.name}`);
      const entityBuildStart = performance.now();
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

      // eslint-disable-next-line no-await-in-loop
      for (const files of allFiles) {
        for (const file of files) {
          const fullPath = path.join(autogenPath, file.path);
          // eslint-disable-next-line no-await-in-loop
          await createFile(fullPath, file.content);
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
    const indexFiles = await generator.generateIndexModule(entities, lowerCaseApiType, { emitEvents });
    for (const file of indexFiles) {
      const fullPath = path.join(autogenPath, file.path);
      // eslint-disable-next-line no-await-in-loop
      await createFile(fullPath, file.content);
    }

    // Format generated files (TypeScript only)
    if (language === "typescript" && !skipFormat) {
      const formatStart = performance.now();
      console.log("[apso] Formatting files...");
      await this.runNpmCommand(
        ["run", "format", "src/autogen/**/*.ts", "src/guards/**/*.ts"],
        true
      );
      const formatTime = performance.now() - formatStart;
      console.log(`[apso] Finished formatting in ${formatTime.toFixed(2)} ms`);
    } else if (skipFormat) {
      console.log("[apso] Skipping formatting (--skip-format flag set)");
    }

    const totalBuildTime = performance.now() - totalBuildStart;
    console.log(
      `[apso] Finished building all entities in ${totalBuildTime.toFixed(2)} ms`
    );
  }
}
