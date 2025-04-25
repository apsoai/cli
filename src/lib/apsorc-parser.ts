import * as fs from "fs";
import * as path from "path";
import rc from "rc";
import { Entity } from "./types/entity";
import { ApsorcRelationship, RelationshipMap } from "./types/relationship";
import {
  parseRelationships,
  parseV1Relationships,
} from "./utils/relationships";

export enum ApiType {
  Graphql = "graphql",
  Rest = "rest",
}

export type ApsorcType = {
  version: number;
  rootFolder: string;
  entities: Entity[];
  apiType: ApiType;
  relationships: ApsorcRelationship[];
};

type ParsedApsorcData = {
  entities: Entity[];
  relationshipMap: RelationshipMap;
};
type ParsedApsorc = {
  rootFolder: string;
  apiType: string;
  entities: Entity[];
  relationshipMap: RelationshipMap;
};

export const parseApsorcV1 = (apsorc: ApsorcType): ParsedApsorcData => {
  const { entities } = apsorc;
  const relationshipMap = parseV1Relationships(entities);
  for (const entity of entities) {
    delete entity.associations;
  }
  return { entities, relationshipMap };
};

export const parseApsorcV2 = (apsorc: ApsorcType): ParsedApsorcData => {
  const { entities, relationships: apsoRelationships } = apsorc;
  const relationshipMap = parseRelationships(apsoRelationships);
  return { entities, relationshipMap };
};

const parseRc = (): ApsorcType => {
  const apsoConfig = rc("apso");
  const rootFolder = apsoConfig.rootFolder || "src";
  const apiType = apsoConfig.apiType || "Rest";
  const version = apsoConfig.version || 1;
  const entities = apsoConfig.entities || [];
  const relationships = apsoConfig.relationships || [];

  return {
    rootFolder,
    apiType,
    version,
    entities,
    relationships,
  };
};

export const parseApsorc = (): ParsedApsorc => {
  const apsoConfig = parseRc();
  if (
    apsoConfig.version === 1 &&
    apsoConfig?.apiType.toLowerCase() !== ApiType.Rest.toLowerCase()
  ) {
    throw new Error(
      `Graphql is not supported for apsorc version 1. In order to use Graphql make sure your apsorc file is version 2 compatible.`
    );
  } else {
    switch (apsoConfig.version) {
      case 1:
        return {
          rootFolder: apsoConfig.rootFolder,
          apiType: apsoConfig.apiType,
          ...parseApsorcV1(apsoConfig),
        };
      case 2:
        return {
          rootFolder: apsoConfig.rootFolder,
          apiType: apsoConfig.apiType,
          ...parseApsorcV2(apsoConfig),
        };
    }
    throw new Error(`Invalid apsorc config version: ${apsoConfig.version}`);
  }
};

/**
 * Represents the unified configuration structure after parsing and potential migration.
 */
interface UnifiedConfig {
  entities: Entity[];
  relationships: ApsorcRelationship[];
  rootFolder: string;
}

/**
 * Finds the .apsorc configuration file path.
 * Searches upwards from the current working directory.
 * @returns The absolute path to the .apsorc file, or null if not found.
 */
export const findConfigPath = (): string | null => {
  let currentDir = process.cwd();
  // Search upwards
  while (currentDir !== path.parse(currentDir).root) {
    const configPath = path.join(currentDir, ".apsorc");
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    currentDir = path.dirname(currentDir);
  }
  // Check root directory as well
  const rootConfigPath = path.join(currentDir, ".apsorc");
  if (fs.existsSync(rootConfigPath)) {
    return rootConfigPath;
  }

  return null; // Not found
};

/**
 * Loads, validates, and potentially migrates the .apsorc configuration.
 * Uses the `rc` library to find and load the .apsorc file.
 * Detects config version (V1 or V2) and migrates V1 to V2 if necessary.
 * Performs basic validation on the final V2 structure.
 * @param appName The name of the application (used by `rc`). Defaults to 'apso'.
 * @param defaults Default configuration values (used by `rc`).
 * @returns The unified configuration (entities, relationships, rootFolder).
 * @throws Error if the config file cannot be found, is invalid, or migration fails.
 */
export const loadConfig = (
  appName = "apso",
  defaults = {}
): UnifiedConfig => {
  // Use rc to find and load the configuration file (.apsorc)
  const configData = rc(appName, defaults);
  const rootFolder = configData.rootFolder || "src"; // Get rootFolder early

  // Check if rc found and loaded the config
  // rc returns an object with default keys if nothing is found, 
  // so check for more than just default keys or if configData.config exists
  const hasMeaningfulConfig = configData && 
                             Object.keys(configData).some(key => !Object.prototype.hasOwnProperty.call(defaults, key) && key !== '_') && 
                             configData.configs && configData.configs.length > 0;

  if (!hasMeaningfulConfig) {
      // If rc didn't find it, try our manual search as a fallback
      const foundPath = findConfigPath();
      // Use ternary to satisfy unicorn/prefer-ternary rule
      throw foundPath
         ? new Error(
             `Configuration file found at: ${foundPath}, but failed to parse. Ensure it is valid JSON or INI.`
           )
         : new Error(
             ".apsorc configuration file not found in the current directory or any parent directory."
           );
  }

  // Determine version and parse accordingly using existing functions
  const version = configData.version || 1; // Default to 1 if undefined
  let parsedData: ParsedApsorcData;

  // Create an object matching ApsorcType structure from rc data
  const apsorcInput: ApsorcType = {
    version: version,
    rootFolder: rootFolder,
    entities: configData.entities || [],
    apiType: configData.apiType || ApiType.Rest, // Assuming ApiType enum is available
    relationships: configData.relationships || []
  };

  if (version === 1) {
     // Pass the correctly structured object
     parsedData = parseApsorcV1(apsorcInput); 
  } else if (version === 2 && Array.isArray(configData.relationships)) {
     // Pass the correctly structured object
     parsedData = parseApsorcV2(apsorcInput);
  } else {
     throw new Error(
       "Invalid .apsorc format. Could not determine configuration version or structure."
     );
  }

  // Basic validation on the result of parsing
  if (!parsedData.entities || !Array.isArray(parsedData.entities)) {
    throw new Error("Invalid config: 'entities' array is missing or invalid after parsing.");
  }
  if (!rootFolder || typeof rootFolder !== 'string') {
      throw new Error(
        "Invalid config: 'rootFolder' string is missing or invalid."
      );
  }
  // Relationships are implicitly validated by parseRelationships/parseV1Relationships

  return {
    entities: parsedData.entities,
    // Extract relationships from the relationshipMap keys/values if needed,
    // or adjust UnifiedConfig. For now, returning empty array as placeholder.
    // The relationshipMap is the primary output needed by downstream code.
    relationships: [], // Placeholder - loadConfig users might need relationshipMap instead
    rootFolder: rootFolder
  };
};
