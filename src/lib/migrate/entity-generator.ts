/**
 * Sandbox Entity Generator Types
 *
 * Provides the input type for the migration sandbox.
 */

import { Entity } from "../types/entity";
import { RelationshipMap } from "../types/relationship";

/**
 * Subset of ParsedApsorc needed for migration sandbox operations.
 */
export interface EntityGeneratorInput {
  entities: Entity[];
  relationshipMap: RelationshipMap;
}
