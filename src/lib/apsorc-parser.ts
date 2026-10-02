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
import pluralize from "pluralize";
import { camelCase } from "./utils/casing";

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

/** Valid in TypeScript, Python and Go, so every target language compiles it. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A name in .apsorc that would generate code that does not compile. `code`
 * matches the apso-client-v2 schema validator (src/lib/ai/validation.ts).
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
 * Throws an ApsorcNamingError when .apsorc names would generate code that does
 * not compile, e.g. a text field `notes` on Contact plus Note ManyToOne
 * Contact, whose inverse side is `notes: Note[]` on Contact (TS2300 Duplicate
 * identifier). The client schema validator enforces the same rules; both repos
 * run test/fixtures/codegen-naming-cases.json, so change them together.
 */
export const assertCodegenSafeNames = (
  entities: Entity[],
  relationshipMap: RelationshipMap
): void => {
  const seenEntities = new Set<string>();
  for (const entity of entities) {
    if (seenEntities.has(entity.name)) {
      throw new ApsorcNamingError(
        `Entity "${entity.name}" is defined more than once. Merge or rename one of them in .apsorc.`,
        "DUPLICATE_ENTITY_NAME",
        entity.name
      );
    }
    seenEntities.add(entity.name);
    if (!IDENTIFIER.test(entity.name)) {
      throw new ApsorcNamingError(
        `Entity "${entity.name}" is not a valid name. Use letters, digits and underscores, starting with a letter.`,
        "INVALID_ENTITY_NAME",
        entity.name
      );
    }

    const fieldNames = new Set<string>();
    for (const { name } of entity.fields || []) {
      if (!IDENTIFIER.test(name)) {
        throw new ApsorcNamingError(
          `Field "${name}" on entity "${entity.name}" is not a valid name. Use letters, digits and underscores.`,
          "INVALID_FIELD_NAME",
          entity.name,
          name
        );
      }
      if (fieldNames.has(name)) {
        throw new ApsorcNamingError(
          `Entity "${entity.name}" has more than one field named "${name}". Remove or rename one in .apsorc.`,
          "DUPLICATE_FIELD_NAME",
          entity.name,
          name
        );
      }
      fieldNames.add(name);
    }

    // Same property names and dedupe key as getRelationshipForTemplate + entity.eta.
    const generated = new Map<string, { key: string; rel: string }>();
    for (const rel of relationshipMap[entity.name] || []) {
      const base = rel.referenceName || rel.name;
      const property = camelCase(
        rel.type === "OneToMany" || rel.type === "ManyToMany"
          ? pluralize(base)
          : base
      );
      const key = `${rel.name}:${rel.referenceName || "default"}`;
      const desc = `${rel.type} relationship to "${rel.name}"`;
      if (fieldNames.has(property)) {
        throw new ApsorcNamingError(
          `Entity "${entity.name}" has a field "${property}" with the same name as the property generated by its ${desc}. Rename the field in .apsorc.`,
          "FIELD_RELATIONSHIP_COLLISION",
          entity.name,
          property
        );
      }
      const existing = generated.get(property);
      if (existing && existing.key !== key) {
        throw new ApsorcNamingError(
          `Entity "${entity.name}" gets the property "${property}" from both its ${existing.rel} and its ${desc}. Give one of them a different "to_name" in .apsorc.`,
          "RELATIONSHIP_PROPERTY_CLASH",
          entity.name,
          property
        );
      }
      generated.set(property, { key, rel: desc });
    }
  }
};

export const parseApsorcV2 = (apsorc: ApsorcType): ParsedApsorcData => {
  const { entities, relationships: apsoRelationships } = apsorc;
  const relationshipMap = parseRelationships(apsoRelationships);
  assertCodegenSafeNames(entities, relationshipMap);
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
