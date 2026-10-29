import { Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import inquirer from "inquirer";
import {
  parseApsorc,
  createGenerator,
  isLanguageSupported,
  getImplementedLanguages,
} from "../lib";
import { TargetLanguage, GeneratorConfig, isJwtAuth } from "../lib/types";
import BaseCommand from "../lib/base-command";
import { isInteractive, missingFlag } from "../lib/utils/interactive";
import { performance } from "perf_hooks";
import { createFile, removeStaleGeneratedFiles } from "../lib/utils/file-system";
import { installCoAuthorHook } from "../lib/utils/git-hooks";
import {
  JOSE_DEP,
  PYJWT_DEP,
  addMissingDeps,
  addMissingPythonDep,
  ensureCrudDeps,
} from "../lib/utils/crud-deps";
import { upgradeOrmConfigForPglite } from "../lib/utils/pglite-upgrade";

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
      // Headless (CI / no TTY / APSO_NONINTERACTIVE): never block on a prompt.
      // Fail fast and name the flag so the caller can retry deterministically.
      if (!isInteractive()) {
        this.error(
          missingFlag(
            'Pass --language <typescript|python|go> or set "language" in .apsorc.'
          )
        );
      }
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

    // Every path this run writes. After generation, anything else under
    // autogen/ that carries the Apso header belongs to an entity that was
    // removed or renamed in .apsorc and gets deleted (apsoai/cli#157).
    const generatedPaths = new Set<string>();
    const writeGenerated = (filePath: string, content: string) => {
      const fullPath = path.join(autogenPath, filePath);
      generatedPaths.add(fullPath);
      return createFile(fullPath, content);
    };

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
      // eslint-disable-next-line no-await-in-loop
      await writeGenerated(file.path, file.content);
    }
    generatedFileCount += enumFiles.length;

    // Generate shared query utilities
    const queryUtilFiles = await generator.generateQueryUtils(entities, lowerCaseApiType);
    for (const file of queryUtilFiles) {
      // eslint-disable-next-line no-await-in-loop
      await writeGenerated(file.path, file.content);
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
            auth,
          })
        );
      }

      // eslint-disable-next-line no-await-in-loop
      const allFiles = await Promise.all(generationTasks);

      // eslint-disable-next-line no-await-in-loop
      for (const files of allFiles) {
        for (const file of files) {
          // eslint-disable-next-line no-await-in-loop
          await writeGenerated(file.path, file.content);
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
      // eslint-disable-next-line no-await-in-loop
      await writeGenerated(file.path, file.content);
    }
    generatedFileCount += guardFiles.length;

    // Generate domain-event spine (only when at least one entity opts in)
    const domainEventFiles = await generator.generateDomainEvents(
      entities,
      lowerCaseApiType,
      { emitEvents }
    );
    for (const file of domainEventFiles) {
      // eslint-disable-next-line no-await-in-loop
      await writeGenerated(file.path, file.content);
    }

    // Generate index module
    const indexFiles = await generator.generateIndexModule(entities, lowerCaseApiType, { emitEvents, http, auth });
    for (const file of indexFiles) {
      // eslint-disable-next-line no-await-in-loop
      await writeGenerated(file.path, file.content);
    }
    generatedFileCount += indexFiles.length;

    // Skip cleanup when nothing was generated: an empty or missing .apsorc
    // would otherwise wipe every generated file.
    if (entities.length > 0) {
      for (const removed of removeStaleGeneratedFiles(autogenPath, generatedPaths)) {
        console.log(`[apso] Removed stale ${path.relative(process.cwd(), removed)}`);
      }
    }

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

    // Generated TS code imports @apso/crud*. Projects from the v1 template
    // (@nestjsx/crud) don't declare those, and every entity then fails to
    // compile with TS2307. Declare them so the next install picks them up.
    if (language === "typescript" && generatedFileCount > 0) {
      const added = ensureCrudDeps(process.cwd());
      if (added.length > 0) {
        console.log(
          `[apso] Added ${added.join(", ")} to package.json (the generated code imports them). Run npm install before building.`
        );
      }
      // The pre-deploy checks run on PGlite; give a stock v1 config support.
      if (upgradeOrmConfigForPglite(process.cwd())) {
        console.log(
          "[apso] Updated src/orm.config.ts so `apso migrate verify` and `apso test smoke` can run on a local PGlite database. Run npm install before building."
        );
      }
    }

    // The generated auth code imports a JWT library; declare it.
    if (auth && isJwtAuth(auth)) {
      if (
        language === "typescript" &&
        addMissingDeps(process.cwd(), JOSE_DEP).length > 0
      )
        console.log(
          "[apso] Added jose to package.json (the generated auth guard imports it). Run npm install before building."
        );
      if (
        language === "python" &&
        addMissingPythonDep(process.cwd(), PYJWT_DEP)
      )
        console.log(
          `[apso] Added ${PYJWT_DEP} to pyproject.toml (the generated auth module imports it). Reinstall the project's dependencies.`
        );
      if (language === "go")
        console.log(
          "[apso] The generated auth middleware imports github.com/golang-jwt/jwt/v5 and github.com/MicahParks/keyfunc/v3. Run go mod tidy before building."
        );
    }
    if (language === "python") {
      const main = path.join(process.cwd(), "app", "main.py");
      if (
        fs.existsSync(main) &&
        !fs.readFileSync(main, "utf8").includes("autogen_router")
      )
        console.warn(
          "[apso] app/main.py does not include autogen_router, so the generated routes are not served. Add: from app.autogen import autogen_router; app.include_router(autogen_router)"
        );
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
