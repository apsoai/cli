import {
  Association,
  ApsorcRelationship,
  Entity,
  RelationshipMap,
} from "../../types";
import { parseRelationship } from "./parse";

const InverseType = {
  OneToOne: "OneToOne",
  OneToMany: "ManyToOne",
  ManyToOne: "OneToMany",
  ManyToMany: "ManyToMany",
};

export const isInverseRelationshipDefined = (
  entityName: string,
  association: Association,
  entities: Entity[]
): boolean => {
  if (entityName === association.name) {
    return false;
  }

  return Boolean(getInverseRelationship(entityName, association, entities));
};

export const getInverseRelationship = (
  entityName: string,
  association: Association,
  entities: Entity[]
): Association | null => {
  if (entityName === association.name) {
    return null;
  }

  const inverseAssociationType = InverseType[association.type];

  const isInverse = (testAssocation: Association) =>
    testAssocation.name === entityName &&
    testAssocation.type === inverseAssociationType;

  return (
    entities
      .find((entity) => entity.name === association.name)
      ?.associations?.find(isInverse) || null
  );
};

const convertAssociationToRelationship = (
  entityName: string,
  association: Association,
  entities: Entity[]
): ApsorcRelationship | null => {
  const inverseRelation = getInverseRelationship(
    entityName,
    association,
    entities
  );
  let biDirectional = Boolean(inverseRelation);
  let index = association.index;

  if (association.type === "OneToMany" && inverseRelation) {
    index = inverseRelation.index || false;
  }

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
    index,
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
