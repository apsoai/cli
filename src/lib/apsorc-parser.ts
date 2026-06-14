import * as fs from "fs";
import * as path from "path";
import rc from "rc";
import { Entity } from "./types/entity";
import { ApsorcRelationship, RelationshipMap } from "./types/relationship";
import { AuthConfig } from "./types/auth";
import { TargetLanguage, EventDeliveryConfig } from "./types/generator";
import {
  parseRelationships,
  parseV1Relationships,
} from "./utils/relationships";
import { performance } from "perf_hooks";

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
  auth?: AuthConfig;
  language?: TargetLanguage;
  /**
   * Top-level default for the opt-in DomainEvent ("emitEvents") feature.
   * When true, every entity emits domain events unless it opts out with
   * its own `emitEvents: false`.
   */
  emitEvents?: boolean;
  /**
   * Service-wide event-delivery configuration (issue #88). Build-time hint for
   * which delivery adapters to generate; runtime selection/creds live in env.
   */
  eventDelivery?: EventDeliveryConfig;
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
  auth?: AuthConfig;
  language?: TargetLanguage;
  /** Top-level default for the DomainEvent ("emitEvents") feature. */
  emitEvents?: boolean;
  /** Service-wide event-delivery configuration (issue #88). */
  eventDelivery?: EventDeliveryConfig;
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
  const auth = apsoConfig.auth as AuthConfig | undefined;
  const language = apsoConfig.language as TargetLanguage | undefined;
  const emitEvents = apsoConfig.emitEvents as boolean | undefined;
  const eventDelivery = apsoConfig.eventDelivery as
    | EventDeliveryConfig
    | undefined;

  return {
    rootFolder,
    apiType,
    version,
    entities,
    relationships,
    auth,
    language,
    emitEvents,
    eventDelivery,
  };
};

export const parseApsorc = (): ParsedApsorc => {
  const debug = process.env.DEBUG;
  const start = performance.now();
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
      case 1: {
        const v1Start = performance.now();
        const result = {
          rootFolder: apsoConfig.rootFolder,
          apiType: apsoConfig.apiType,
          auth: apsoConfig.auth,
          language: apsoConfig.language,
          emitEvents: apsoConfig.emitEvents,
          eventDelivery: apsoConfig.eventDelivery,
          ...parseApsorcV1(apsoConfig),
        };
        if (debug) {
          console.log(
            `[timing] parseApsorcV1: ${(performance.now() - v1Start).toFixed(
              2
            )}ms`
          );
        }
        if (debug) {
          console.log(
            `[timing] parseApsorc total: ${(performance.now() - start).toFixed(
              2
            )}ms`
          );
        }
        return result;
      }
      case 2: {
        const result = {
          rootFolder: apsoConfig.rootFolder,
          apiType: apsoConfig.apiType,
          auth: apsoConfig.auth,
          language: apsoConfig.language,
          emitEvents: apsoConfig.emitEvents,
          eventDelivery: apsoConfig.eventDelivery,
          ...(() => {
            const relStart = performance.now();
            const parsed = parseApsorcV2(apsoConfig);
            if (debug) {
              console.log(
                `[timing] parseApsorcV2: ${(
                  performance.now() - relStart
                ).toFixed(2)}ms`
              );
            }
            return parsed;
          })(),
        };
        if (debug) {
          console.log(
            `[timing] parseApsorc total: ${(performance.now() - start).toFixed(
              2
            )}ms`
          );
        }
        return result;
      }
    }
    throw new Error(`Invalid apsorc config version: ${apsoConfig.version}`);
  }
};

/**
 * Finds the .apsorc configuration file path.
 * Searches upwards from the current working directory.
 * @returns The absolute path to the .apsorc file, or null if not found.
 */
export const findConfigPath = (): string | null => {
  let currentDir = process.cwd();
  while (currentDir !== path.parse(currentDir).root) {
    const configPath = path.join(currentDir, ".apsorc");
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    currentDir = path.dirname(currentDir);
  }
  const rootConfigPath = path.join(currentDir, ".apsorc");
  if (fs.existsSync(rootConfigPath)) {
    return rootConfigPath;
  }
  return null;
};
