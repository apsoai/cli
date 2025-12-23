import { Flags } from "@oclif/core";
import * as path from "path";
import inquirer from "inquirer";
import {
  Entity,
  RelationshipMap,
  createEntity,
  createController,
  createModule,
  createService,
  createIndexAppModule,
  createDto,
  parseApsorc,
  createEnums,
  createGqlDTO,
  createGuards,
  createGenerator,
  isLanguageSupported,
  getImplementedLanguages,
} from "../../lib";
import { TargetLanguage, GeneratorConfig } from "../../lib/types";
import BaseCommand from "../../lib/base-command";
import { ApiType } from "../../lib/apsorc-parser";
import { performance } from "perf_hooks";
import * as Eta from "eta";
import { createFile } from "../../lib/utils/file-system";

Eta.configure({
  views: path.join(__dirname, "../../lib/templates"),
  cache: false,
});

export default class Scaffold extends BaseCommand {
  static description = "Setup new entities and interfaces for an Apso Server";
  static examples = [
    `$ apso server scaffold`,
    `$ apso server scaffold --skip-format`,
    `$ apso server scaffold --language typescript`,
    `$ apso server scaffold --language python`,
    `$ apso server scaffold --language go`,
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

  async scaffoldServer(options: {
    dir: string;
    entity: Entity;
    relationshipMap: RelationshipMap;
    apiType: string;
    allEntities: Entity[];
  }): Promise<void> {
    const { dir, entity, relationshipMap, apiType, allEntities } = options;
    const entityBuildStart = performance.now();
    this.log(`Building... ${entity.name}`);

    const entityName = entity.name;
    const filePath = path.join(dir, entityName);
    const entityRelationships = relationshipMap[entity.name] || [];
    await createEntity({
      apiBaseDir: filePath,
      entity,
      relationships: entityRelationships,
      apiType,
      allEntities,
    });
    switch (apiType) {
      case ApiType.Graphql:
        await this.setupGraphqlFiles(dir, entity, relationshipMap);
        break;
      case ApiType.Rest:
        await this.setupRestFiles(
          dir,
          entity,
          relationshipMap,
          apiType,
          allEntities
        );
        break;
      default:
        break;
    }
    await createModule(filePath, entity, { apiType });
    const entityBuildTime = performance.now() - entityBuildStart;
    console.log(
      `[apso] Finished building entity '${
        entity.name
      }' in ${entityBuildTime.toFixed(2)} ms`
    );
  }

  async setupRestFiles(
    dir: string,
    entity: Entity,
    relationshipMap: RelationshipMap,
    apiType: string,
    allEntities: Entity[]
  ) {
    const filePath = path.join(dir, entity.name);
    const entityRelationships = relationshipMap[entity.name] || [];

    const tDto = performance.now();
    await createDto(filePath, entity, entityRelationships, {
      apiType,
      allEntities,
    });
    if (process.env.DEBUG) {
      console.log(
        `[timing] createDto for ${entity.name}: ${(
          performance.now() - tDto
        ).toFixed(2)}ms`
      );
      const used = process.memoryUsage();
      console.log(
        `[mem] heapUsed after createDto for ${entity.name}: ${(
          used.heapUsed /
          1024 /
          1024
        ).toFixed(2)} MB`
      );
    }

    const tService = performance.now();
    await createService(filePath, entity, relationshipMap);
    if (process.env.DEBUG) {
      console.log(
        `[timing] createService for ${entity.name}: ${(
          performance.now() - tService
        ).toFixed(2)}ms`
      );
      const used = process.memoryUsage();
      console.log(
        `[mem] heapUsed after createService for ${entity.name}: ${(
          used.heapUsed /
          1024 /
          1024
        ).toFixed(2)} MB`
      );
    }

    const tController = performance.now();
    await createController(filePath, entity, relationshipMap);
    if (process.env.DEBUG) {
      console.log(
        `[timing] createController for ${entity.name}: ${(
          performance.now() - tController
        ).toFixed(2)}ms`
      );
    }
  }

  async setupGraphqlFiles(
    dir: string,
    entity: Entity,
    relationshipMap: RelationshipMap
  ) {
    const filePath = path.join(dir, entity.name);
    const entityRelationships = relationshipMap[entity.name] || [];
    await createGqlDTO(filePath, entity, entityRelationships);
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Scaffold);
    const skipFormat = flags["skip-format"];

    const totalBuildStart = performance.now();
    const { rootFolder, entities, relationshipMap, apiType, auth, language: configLanguage } = parseApsorc();

    // Resolve language: flag > .apsorc > prompt
    let language: TargetLanguage;
    if (flags.language) {
      language = flags.language as TargetLanguage;
    } else if (configLanguage && isLanguageSupported(configLanguage)) {
      language = configLanguage;
      console.log(`[apso] Using language from .apsorc: ${language}`);
    } else {
      // Prompt the user
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

    // Validate language support
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

    // For TypeScript, use the existing code path (for backward compatibility)
    // For other languages, use the new generator system
    await (language === "typescript" ? this.scaffoldTypeScript({
        autogenPath,
        rootPath,
        entities,
        relationshipMap,
        apiType: lowerCaseApiType,
        auth,
        skipFormat,
      }) : this.scaffoldWithGenerator({
        language,
        rootFolder,
        autogenPath,
        entities,
        relationshipMap,
        apiType: lowerCaseApiType,
        auth,
        skipFormat,
      }));

    const totalBuildTime = performance.now() - totalBuildStart;
    console.log(
      `[apso] Finished building all entities in ${totalBuildTime.toFixed(2)} ms`
    );
  }

  /**
   * Scaffolds TypeScript code using the existing code path (for backward compatibility)
   */
  private async scaffoldTypeScript(options: {
    autogenPath: string;
    rootPath: string;
    entities: Entity[];
    relationshipMap: RelationshipMap;
    apiType: string;
    auth?: any;
    skipFormat: boolean;
  }): Promise<void> {
    const { autogenPath, rootPath, entities, relationshipMap, apiType, auth, skipFormat } = options;

    await createEnums(autogenPath, entities, apiType);
    await Promise.all(
      entities.map(async (entity) => {
        const scaffoldModel = this.scaffoldServer.bind(this);
        await scaffoldModel({
          dir: autogenPath,
          entity,
          relationshipMap,
          apiType,
          allEntities: entities,
        });
        if (process.env.DEBUG) {
          const used = process.memoryUsage();
          console.log(
            `[mem] heapUsed after ${entity.name}: ${(
              used.heapUsed /
              1024 /
              1024
            ).toFixed(2)} MB`
          );
        }
      })
    );

    // Generate guards (auth and/or scope) based on .apsorc configuration
    await createGuards(rootPath, entities, auth);

    await createIndexAppModule(autogenPath, entities, apiType);

    if (skipFormat) {
      console.log("[apso] Skipping formatting (--skip-format flag set)");
    } else {
      const formatStart = performance.now();
      console.log("[apso] Formatting files...");
      await this.runNpmCommand(
        ["run", "format", "src/autogen/**/*.ts", "src/guards/**/*.ts"],
        true
      );
      const formatTime = performance.now() - formatStart;
      console.log(`[apso] Finished formatting in ${formatTime.toFixed(2)} ms`);
    }
  }

  /**
   * Scaffolds code using the new generator system (for Python, Go, and future languages)
   * Note: Sequential file operations are intentional to provide progress feedback
   */
  /* eslint-disable no-await-in-loop */
  private async scaffoldWithGenerator(options: {
    language: TargetLanguage;
    rootFolder: string;
    autogenPath: string;
    entities: Entity[];
    relationshipMap: RelationshipMap;
    apiType: string;
    auth?: any;
    skipFormat: boolean;
  }): Promise<void> {
    const { language, rootFolder, autogenPath, entities, relationshipMap, apiType, auth } = options;

    // Create generator configuration
    const generatorConfig: GeneratorConfig = {
      language,
      rootFolder,
      apiType,
      entities,
      relationshipMap,
      auth,
    };

    // Create the appropriate generator
    const generator = createGenerator(generatorConfig);

    // Validate configuration
    const validationResult = generator.validateConfig(generatorConfig);
    if (!validationResult.valid) {
      this.error(`Configuration validation failed:\n${validationResult.errors.join("\n")}`);
    }
    if (validationResult.warnings.length > 0) {
      console.log(`[apso] Warnings:\n${validationResult.warnings.join("\n")}`);
    }

    // Generate enums
    const enumFiles = await generator.generateEnums(entities, apiType);
    for (const file of enumFiles) {
      const fullPath = path.join(autogenPath, file.path);
      await createFile(fullPath, file.content);
      console.log(`[apso] Generated ${fullPath}`);
    }

    // Generate files for each entity
    for (const entity of entities) {
      console.log(`[apso] Building... ${entity.name}`);
      const entityBuildStart = performance.now();
      const entityRelationships = relationshipMap[entity.name] || [];

      // Generate entity files
      const entityFiles = await generator.generateEntity({
        entity,
        relationships: entityRelationships,
        allEntities: entities,
        apiType,
      });
      for (const file of entityFiles) {
        const fullPath = path.join(autogenPath, file.path);
        await createFile(fullPath, file.content);
      }

      // Generate DTO files
      const dtoFiles = await generator.generateDto({
        entity,
        relationships: entityRelationships,
        allEntities: entities,
        apiType,
      });
      for (const file of dtoFiles) {
        const fullPath = path.join(autogenPath, file.path);
        await createFile(fullPath, file.content);
      }

      // Generate service files
      const serviceFiles = await generator.generateService({
        entity,
        relationships: entityRelationships,
        allEntities: entities,
        apiType,
        relationshipMap,
      });
      for (const file of serviceFiles) {
        const fullPath = path.join(autogenPath, file.path);
        await createFile(fullPath, file.content);
      }

      // Generate controller files
      const controllerFiles = await generator.generateController({
        entity,
        relationships: entityRelationships,
        allEntities: entities,
        apiType,
        relationshipMap,
      });
      for (const file of controllerFiles) {
        const fullPath = path.join(autogenPath, file.path);
        await createFile(fullPath, file.content);
      }

      // Generate module files
      const moduleFiles = await generator.generateModule({
        entity,
        relationships: entityRelationships,
        allEntities: entities,
        apiType,
      });
      for (const file of moduleFiles) {
        const fullPath = path.join(autogenPath, file.path);
        await createFile(fullPath, file.content);
      }

      const entityBuildTime = performance.now() - entityBuildStart;
      console.log(
        `[apso] Finished building entity '${entity.name}' in ${entityBuildTime.toFixed(2)} ms`
      );
    }

    // Generate guards
    const guardFiles = await generator.generateGuards(entities, auth);
    const rootPath = path.dirname(autogenPath);
    for (const file of guardFiles) {
      const fullPath = path.join(rootPath, "autogen", file.path);
      await createFile(fullPath, file.content);
      console.log(`[apso] Generated ${fullPath}`);
    }

    // Generate index module
    const indexFiles = await generator.generateIndexModule(entities, apiType);
    for (const file of indexFiles) {
      const fullPath = path.join(autogenPath, file.path);
      await createFile(fullPath, file.content);
      console.log(`[apso] Generated ${fullPath}`);
    }
  }
  /* eslint-enable no-await-in-loop */
}
