import pluralize from "pluralize";
import { camelCase } from "../../utils/casing";
import {
  ApsorcRelationship,
  Relationship,
  RelationshipMap,
  RelationshipForTemplate,
} from "../../types";

export const parseOneToMany = (
  relationship: ApsorcRelationship
): RelationshipMap => {
  return {
    [relationship.from]: [
      {
        name: relationship.to,
        type: "OneToMany",
        biDirectional: true,
      },
    ],
    [relationship.to]: [
      {
        name: relationship.from,
        type: "ManyToOne",
        nullable: relationship.nullable || false,
        biDirectional: true,
      },
    ],
  };
};

export const parseManytoOne = (
  relationship: ApsorcRelationship
): RelationshipMap => {
  return {
    [relationship.from]: [
      {
        name: relationship.to,
        type: "ManyToOne",
        referenceName: relationship.to_name || null,
        nullable: relationship.nullable || false,
      },
    ],
  };
};

export const parseManyToMany = (
  relationship: ApsorcRelationship
): RelationshipMap => {
  const response: RelationshipMap = {
    [relationship.from]: [
      {
        name: relationship.to,
        type: "ManyToMany",
        join: true,
        biDirectional: relationship.bi_directional || false,
      },
    ],
  };

  if (relationship.bi_directional) {
    response[relationship.to] = [
      {
        name: relationship.from,
        type: "ManyToMany",
        biDirectional: true,
      },
    ];
  }

  return response;
};

export const parseOneToOne = (
  relationship: ApsorcRelationship
): RelationshipMap => {
  return {
    [relationship.from]: [
      {
        name: relationship.to,
        type: "OneToOne",
        join: true,
        nullable: relationship.nullable || false,
      },
    ],
    [relationship.to]: [
      {
        name: relationship.from,
        type: "OneToOne",
      },
    ],
  };
};

export const parseRelationship = (
  relationship: ApsorcRelationship
): RelationshipMap => {
  switch (relationship.type) {
    case "OneToMany":
      return parseOneToMany(relationship);
    case "ManyToOne":
      return parseManytoOne(relationship);
    case "ManyToMany":
      return parseManyToMany(relationship);
    case "OneToOne":
      return parseOneToOne(relationship);
  }
  return {};
};

export const parseRelationships = (
  relationships: ApsorcRelationship[]
): RelationshipMap => {
  const response: RelationshipMap = {};
  for (const rel of relationships) {
    const parsedResult = parseRelationship(rel);
    for (const key of Object.keys(parsedResult)) {
      response[key] = [...(response[key] || []), ...parsedResult[key]];
    }
  }
  return response;
};

const getRelationshipName = (relationship: Relationship): string => {
  if (relationship.referenceName) {
    return camelCase(relationship.referenceName);
  }
  return camelCase(relationship.name);
};

export const getRelationshipIdField = (relationship: Relationship): string => {
  return `${getRelationshipName(relationship)}Id`;
};

export const getRelationshipForTemplate = (
  entityName: string,
  relationships: Relationship[]
): RelationshipForTemplate[] => {
  if (!relationships) {
    return [];
  }

  return relationships.map((relationship: Relationship) => {
    const relationshipName = getRelationshipName(relationship);
    return {
      ...relationship,
      relationshipName,
      pluralizedRelationshipName: pluralize(relationshipName),
      pluralizedName: pluralize(camelCase(relationship.name)),
      camelCasedName: camelCase(relationship.name),
      camelCasedId: getRelationshipIdField(relationship),
      entityName: camelCase(entityName),
      joinTable: relationship.join || false,
      biDirectional: relationship.biDirectional || false,
    };
  });
};

export const getNestedRelationships = (
  entityName: string,
  relationshipMap: RelationshipMap
): (string | null | undefined)[] | null => {
  if (!relationshipMap[entityName]) {
    return null;
  }

  const nestedRelationships = [];
  for (const relationship of relationshipMap[entityName]) {
    const { name: relationshipName, type } = relationship;
    const referenceName = getRelationshipName(relationship);

    const associatedRelationships = relationshipMap[relationshipName];
    for (const associatedRelationship of associatedRelationships) {
      const childReferenceName = getRelationshipName(associatedRelationship);
      const { name: childRelationshipName, type: childType } =
        associatedRelationship;

      if (childRelationshipName === entityName) {
        continue;
      }
      const parent =
        type === "ManyToOne" || type === "OneToOne"
          ? camelCase(referenceName)
          : pluralize(camelCase(relationshipName));
      const child =
        childType === "ManyToOne" || childType === "OneToOne"
          ? camelCase(childReferenceName)
          : pluralize(camelCase(childReferenceName));
      nestedRelationships.push(`${parent}.${child}`);
    }
  }

  return nestedRelationships;
};

export const getRelationshipsForImport = (
  entityName: string,
  relationships?: Relationship[]
): string[] => {
  if (relationships === undefined) {
    return [];
  }

  return [
    ...new Set(
      relationships
        .map((relationship) => relationship.name)
        .filter((relationshipName) => relationshipName !== entityName)
    ),
  ];
};
