import { createFile, camelCase } from "./util";
import * as Eta from "eta";
import * as path from "path";
import { Entity, Association, ComputedAssociation } from "./entity";
import * as pluralize from "pluralize";

export const createController = async (
  apiBaseDir: string,
  entity: Entity
): Promise<void> => {
  const { name: entityName, associations = [] } = entity;
  const File = path.join(apiBaseDir, `${entityName}.controller.ts`);
  // Dependencies
  const svcName = `${entityName}Service`;
  const ctrlName = `${entityName}Controller`;
  const pluralEntityName = `${entityName}s`;

  const relationships: ComputedAssociation[] = associations.map(
    (association: Association) => ({
      ...association,
      camelCasedName: camelCase(association.name),
      entityName: camelCase(entityName),
      pluralizedName: pluralize(camelCase(association.name)),
      joinTable: association.join_table || false,
    })
  );
  const data = {
    svcName,
    ctrlName,
    entityName,
    pluralEntityName,
    associations: relationships,
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
