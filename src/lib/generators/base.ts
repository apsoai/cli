import * as path from "path";
import * as Eta from "eta";
import {
  TargetLanguage,
  GeneratedFile,
  ValidationResult,
  GeneratorConfig,
  EntityGenerationOptions,
  ControllerGenerationOptions,
  ServiceGenerationOptions,
  DtoGenerationOptions,
  MigrationGenerationOptions,
  LanguageGenerator,
  Entity,
  AuthConfig,
} from "../types";
import { createFile, withGeneratedMeta } from "../utils/file-system";

/**
 * Abstract base class for language-specific generators.
 * Provides common functionality and enforces the LanguageGenerator interface.
 */
export abstract class BaseGenerator implements LanguageGenerator {
  protected config: GeneratorConfig;
  protected templateEngine: typeof Eta;
  protected templateBasePath: string;

  constructor(config: GeneratorConfig) {
    this.config = config;
    this.templateEngine = Eta;
    this.templateBasePath = path.join(
      __dirname,
      `../templates/${this.getLanguage()}`
    );

    // Configure Eta for this generator's templates
    Eta.configure({
      views: this.templateBasePath,
      cache: false,
    });
  }

  /**
   * Get the target language this generator supports
   */
  abstract getLanguage(): TargetLanguage;

  /**
   * Get the file extension for generated files (e.g., ".ts", ".py", ".go")
   */
  abstract getFileExtension(): string;

  /**
   * Validate the configuration for this language
   */
  abstract validateConfig(config: GeneratorConfig): ValidationResult;

  /**
   * Generate entity/model files
   */
  abstract generateEntity(
    options: EntityGenerationOptions
  ): Promise<GeneratedFile[]>;

  /**
   * Generate controller/router files
   */
  abstract generateController(
    options: ControllerGenerationOptions
  ): Promise<GeneratedFile[]>;

  /**
   * Generate service files
   */
  abstract generateService(
    options: ServiceGenerationOptions
  ): Promise<GeneratedFile[]>;

  /**
   * Generate DTO/schema files
   */
  abstract generateDto(options: DtoGenerationOptions): Promise<GeneratedFile[]>;

  /**
   * Generate module/router registration files
   */
  abstract generateModule(
    options: EntityGenerationOptions
  ): Promise<GeneratedFile[]>;

  /**
   * Generate migration files
   */
  abstract generateMigration(
    options: MigrationGenerationOptions
  ): Promise<GeneratedFile[]>;

  /**
   * Generate enum files for all entities
   */
  abstract generateEnums(
    entities: Entity[],
    apiType: string
  ): Promise<GeneratedFile[]>;

  /**
   * Generate the index/main module file
   */
  abstract generateIndexModule(
    entities: Entity[],
    apiType: string
  ): Promise<GeneratedFile[]>;

  /**
   * Generate guard files (auth, scope, etc.)
   */
  abstract generateGuards(
    entities: Entity[],
    auth?: AuthConfig
  ): Promise<GeneratedFile[]>;

  /**
   * Render a template file with the given data
   */
  protected async renderTemplate(
    templatePath: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const content = await this.templateEngine.renderFileAsync(
      templatePath,
      withGeneratedMeta(data)
    );
    return content as string;
  }

  /**
   * Write generated files to disk
   * Note: Sequential writes are intentional to avoid race conditions
   */
  protected async writeFiles(
    baseDir: string,
    files: GeneratedFile[]
  ): Promise<void> {
    for (const file of files) {
      const fullPath = path.join(baseDir, file.path);
      // eslint-disable-next-line no-await-in-loop
      await createFile(fullPath, file.content);
    }
  }

  /**
   * Get the configuration for this generator
   */
  getConfig(): GeneratorConfig {
    return this.config;
  }

  /**
   * Get the template base path for this generator
   */
  getTemplateBasePath(): string {
    return this.templateBasePath;
  }

  /**
   * Helper to create a validation result
   */
  protected createValidationResult(
    errors: string[] = [],
    warnings: string[] = []
  ): ValidationResult {
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Helper to check if an entity has a specific field type
   */
  protected entityHasFieldType(entity: Entity, fieldType: string): boolean {
    return (
      entity.fields?.some((field) => field.type === fieldType) ?? false
    );
  }

  /**
   * Helper to get all unique field types from entities
   */
  protected getUniqueFieldTypes(entities: Entity[]): string[] {
    const types = new Set<string>();
    for (const entity of entities) {
      for (const field of entity.fields ?? []) {
        types.add(field.type);
      }
    }
    return [...types];
  }

  /**
   * Helper to check if any entity has enum fields
   */
  protected hasEnumFields(entities: Entity[]): boolean {
    return entities.some((entity) => this.entityHasFieldType(entity, "enum"));
  }
}
