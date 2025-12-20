import { Entity } from "./entity";
import { AuthConfig } from "./auth";
import { RelationshipMap, Relationship } from "./relationship";

/**
 * Supported target languages for code generation
 */
export type TargetLanguage = "typescript" | "python" | "go";

/**
 * Represents a file to be generated
 */
export interface GeneratedFile {
  /**
   * The relative path where the file should be created
   */
  path: string;

  /**
   * The content of the file
   */
  content: string;
}

/**
 * Result of validating a configuration for a specific language
 */
export interface ValidationResult {
  /**
   * Whether the configuration is valid
   */
  valid: boolean;

  /**
   * List of validation errors, if any
   */
  errors: string[];

  /**
   * List of validation warnings (non-fatal issues)
   */
  warnings: string[];
}

/**
 * Language-specific configuration options
 */
export interface PythonLanguageConfig {
  /**
   * Python package name (snake_case)
   */
  packageName?: string;

  /**
   * Whether to use async mode for SQLAlchemy
   */
  asyncMode?: boolean;

  /**
   * Database URL for connection
   */
  databaseUrl?: string;
}

export interface GoLanguageConfig {
  /**
   * Go module name (e.g., "github.com/user/project")
   */
  moduleName?: string;

  /**
   * Package name for the main module
   */
  packageName?: string;

  /**
   * Gin mode: "debug" | "release" | "test"
   */
  ginMode?: "debug" | "release" | "test";
}

export interface TypeScriptLanguageConfig {
  /**
   * Whether to use strict TypeScript mode
   */
  strictMode?: boolean;
}

/**
 * Union type of all language-specific configurations
 */
export type LanguageConfig =
  | PythonLanguageConfig
  | GoLanguageConfig
  | TypeScriptLanguageConfig;

/**
 * Extended configuration including language settings
 */
export interface GeneratorConfig {
  /**
   * Target language for code generation
   */
  language: TargetLanguage;

  /**
   * Root folder for source code
   */
  rootFolder: string;

  /**
   * API type: "rest" or "graphql"
   */
  apiType: string;

  /**
   * All entities from the configuration
   */
  entities: Entity[];

  /**
   * Relationship map for all entities
   */
  relationshipMap: RelationshipMap;

  /**
   * Authentication configuration (optional)
   */
  auth?: AuthConfig;

  /**
   * Language-specific configuration options
   */
  languageConfig?: LanguageConfig;
}

/**
 * Options for generating an entity
 */
export interface EntityGenerationOptions {
  /**
   * The entity definition
   */
  entity: Entity;

  /**
   * Relationships for this entity
   */
  relationships: Relationship[];

  /**
   * All entities (for cross-referencing)
   */
  allEntities: Entity[];

  /**
   * API type being generated
   */
  apiType: string;
}

/**
 * Options for generating controllers/routers
 */
export interface ControllerGenerationOptions extends EntityGenerationOptions {
  /**
   * Relationship map for join queries
   */
  relationshipMap: RelationshipMap;
}

/**
 * Options for generating services
 */
export interface ServiceGenerationOptions extends EntityGenerationOptions {
  /**
   * Relationship map for service methods
   */
  relationshipMap: RelationshipMap;
}

/**
 * Options for generating DTOs/schemas
 */
export interface DtoGenerationOptions extends EntityGenerationOptions {
  /**
   * Include validation decorators/rules
   */
  includeValidation?: boolean;
}

/**
 * Options for generating migrations
 */
export interface MigrationGenerationOptions {
  /**
   * All entities to generate migrations for
   */
  entities: Entity[];

  /**
   * Relationship map for foreign keys
   */
  relationshipMap: RelationshipMap;

  /**
   * Migration name/version
   */
  migrationName?: string;
}

/**
 * Interface that all language-specific generators must implement
 */
export interface LanguageGenerator {
  /**
   * Get the target language this generator supports
   */
  getLanguage(): TargetLanguage;

  /**
   * Get the file extension for generated files
   */
  getFileExtension(): string;

  /**
   * Validate the configuration for this language
   */
  validateConfig(config: GeneratorConfig): ValidationResult;

  /**
   * Generate entity/model files
   */
  generateEntity(options: EntityGenerationOptions): Promise<GeneratedFile[]>;

  /**
   * Generate controller/router files
   */
  generateController(
    options: ControllerGenerationOptions
  ): Promise<GeneratedFile[]>;

  /**
   * Generate service files
   */
  generateService(options: ServiceGenerationOptions): Promise<GeneratedFile[]>;

  /**
   * Generate DTO/schema files
   */
  generateDto(options: DtoGenerationOptions): Promise<GeneratedFile[]>;

  /**
   * Generate module/router registration files
   */
  generateModule(options: EntityGenerationOptions): Promise<GeneratedFile[]>;

  /**
   * Generate migration files
   */
  generateMigration(
    options: MigrationGenerationOptions
  ): Promise<GeneratedFile[]>;

  /**
   * Generate enum files for all entities
   */
  generateEnums(
    entities: Entity[],
    apiType: string
  ): Promise<GeneratedFile[]>;

  /**
   * Generate the index/main module file that ties everything together
   */
  generateIndexModule(
    entities: Entity[],
    apiType: string
  ): Promise<GeneratedFile[]>;

  /**
   * Generate guard files (auth, scope, etc.)
   */
  generateGuards(
    entities: Entity[],
    auth?: AuthConfig
  ): Promise<GeneratedFile[]>;
}

/**
 * Factory function type for creating language generators
 */
export type GeneratorFactory = (config: GeneratorConfig) => LanguageGenerator;

/**
 * Registry of available generators by language
 */
export interface GeneratorRegistry {
  typescript: GeneratorFactory;
  python?: GeneratorFactory;
  go?: GeneratorFactory;
}
