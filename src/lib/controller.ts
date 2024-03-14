import * as Eta from "eta";
import * as path from "path";
import { createFile } from "./utils/file-system";
import { Entity, RelationshipMap } from "./types";
import {
  getRelationshipForTemplate,
  getNestedRelationships,
} from "./utils/relationships";

export const createController = async (
  apiBaseDir: string,
  entity: Entity,
  relationshipMap: RelationshipMap
): Promise<void> => {
  const { name: entityName } = entity;
  const File = path.join(apiBaseDir, `${entityName}.controller.ts`);
  const testFile = path.join(apiBaseDir, `${entityName}.controller.spec.ts`);

  // Dependencies
  const svcName = `${entityName}Service`;
  const ctrlName = `${entityName}Controller`;
  const pluralEntityName = `${entityName}s`;

  const relationships = getRelationshipForTemplate(
    entityName,
    relationshipMap[entityName]
  );

  const nestedRelationships = getNestedRelationships(
    entityName,
    relationshipMap
  );

  const data = {
    svcName,
    ctrlName,
    entityName,
    pluralEntityName,
    // ensure uniqueness
    associations: [...new Set(relationships)],
    nestedAssociations: [...new Set(nestedRelationships)],
  };

  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync(
    "./rest/controller-rest",
    data
  );

  createFile(File, content);

  const testContent: any = await Eta.renderFileAsync(
    "./rest/controller-rest-spec",
    data
  );

  createFile(testFile, testContent);
};
