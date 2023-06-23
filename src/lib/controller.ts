import * as Eta from "eta";
import * as path from "path";
import { createFile } from "./util";
import { Entity } from "./types/entity";
import {
  getAssociationForTemplate,
  getNestedRelationships,
} from "./types/relationship";

export const createController = async (
  apiBaseDir: string,
  entity: Entity,
  entities: Entity[]
): Promise<void> => {
  const { name: entityName, associations = [] } = entity;
  const File = path.join(apiBaseDir, `${entityName}.controller.ts`);
  // Dependencies
  const svcName = `${entityName}Service`;
  const ctrlName = `${entityName}Controller`;
  const pluralEntityName = `${entityName}s`;

  const relationships = getAssociationForTemplate(
    entityName,
    associations,
    entities
  );
  const nestedRelationships = getNestedRelationships(
    entityName,
    entities,
    associations
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
