/* eslint-disable complexity */
import pluralize from "pluralize";
import { camelCase } from "../casing";
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
    [relationship.from]: [{ name: relationship.to, type: "OneToMany", biDirectional: true, referenceName: relationship.to_name || relationship.to, inverseReferenceName: relationship.from }],
    [relationship.to]: [{ name: relationship.from, type: "ManyToOne", nullable: relationship.nullable || false, biDirectional: true, index: relationship.index || false, cascadeDelete: relationship.cascadeDelete || false, referenceName: relationship.from, inverseReferenceName: relationship.to_name || relationship.to }],
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
  const currentPropertyName = relationship.to_name || camelCase(pluralize(relationship.to));
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
  const fromSideRefName = relationship.to_name || relationship.to;
  const toSideRefName = inverseDefinition?.to_name || relationship.from;

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
    referenceName: relationship.to_name || relationship.to,
    biDirectional: relationship.bi_directional || false,
    inverseReferenceName: inverseDefinition?.to_name || relationship.from,
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
    referenceName: inverseDefinition.to_name || relationship.from,
    inverseReferenceName: relationship.to_name || relationship.to,
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
        const fromSideRefName = relationship.to_name || relationship.to;
        const toSideRefName = relationship.from;
        return {
         [relationship.from]: [{ name: relationship.to, type: "OneToMany", biDirectional: true, referenceName: fromSideRefName, inverseReferenceName: toSideRefName }],
         [relationship.to]: [{ name: relationship.from, type: "ManyToOne", nullable: relationship.nullable || false, biDirectional: true, index: relationship.index || false, cascadeDelete: relationship.cascadeDelete || false, referenceName: toSideRefName, inverseReferenceName: fromSideRefName }],
       };
    }
    case "ManyToOne":
       return {
         [relationship.from]: [{ name: relationship.to, type: "ManyToOne", referenceName: relationship.to_name || relationship.to, nullable: relationship.nullable || false, index: relationship.index || false }],
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
                referenceName: relationship.from, // Fallback default name
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

  // First pass: Group by name and referenceName (more specific)
  const processedRefs = new Map<string, Relationship>();
  relationships.forEach((relationship: Relationship) => {
    const name = relationship.name;
    const refName = relationship.referenceName || "default";
    const key = `${name}:${refName}`;
    // Use the relationship with join=true if there are duplicates (this is the owning side)
    if (!processedRefs.has(key) || (relationship.join && !processedRefs.get(key)?.join)) {
      processedRefs.set(key, relationship);
    }
  });

  // Only deduplicate by name+referenceName, not just name
  return [...processedRefs.values()].map((relationship: Relationship) => {
    const thisReferenceName = relationship.referenceName;
    const relationshipName = camelCase(thisReferenceName || relationship.name);
    const needsPluralInverse = relationship.type === 'ManyToOne' || relationship.type === 'ManyToMany';

    // DEBUG LOGGING
    // if (process.env.DEBUG) {
    //   console.log(
    //     '[DEBUG] relationship.name:', relationship.name,
    //     '| relationship.referenceName:', relationship.referenceName,
    //     '| thisReferenceName:', thisReferenceName,
    //     '| pluralizedRelationshipName:', camelCase(pluralize(thisReferenceName || relationship.name)),
    //     '| pluralizedName:', camelCase(pluralize(relationship.name))
    //   );
    // }

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
      pluralizedRelationshipName: camelCase(pluralize(thisReferenceName || relationship.name)),
      pluralizedName: camelCase(pluralize(relationship.name)),
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

/**
 * Generates all valid nested join paths for an entity, avoiding cycles and redundant paths.
 * 
 * Requirements enforced:
 * 1. No cycles by tracking visited (entity, reference) pairs in the current path
 * 2. Allow the same entity with different references (proper name vs alias)
 * 3. Allow different aliases to the same entity in different branches
 * 4. Respect max depth limit
 * 
 * @param entityName - Current entity to generate relationships from
 * @param relationshipMap - Map of all entity relationships
 * @param maxDepth - Maximum depth of nested joins (default: 6)
 * @param path - Current join path being built (internal use)
 * @param visitedPairs - Set of (entity, reference) pairs visited in current path (internal use)
 * @param baseEntity - The root entity we started from (internal use)
 * @returns Generator yielding valid join path strings
 */
interface GenerateNestedRelationshipsOptions {
  entityName: string;
  relationshipMap: RelationshipMap;
  maxDepth?: number;
  path?: string[];
  visitedPairs?: Set<string>;
  baseEntity?: string;
}

export function* generateNestedRelationships(options: GenerateNestedRelationshipsOptions): Generator<string> {
  const {
    entityName,
    relationshipMap,
    maxDepth = 4,
    path = [],
    visitedPairs = new Set(),
    baseEntity = entityName
  } = options;
  // Stop if we've reached maximum depth
  if (path.length >= maxDepth) return;

  // Get relationships for the current entity
  const relationships = relationshipMap[entityName];
  if (!relationships) return;

  for (const relationship of relationships) {
    const referenceName = getRelationshipName(relationship);
    const type = relationship.type;
    
    // Format the property name based on relationship type
    // OneToMany and ManyToMany relationships use plural forms
    const formattedName =
      type === "ManyToOne" || type === "OneToOne"
        ? referenceName
        : pluralize(referenceName);

    // Create a unique key for this (entity, reference) pair
    const entityReferencePair = `${relationship.name}:${referenceName}`;
    
    // Check if this exact (entity, reference) pair would create a cycle
    const wouldCreateCycle = visitedPairs.has(entityReferencePair);
    
    // Special case: prevent immediate self-reference loops (same property name)
    // But allow different properties on the same entity type
    const isImmediateSelfLoop = relationship.name === entityName && 
      path.length > 0 && 
      path[path.length - 1] === formattedName;
    
    // Skip immediate self-loops (like networkStack.networkStack)
    if (isImmediateSelfLoop) continue;
    
    // Skip cycles of the same (entity, reference) pair
    if (wouldCreateCycle) continue;
    
    // Handle base entity returns: allow functional aliases but block generic relationships
    if (relationship.name === baseEntity) {
      // Check if this is a specific functional alias (different from default entity name)
      const defaultSingularName = camelCase(relationship.name);
      const defaultPluralName = camelCase(pluralize(relationship.name));
      const originalEntityName = relationship.name;
      const isSpecificFunctionalAlias = relationship.referenceName && 
        relationship.referenceName !== defaultSingularName &&
        relationship.referenceName !== defaultPluralName &&
        relationship.referenceName !== originalEntityName &&
        relationship.referenceName !== relationship.name.toLowerCase();
      
      // Block generic returns to base entity, allow functional aliases
      if (!isSpecificFunctionalAlias) {
        continue;
      }
    }

    // Build the new path
    const newPath = [...path, formattedName];

    // Always yield the join path if it's longer than 1 level
    if (newPath.length > 1) {
      yield newPath.join(".");
    }

    // Create new visited pairs set with the current relationship pair added
    const newVisitedPairs = new Set(visitedPairs);
    newVisitedPairs.add(entityReferencePair); // Add the relationship we're about to follow

    // Recursively generate deeper nested relationships
    yield* generateNestedRelationships({
      entityName: relationship.name,
      relationshipMap,
      maxDepth,
      path: newPath,
      visitedPairs: newVisitedPairs,
      baseEntity
    });
  }
}

// In-memory collector
export function getNestedRelationships(
  entityName: string,
  relationshipMap: RelationshipMap,
  maxDepth?: number
): string[] {
  return [...generateNestedRelationships({ entityName, relationshipMap, maxDepth })];
}

// Streaming function
export async function streamNestedRelationships(
  entityName: string,
  relationshipMap: RelationshipMap,
  writable: NodeJS.WritableStream,
  maxDepth?: number
): Promise<number> {
  let count = 0;
  for (const joinPath of generateNestedRelationships({ entityName, relationshipMap, maxDepth })) {
    writable.write(`"${joinPath}": { eager: false },\n`);
    count++;
  }
  return count;
}

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
