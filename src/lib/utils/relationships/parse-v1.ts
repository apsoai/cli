import {
  Association,
  ApsorcRelationship,
  Entity,
  RelationshipMap,
} from "../../types";
import { parseRelationship } from "./parse";

export const isInverseRelationshipDefined = (
  entityName: string,
  association: Association,
  entities: Entity[]
): boolean => {
  if (entityName === association.name) {
    return false;
  }

  return Boolean(
    entities
      .find((entity) => entity.name === association.name)
      ?.associations?.find((entity) => entity.name === entityName)
  );
};

export const getInverseRelationship = (
  entityName: string,
  association: Association,
  entities: Entity[]
): Association | null => {
  if (entityName === association.name) {
    return null;
  }
  
  return entities
    .find((entity) => entity.name === association.name)
    ?.associations?.find((entity) => entity.name === entityName) || null;
};

const convertAssociationToRelationship = (
  entityName: string,
  association: Association,
  entities: Entity[]
): ApsorcRelationship | null => {
  const inverseRelation = getInverseRelationship(entityName, association, entities);
  let biDirectional = Boolean(inverseRelation);

  if (association.type === "ManyToOne" && biDirectional) {
    return null;
  }

  if (association.type === "ManyToMany" && inverseRelation) {
    if (
      association.join_table !== true &&
      inverseRelation.join_table === true
    ) {
      return null;
    }

    if (
      association.join_table === true &&
      inverseRelation.join_table === true
    ) {
      // Both ManyToMany sides have join_table set to true
      biDirectional = false;
    }
  }

  const inverseNullable =
    (inverseRelation && inverseRelation.nullable) || false;
  return {
    from: entityName,
    to: association.name,
    type: association.type,
    /* eslint-disable-next-line  camelcase */
    to_name: association.reference_name,
    nullable: association.nullable || inverseNullable,
    /* eslint-disable-next-line  camelcase */
    bi_directional: biDirectional,
  };
};

export const parseV1Relationships = (entities: Entity[]): RelationshipMap => {
  const relationshipMap: RelationshipMap = {};

  for (const entity of entities) {
    if (!entity.associations) {
      continue;
    }
    for (const association of entity.associations) {
      const apsorcRelationship = convertAssociationToRelationship(
        entity.name,
        association,
        entities
      );
      if (apsorcRelationship === null) {
        continue;
      }

      const parsedResult = parseRelationship(apsorcRelationship);

      for (const key of Object.keys(parsedResult)) {
        relationshipMap[key] = [
          ...(relationshipMap[key] || []),
          ...parsedResult[key],
        ];
      }
    }
  }

  return relationshipMap;
};
