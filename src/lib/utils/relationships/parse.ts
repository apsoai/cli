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
        biDirectional: true
      },
    ],
    [relationship.to]: [
      {
        name: relationship.from,
        type: "ManyToOne",
        nullable: relationship.nullable || false,
        biDirectional: true,
        index: relationship.index || false,
        cascadeDelete: relationship.cascadeDelete || false
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
        index: relationship.index || false,
      },
    ],
  };
};

export const parseManyToMany = (
  relationship: ApsorcRelationship,
  allRelationships: ApsorcRelationship[]
): RelationshipMap => {
  // Find the inverse relationship definition (if exists)
  const inverseDefinition = allRelationships.find(
    def => def.from === relationship.to &&
           def.to === relationship.from &&
           def.type === 'ManyToMany' &&
           def.bi_directional
  );

  // For self-referencing relationships, find the matching inverse by to_name
  const isSelfReferencing = relationship.from === relationship.to;
  let selfRefInverse = null;
  
  if (isSelfReferencing && relationship.bi_directional) {
    // Find the other relationship that completes the pair
    selfRefInverse = allRelationships.find(
      def => def.from === relationship.from &&
             def.to === relationship.to &&
             def.type === 'ManyToMany' &&
             def.bi_directional &&
             def.to_name !== relationship.to_name
    );
  }

  let isOwningSide = Boolean(relationship.joinTableName || relationship.joinColumnName || relationship.inverseJoinColumnName);

  const currentPropertyName = relationship.to_name;
  let inversePropertyName = inverseDefinition?.to_name;

  // For self-referencing pairs, store the other to_name as inverseReferenceName
  if (isSelfReferencing && selfRefInverse) {
    inversePropertyName = selfRefInverse.to_name;
  }

  if (!currentPropertyName) {
    console.warn(`[APSO WARNING] Missing 'to_name' for ManyToMany: ${relationship.from} -> ${relationship.to}. Skipping this definition.`);
    return {};
  }
  
  if (relationship.bi_directional && !inversePropertyName) {
     console.warn(`[APSO WARNING] Missing inverse 'to_name' for bidirectional ManyToMany: ${relationship.to} -> ${relationship.from}. Inverse mapping might be incorrect.`);
  }

  let joinTableName = relationship.joinTableName;
  let joinColumnName = relationship.joinColumnName;
  let inverseJoinColumnName = relationship.inverseJoinColumnName;

  // For self-referencing, ensure both sides get join=true and the same custom names
  if (isSelfReferencing && relationship.bi_directional) {
    isOwningSide = true; // Both sides get @JoinTable for self-ref
    
    // If current def doesn't have names, but inverse does, grab them
    if (!joinTableName && selfRefInverse?.joinTableName) {
      joinTableName = selfRefInverse.joinTableName;
      joinColumnName = selfRefInverse.joinColumnName; 
      inverseJoinColumnName = selfRefInverse.inverseJoinColumnName;
    }
  }

  const fromSideRelationship: Relationship = {
    name: relationship.to,
    type: "ManyToMany",
    referenceName: currentPropertyName,
    join: isOwningSide,
    biDirectional: relationship.bi_directional || false,
    joinTableName: joinTableName,
    joinColumnName: joinColumnName,
    inverseJoinColumnName: inverseJoinColumnName,
    inverseReferenceName: inversePropertyName || undefined,
  };

  const response: RelationshipMap = {
    [relationship.from]: [fromSideRelationship],
  };

  return response;
};

export const parseOneToOne = (
  relationship: ApsorcRelationship
): RelationshipMap => {
  const response: RelationshipMap = {
    [relationship.from]: [
      {
        name: relationship.to,
        type: "OneToOne",
        join: true,
        nullable: relationship.nullable || false,
        referenceName: relationship.to_name || null,
        biDirectional: relationship.bi_directional || false,
      },
    ],
  };

  if (relationship.bi_directional) {
    response[relationship.to] = [
      {
        name: relationship.from,
        type: "OneToOne",
        biDirectional: true,
      },
    ];
  }

  return response;
};

export const parseRelationship = (
  relationship: ApsorcRelationship,
  allRelationships: ApsorcRelationship[]
): RelationshipMap => {
  if (relationship.type === "ManyToMany") {
    return parseManyToMany(relationship, allRelationships);
  }

  switch (relationship.type) {
    case "OneToMany":
       return {
         [relationship.from]: [{ name: relationship.to, type: "OneToMany", biDirectional: true, referenceName: relationship.to_name || null }],
         [relationship.to]: [{ name: relationship.from, type: "ManyToOne", nullable: relationship.nullable || false, biDirectional: true, index: relationship.index || false, cascadeDelete: relationship.cascadeDelete || false }],
       };
    case "ManyToOne":
       return {
         [relationship.from]: [{ name: relationship.to, type: "ManyToOne", referenceName: relationship.to_name || null, nullable: relationship.nullable || false, index: relationship.index || false }],
       };
    case "OneToOne": {
        const inverseOnetoOneDef = allRelationships.find(
            def => def.from === relationship.to && def.to === relationship.from && def.type === 'OneToOne' && def.bi_directional
        );
        const isOneToOneOwner = relationship.bi_directional ? !relationship.to_name : true;
       const fromOneToOne: Relationship = { name: relationship.to, type: "OneToOne", join: isOneToOneOwner, nullable: relationship.nullable || false, referenceName: relationship.to_name || undefined, biDirectional: relationship.bi_directional || false, inverseReferenceName: inverseOnetoOneDef?.to_name || undefined };
       const responseMap: RelationshipMap = { [relationship.from]: [fromOneToOne] };
       if (relationship.bi_directional && inverseOnetoOneDef) {
         responseMap[relationship.to] = [
           ...(responseMap[relationship.to] || []),
           { name: relationship.from, type: "OneToOne", biDirectional: true, join: !isOneToOneOwner, referenceName: inverseOnetoOneDef.to_name || undefined, inverseReferenceName: relationship.to_name || undefined } 
         ];
       }
       return responseMap;
    }
  }
  return {};
};

export const parseRelationships = (
  relationships: ApsorcRelationship[]
): RelationshipMap => {
  const response: RelationshipMap = {};
  for (const rel of relationships) {
    const parsedResult = parseRelationship(rel, relationships);
    for (const key of Object.keys(parsedResult)) {
      if (parsedResult[key] && parsedResult[key].length > 0) { 
          response[key] = [...(response[key] || []), ...parsedResult[key]];
      }
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

const calculateInversePropertyName = (
  relationship: Relationship,
  entityName: string,
  relationshipName: string,
  needsPluralInverse: boolean
): string => {
  const isSelfReferencing = relationship.name === entityName;
  
  if (isSelfReferencing && relationship.type === 'ManyToMany') {
    if (relationship.inverseReferenceName) {
      return camelCase(relationship.inverseReferenceName);
    }
    const fallback = camelCase(entityName);
    return needsPluralInverse ? pluralize(fallback) : fallback;
  }

  if (relationship.inverseReferenceName) {
    let inverse = camelCase(relationship.inverseReferenceName);
    if (needsPluralInverse) {
      inverse = pluralize(inverse);
    }
    // Check for special plural terms
    const specialPlurals = [
      'children', 'people', 'men', 'women', 'mice', 'geese', 'teeth', 'feet',
      'oxen', 'cacti', 'indices', 'vertices', 'analyses', 'crises', 'diagnoses',
      'media', 'criteria', 'data', 'parents'
    ];
    if (specialPlurals.includes(relationship.inverseReferenceName)) {
      return relationship.inverseReferenceName;
    }
    return inverse;
  }

  const fallback = camelCase(entityName);
  return needsPluralInverse ? pluralize(fallback) : fallback;
};

export const getRelationshipForTemplate = (
  entityName: string,
  relationships: Relationship[]
): RelationshipForTemplate[] => {
  if (!relationships) {
    return [];
  }

  return relationships.map((relationship: Relationship) => {
    const thisReferenceName = relationship.referenceName;
    const relationshipName = camelCase(thisReferenceName || relationship.name);
    const needsPluralInverse = relationship.type === 'ManyToOne' || relationship.type === 'ManyToMany';

    const inversePropertyName = calculateInversePropertyName(
      relationship,
      entityName,
      relationshipName,
      needsPluralInverse
    );

    if (relationship.biDirectional && !relationship.inverseReferenceName && 
        (relationship.type === 'ManyToMany' || relationship.type === 'OneToMany' || relationship.type === 'OneToOne')) {
      console.warn(`[APSO WARNING] Using default inverse property name '${inversePropertyName}' for ${entityName}.${relationshipName}. Define 'to_name' for the inverse relationship ${relationship.name}->${entityName}.`);
    }

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
      referenceName: thisReferenceName || undefined,
      inversePropertyName,
    };
  });
};

export const getNestedRelationships = (
  entityName: string,
  relationshipMap: RelationshipMap,
  prefix = "",
  visited: Set<string> = new Set()
): string[] => {
  const relationships: string[] = [];

  if (visited.has(entityName)) {
    return relationships;
  }

  const currentRelationships = relationshipMap[entityName];
  if (!currentRelationships) return relationships;

  visited.add(entityName);

  for (const relationship of currentRelationships) {
    const { name: relationshipName, type } = relationship;

    const referenceName = getRelationshipName(relationship);
    const formattedName =
      type === "ManyToOne" || type === "OneToOne"
        ? camelCase(referenceName)
        : pluralize(camelCase(referenceName));

    const relationshipPath = prefix
      ? `${prefix}.${formattedName}`
      : formattedName;
    const hasChild = relationshipPath.includes(".");
    const exists =
      prefix
        .split(".")
        .some(
          (a) =>
            a === camelCase(referenceName) ||
            a === pluralize(camelCase(referenceName))
        );
    const deepEnough = prefix.split(".").length >= 4;
    const canAdd = hasChild && !exists && !deepEnough;

    if (canAdd) {
      relationships.push(relationshipPath);
    }

    const nestedRelationships = getNestedRelationships(
      relationshipName,
      relationshipMap,
      relationshipPath,
      new Set(visited)
    );
    relationships.push(...nestedRelationships);
  }

  return relationships;
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
