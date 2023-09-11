import rc = require("rc");
import { ApsorcRelationship, Entity, RelationshipMap } from "./types";
import {
  parseRelationships,
  parseV1Relationships,
} from "./utils/relationships";

export type ApsorcType = {
  version: number;
  rootFolder: string;
  entities: Entity[];
  relationships: ApsorcRelationship[];
};

type ParsedApsorcData = {
  entities: Entity[];
  relationshipMap: RelationshipMap;
};
type ParsedApsorc = {
  rootFolder: string;
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
  const version = apsoConfig.version || 1;
  const entities = apsoConfig.entities || [];
  const relationships = apsoConfig.relationships || [];

  return {
    rootFolder,
    version,
    entities,
    relationships,
  };
};

export const parseApsorc = (): ParsedApsorc => {
  const apsoConfig = parseRc();
  switch (apsoConfig.version) {
    case 1:
      return {
        rootFolder: apsoConfig.rootFolder,
        ...parseApsorcV1(apsoConfig),
      };
    case 2:
      return {
        rootFolder: apsoConfig.rootFolder,
        ...parseApsorcV2(apsoConfig),
      };
  }
  throw new Error(`Invalid apsorc config version: ${apsoConfig.version}`);
};
