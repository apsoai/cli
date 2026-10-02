import * as fs from "fs";
import * as path from "path";
import rc from "rc";
import { Entity } from "./types/entity";
import { ApsorcRelationship, RelationshipMap } from "./types/relationship";
import { AuthConfig } from "./types/auth";
import { TargetLanguage } from "./types/generator";
import {
  parseRelationships,
  parseV1Relationships,
} from "./utils/relationships";
import { performance } from "perf_hooks";
// @apso/schema-tools is published on npm (apsoai/apso-packages).
import { lintSchema } from "@apso/schema-tools";

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
   * Top-level default for HTTP controller generation. When false, no entity
   * gets a generated controller unless it opts back in with `http: true`.
   */
  http?: boolean;
  /**
   * Opt-out for the Apso commit co-author hook. When false, the CLI will not
   * install the `prepare-commit-msg` hook that appends the Apso co-author
   * trailer. Defaults to enabled.
   */
  coAuthor?: boolean;
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
  /** Top-level default for HTTP controller generation. */
  http?: boolean;
  /** Opt-out for the Apso commit co-author hook (defaults to enabled). */
  coAuthor?: boolean;
};

export const parseApsorcV1 = (apsorc: ApsorcType): ParsedApsorcData => {
  const { entities } = apsorc;
  const relationshipMap = parseV1Relationships(entities);
  for (const entity of entities) {
    delete entity.associations;
  }
  return { entities, relationshipMap };
};

/**
 * A schema problem that would make `apso generate` emit code that does not
 * compile. `code` is the @apso/schema-tools rule id (FIELD_RELATIONSHIP_COLLISION,
 * DUPLICATE_FIELD_NAME, ...), the same codes the apso-client-v2 validator used.
 */
export class ApsorcNamingError extends Error {
  constructor(
    message: string,
    public code: string,
    public entity: string,
    public field?: string
  ) {
    super(message);
    this.name = "ApsorcNamingError";
  }
}

/**
 * Throws an ApsorcNamingError for the first @apso/schema-tools error, e.g. a
 * text field `notes` on Contact plus Note ManyToOne Contact, whose inverse
 * side is `notes: Note[]` on Contact (TS2300 Duplicate identifier). The client
 * schema builder runs the same rules, so a schema that passes there passes here.
 */
export const assertCodegenSafeNames = (
  apsorc: Pick<ApsorcType, "entities" | "relationships">
): void => {
  const { issues } = lintSchema(apsorc);
  const error = issues.find((issue) => issue.severity === "error");
  if (!error) return;
  const more = issues.filter((issue) => issue.severity === "error").length - 1;
  throw new ApsorcNamingError(
    `${error.message}${more > 0 ? ` (${more} more error${more === 1 ? "" : "s"})` : ""} Run "apso schema lint" to see every issue, or "apso schema lint --fix" to apply the safe fixes.`,
    error.rule,
    error.entity || "",
    error.field
  );
};

export const parseApsorcV2 = (apsorc: ApsorcType): ParsedApsorcData => {
  const { entities, relationships: apsoRelationships } = apsorc;
  assertCodegenSafeNames(apsorc);
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
  const http = apsoConfig.http as boolean | undefined;
  const coAuthor = apsoConfig.coAuthor as boolean | undefined;

  return {
    rootFolder,
    apiType,
    version,
    entities,
    relationships,
    auth,
    language,
    emitEvents,
    http,
    coAuthor,
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
          http: apsoConfig.http,
          coAuthor: apsoConfig.coAuthor,
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
          http: apsoConfig.http,
          coAuthor: apsoConfig.coAuthor,
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
/** Reads the .apsorc file itself (not rc-merged), for commands that rewrite it. */
export const readApsorcFile = (): { configPath: string; apsorc: ApsorcType } => {
  const configPath = findConfigPath();
  if (!configPath) {
    throw new Error("No .apsorc found in this directory or any parent.");
  }
  return { configPath, apsorc: JSON.parse(fs.readFileSync(configPath).toString()) };
};

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
