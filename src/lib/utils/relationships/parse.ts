import pluralize from "pluralize";
import { camelCase } from "../../utils/casing";
import {
  ApsorcRelationship,
  Relationship,
  RelationshipMap,
  RelationshipForTemplate,
} from "../../types";

/**
 * Parses a OneToMany relationship definition.
 * These are treated as bidirectional from the .apsorc definition.
 * Only generates the configuration for the 'from' side.
 * @param relationship The .apsorc relationship definition.
 * @returns A RelationshipMap containing only the entry for the 'from' side.
 */
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

/**
 * Parses a ManyToOne relationship definition.
 * These are treated as unidirectional from the .apsorc definition.
 * Only generates the configuration for the 'from' side.
 * @param relationship The .apsorc relationship definition.
 * @returns A RelationshipMap containing only the entry for the 'from' side.
 */
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

/**
 * Parses a ManyToMany relationship definition.
 * Determines bidirectionality based on flags and inverse definitions.
 * Determines the owning side (which gets the @JoinTable decorator).
 * Calculates reference names (property names), defaulting if 'to_name' is missing.
 * If bidirectional, generates configuration for both 'from' and 'to' sides.
 * @param relationship The .apsorc relationship definition.
 * @param allRelationships The full list of relationship definitions for finding inverses.
 * @returns A RelationshipMap containing entries for one or both sides.
 */
export const parseManyToMany = (
  relationship: ApsorcRelationship,
  allRelationships: ApsorcRelationship[]
): RelationshipMap => {
  // Find the inverse relationship definition (if exists)
  const inverseDefinition = allRelationships.find(
    def => def.from === relationship.to &&
           def.to === relationship.from &&
           def.type === 'ManyToMany'
  );

  // Determine if the relationship should be treated as bidirectional
  const isEffectivelyBiDirectional = Boolean(relationship.bi_directional || inverseDefinition?.bi_directional);

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

  let isOwningSide:
    | boolean
    | undefined = relationship.joinTableName || relationship.joinColumnName || relationship.inverseJoinColumnName
      ? true
      : undefined;

  if (isOwningSide === undefined && inverseDefinition) {
    // If current doesn't have details, check if inverse does
    isOwningSide =
      !(inverseDefinition.joinTableName || inverseDefinition.joinColumnName || inverseDefinition.inverseJoinColumnName);
  }
  if (isOwningSide === undefined) {
    // If neither has details, default to the current definition being the owner
    isOwningSide = true;
  }

  // Default currentPropertyName if to_name is not provided
  const currentPropertyName = relationship.to_name || pluralize(camelCase(relationship.to));
  let inversePropertyName = inverseDefinition?.to_name;

  // For self-referencing pairs, store the other to_name as inverseReferenceName
  if (isSelfReferencing && selfRefInverse) {
    inversePropertyName = selfRefInverse.to_name;
  }

  if (!currentPropertyName) {
    console.warn(`[APSO WARNING] Missing 'to_name' for ManyToMany: ${relationship.from} -> ${relationship.to}. Skipping this definition.`);
    return {};
  }
  
  // Check for missing inverse 'to_name' only if it's effectively bidirectional
  if (isEffectivelyBiDirectional && !inversePropertyName) {
     console.info(`[APSO INFO] No 'to_name' provided for bidirectional ManyToMany: ${relationship.to} -> ${relationship.from}. Using default inverse property name. Add 'to_name' for explicit control.`);
     // Default inverse property name if missing (using calculateInversePropertyName logic later)
  }

  // Calculate reference names, applying defaults if needed
  const fromSideRefName = relationship.to_name || (relationship.to.toLowerCase() + 's');
  const toSideRefName = inverseDefinition?.to_name || (relationship.from.toLowerCase() + 's');

  let joinTableName = relationship.joinTableName;

  // For self-referencing, ensure both sides get join=true and the same custom names
  if (isSelfReferencing && relationship.bi_directional) {
    isOwningSide = true; // Both sides get @JoinTable for self-ref
    
    // If current def doesn't have names, but inverse does, grab them
    if (!joinTableName && selfRefInverse?.joinTableName) {
      joinTableName = selfRefInverse.joinTableName;
    }
  }

  const fromSideRelationship: Relationship = {
    name: relationship.to,
    type: "ManyToMany",
    referenceName: fromSideRefName,
    join: isOwningSide, // Use the explicitly determined owning side
    biDirectional: isEffectivelyBiDirectional,
    joinTableName: isOwningSide ? (relationship.joinTableName || undefined) : undefined, // Use current def details if owner
    joinColumnName: isOwningSide ? (relationship.joinColumnName || undefined) : undefined,
    inverseJoinColumnName: isOwningSide ? (relationship.inverseJoinColumnName || undefined) : undefined,
    inverseReferenceName: isEffectivelyBiDirectional ? toSideRefName : undefined, // Only add inverse name if bidirectional
  };

  const response: RelationshipMap = {
    [relationship.from]: [fromSideRelationship],
  };

  // If bidirectional, add the inverse relationship definition to the map
  if (isEffectivelyBiDirectional) {
    // Calculate the property name for the inverse side
    // If inversePropertyName (from inverse to_name) exists, use it, else default based on 'from' entity
    // const inverseSideReferenceName = inversePropertyName || pluralize(camelCase(relationship.from)); << Old way

    // Determine if the inverse side is the owning side
    const isInverseOwningSide = !isOwningSide;

    const toSideRelationship: Relationship = {
      name: relationship.from, // The entity name on the other side
      type: "ManyToMany",
      referenceName: toSideRefName, // Use calculated name
      join: isInverseOwningSide, // Use the explicitly determined inverse owning side
      biDirectional: true, // It's part of a bidirectional pair
      // Add join details ONLY if the inverse side IS the owner
      joinTableName: isInverseOwningSide ? (inverseDefinition?.joinTableName || undefined) : undefined,
      joinColumnName: isInverseOwningSide ? (inverseDefinition?.joinColumnName || undefined) : undefined,
      inverseJoinColumnName: isInverseOwningSide ? (inverseDefinition?.inverseJoinColumnName || undefined) : undefined,
      inverseReferenceName: fromSideRefName, // The reference name of the other side
    };

    response[relationship.to] = [
        ...(response[relationship.to] || []), // Ensure array exists and merge
        toSideRelationship
    ];
  }

  return response;
};

/**
 * Helper function to create the Relationship object for the 'from' side of a OneToOne definition.
 * Determines the owning side (@JoinColumn).
 * @param relationship The .apsorc relationship definition.
 * @param inverseDefinition The found inverse definition, if any.
 * @returns The Relationship object for the 'from' side.
 */
const createFromOneToOneRelationship = (
  relationship: ApsorcRelationship,
  inverseDefinition: ApsorcRelationship | undefined
): Relationship => {
  // Determine owner side: if bidirectional, the side *without* to_name is owner.
  // If not bidirectional, the 'from' side is always the owner.
  const isOwner = relationship.bi_directional ? !relationship.to_name : true;
  return {
    name: relationship.to,
    type: "OneToOne",
    join: isOwner,
    nullable: relationship.nullable || false,
    referenceName: relationship.to_name || relationship.to.toLowerCase(),
    biDirectional: relationship.bi_directional || false,
    inverseReferenceName: inverseDefinition?.to_name || relationship.from.toLowerCase(),
  };
};

/**
 * Helper function to create the Relationship object for the 'to' side of a bidirectional OneToOne definition.
 * @param relationship The original .apsorc relationship definition.
 * @param inverseDefinition The inverse definition (assumed to exist).
 * @param isOwner Indicates if the 'from' side was determined to be the owner.
 * @returns The Relationship object for the 'to' side.
 */
const createToOneToOneRelationship = (
  relationship: ApsorcRelationship,
  inverseDefinition: ApsorcRelationship, // Assumed to exist if this is called
  isOwner: boolean // Is the 'from' side the owner?
): Relationship => {
  return {
    name: relationship.from,
    type: "OneToOne",
    biDirectional: true,
    join: !isOwner,
    referenceName: inverseDefinition.to_name || relationship.from.toLowerCase(),
    inverseReferenceName: relationship.to_name || relationship.to.toLowerCase(),
  };
};

/**
 * Parses a single relationship definition from .apsorc.
 * Dispatches to the appropriate type-specific parser (parseManyToMany, parseOneToMany, etc.).
 * For bidirectional relationships, the type-specific parsers handle generating data for both sides.
 * @param relationship The single .apsorc relationship definition to parse.
 * @param allRelationships The full list of relationship definitions (needed for context, e.g., finding inverses).
 * @returns A RelationshipMap, potentially containing entries for both entities involved in the relationship.
 */
export const parseRelationship = (
  relationship: ApsorcRelationship,
  allRelationships: ApsorcRelationship[]
): RelationshipMap => {
  if (relationship.type === "ManyToMany") {
    return parseManyToMany(relationship, allRelationships);
  }

  switch (relationship.type) {
    case "OneToMany": {
        const fromSideRefName = relationship.to_name || (relationship.to.toLowerCase() + 's');
        const toSideRefName = relationship.from.toLowerCase(); // Default singular name for the inverse side
        return {
         [relationship.from]: [{ name: relationship.to, type: "OneToMany", biDirectional: true, referenceName: fromSideRefName, inverseReferenceName: toSideRefName }],
         [relationship.to]: [{ name: relationship.from, type: "ManyToOne", nullable: relationship.nullable || false, biDirectional: true, index: relationship.index || false, cascadeDelete: relationship.cascadeDelete || false, referenceName: toSideRefName, inverseReferenceName: fromSideRefName }],
       };
    }
    case "ManyToOne":
       return {
         [relationship.from]: [{ name: relationship.to, type: "ManyToOne", referenceName: relationship.to_name || relationship.to.toLowerCase(), nullable: relationship.nullable || false, index: relationship.index || false }],
       };
    case "OneToOne": {
      const inverseOnetoOneDef = allRelationships.find(
        (def) =>
          def.from === relationship.to &&
          def.to === relationship.from &&
          def.type === "OneToOne"
      );
      // Determine bidirectionality based on current flag or inverse flag
      const isEffectivelyBiDirectional = Boolean(
        relationship.bi_directional || inverseOnetoOneDef?.bi_directional
      );

      // Create the relationship for the 'from' side
      const fromRel = createFromOneToOneRelationship(relationship, inverseOnetoOneDef);
      const responseMap: RelationshipMap = { [relationship.from]: [fromRel] };

      // If it's effectively bidirectional, create and add the relationship for the 'to' side
      if (isEffectivelyBiDirectional) {
        // Need the inverse definition to exist to correctly create the inverse side
        if (inverseOnetoOneDef) {
           const isFromSideOwner = fromRel.join || false; // Determine owner from the created 'from' side
           const toRel = createToOneToOneRelationship(relationship, inverseOnetoOneDef, isFromSideOwner);
           responseMap[relationship.to] = [
             ...(responseMap[relationship.to] || []), // Ensure array exists
             toRel,
           ];
        } else {
            // Handle the edge case where one side declares bidirectional but the inverse definition is missing
            // We still need to add *something* for the inverse side, likely without join/owner info
            console.warn(`[APSO WARNING] Bidirectional OneToOne defined for ${relationship.from} -> ${relationship.to}, but inverse definition ${relationship.to} -> ${relationship.from} is missing. Inverse side generation may be incomplete.`);
            const fallbackToRel: Relationship = {
                name: relationship.from,
                type: "OneToOne",
                biDirectional: true,
                join: !(fromRel.join || false), // Assume inverse of from side owner status
                referenceName: relationship.from.toLowerCase(), // Fallback default name
                inverseReferenceName: fromRel.referenceName || undefined // Reference the 'from' side's name, default to undefined if null
            };
            responseMap[relationship.to] = [
                 ...(responseMap[relationship.to] || []), // Ensure array exists
                 fallbackToRel,
            ];
        }
      }
      return responseMap;
    }
  }

  // Fallback / Error case?
  console.error(`[APSO ERROR] Unknown relationship type: ${relationship.type}`);
  return {};
};

/**
 * Parses the entire array of relationship definitions from the .apsorc file.
 * Iterates through each definition, calls parseRelationship, and merges the results.
 * @param relationships The array of relationship definitions from .apsorc.
 * @returns A comprehensive RelationshipMap mapping entity names to their Relationship objects.
 */
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

/**
 * Calculates the final property name on the inverse side of a relationship.
 * Used by the entity template for the TypeORM decorator's inverse side function.
 * Handles self-referencing cases and defaults.
 * @param relationship The Relationship object for the current side.
 * @param entityName The name of the entity for the current side.
 * @param relationshipName The camelCased property name for the current side.
 * @param needsPluralInverse Whether the inverse property name should be plural.
 * @returns The calculated inverse property name.
 */
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

/**
 * Transforms the parsed Relationship data into the final format needed by the entity/controller templates.
 * Calculates additional helper properties like pluralized names and inverse property names.
 * @param entityName The name of the entity for which to generate template data.
 * @param relationships An array of Relationship objects for the given entity.
 * @returns An array of RelationshipForTemplate objects with extra properties for the template.
 */
export const getRelationshipForTemplate = (
  entityName: string,
  relationships: Relationship[]
): RelationshipForTemplate[] => {
  if (!relationships) {
    return [];
  }

  // More comprehensive deduplication to handle all duplicate cases
  const dedupedRelationships: Relationship[] = [];
  const processedRefs = new Map<string, Relationship>();
  
  // First pass: Group by name and referenceName (more specific)
  relationships.forEach((relationship: Relationship) => {
    const name = relationship.name;
    const refName = relationship.referenceName || "default";
    const key = `${name}:${refName}`;
    
    // Use the relationship with join=true if there are duplicates (this is the owning side)
    if (!processedRefs.has(key) || (relationship.join && !processedRefs.get(key)?.join)) {
      processedRefs.set(key, relationship);
    }
  });
  
  // Second pass: Use name-only as a fallback for edge cases
  // This helps with ManyToMany cases where both sides exist with different join flags
  const nameOnlyKeys = new Set<string>();
  processedRefs.forEach((rel) => {
    if (!nameOnlyKeys.has(rel.name)) {
      nameOnlyKeys.add(rel.name);
      dedupedRelationships.push(rel);
    } else if (rel.join === true) {
      // If we already have this name but the current one is the owner (join=true), 
      // replace the existing one
      const existingIdx = dedupedRelationships.findIndex(r => r.name === rel.name);
      if (existingIdx !== -1 && !dedupedRelationships[existingIdx].join) {
        dedupedRelationships[existingIdx] = rel;
      }
    }
  });

  return dedupedRelationships.map((relationship: Relationship) => {
    const thisReferenceName = relationship.referenceName;
    const relationshipName = camelCase(thisReferenceName || relationship.name);
    const needsPluralInverse = relationship.type === 'ManyToOne' || relationship.type === 'ManyToMany';

    const inverseSidePropertyName = calculateInversePropertyName(
      relationship,
      entityName,
      relationshipName,
      needsPluralInverse
    );

    if (relationship.biDirectional && !relationship.inverseReferenceName && 
        (relationship.type === 'ManyToMany' || relationship.type === 'OneToMany' || relationship.type === 'OneToOne')) {
      console.info(`[APSO INFO] Using default property name '${inverseSidePropertyName}' for ${relationship.name}->${entityName}. To customize, add 'to_name' in your relationship definition.`);
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
      inverseSidePropertyName,
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
