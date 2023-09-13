import rc = require("rc");
import { ApsorcRelationship, Entity, RelationshipMap } from "./types";
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
