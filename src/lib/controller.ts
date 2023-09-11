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
    associations: relationships,
    nestedAssociations: nestedRelationships,
  };

  Eta.configure({
    // This tells Eta to look for templates
    // In the /templates directory
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./controller", data);

  //   if (fs.existsSync(File)) {
  //     return
  //   }

  createFile(File, content);
};
