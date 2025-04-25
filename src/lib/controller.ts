import * as Eta from "eta";
import * as path from "path";
import { createFile } from "./utils/file-system";
import { Entity, RelationshipMap } from "./types";
import {
  getRelationshipForTemplate,
  getNestedRelationships,
} from "./utils/relationships";
import pluralize from "pluralize";

/**
 * Generates NestJS controller and spec files for a given entity.
 *
 * @param apiBaseDir The base directory for the generated API module (e.g., 'src/autogen/users').
 * @param entity The entity definition object from the parsed .apsorc.
 * @param relationshipMap The complete RelationshipMap generated from parsing all relationships.
 * @returns {Promise<void>} A promise that resolves when the controller and spec files are created.
 */
export const createController = async (
  apiBaseDir: string,
  entity: Entity,
  relationshipMap: RelationshipMap
): Promise<void> => {
  const { name: entityName } = entity;
  const controllerFileName = path.join(apiBaseDir, `${entityName}.controller.ts`);
  const specFileName = path.join(apiBaseDir, `${entityName}.controller.spec.ts`);

  // Dependencies and names needed by the template
  const svcName = `${entityName}Service`;
  const ctrlName = `${entityName}Controller`;
  const pluralEntityName = pluralize(entityName);

  // Get processed relationships specific to this entity
  const relationships = getRelationshipForTemplate(
    entityName,
    relationshipMap[entityName]
  );

  // Get nested relationship paths for the @Crud join configuration
  const nestedRelationships = getNestedRelationships(
    entityName,
    relationshipMap
  );

  // Data object for the Eta template
  const data = {
    svcName,
    ctrlName,
    entityName,
    pluralEntityName,
    // Ensure uniqueness in associations (though getRelationshipForTemplate might handle this)
    associations: [...new Set(relationships)], 
    nestedAssociations: [...new Set(nestedRelationships)],
  };

  // Configure Eta
  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  // Render controller template
  const controllerContent: any = await Eta.renderFileAsync(
    "./rest/controller-rest",
    data
  );
  createFile(controllerFileName, controllerContent);

  // Render spec template
  const specContent: any = await Eta.renderFileAsync(
    "./rest/controller-rest-spec",
    data
  );
  createFile(specFileName, specContent);
};
