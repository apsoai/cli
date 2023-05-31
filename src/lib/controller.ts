import { createFile, camelCase } from "./util";
import * as Eta from "eta";
import * as path from "path";
import { Entity, Association, ComputedAssociation } from "./entity";
import * as pluralize from "pluralize";

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

  const relationships: ComputedAssociation[] = associations.map(
    (association: Association) => ({
      ...association,
      camelCasedName: camelCase(association.name),
      entityName: camelCase(entityName),
      pluralizedName: pluralize(camelCase(association.name)),
      joinTable: association.join_table || false,
    })
  );

  const nestedRelationships: any[] = associations.flatMap(
    (association: Association) => {
      const { name: associationName, type } = association;
      const associatedModel = entities.find(
        (entity) => entity.name === associationName
      );
      return associatedModel?.associations
        ?.map((association: Association) => {
          const { name: childAssociationName, type: childType } = association;

          if (childAssociationName !== entityName) {
            const parent =
              type === "ManyToOne" || type === "OneToOne"
                ? camelCase(associationName)
                : pluralize(camelCase(associationName));
            const child =
              childType === "ManyToOne" || childType === "OneToOne"
                ? camelCase(childAssociationName)
                : pluralize(camelCase(childAssociationName));
            return `${parent}.${child}`;
          }

          return null;
        })
        .filter((e) => e);
    }
  );

  console.log(JSON.stringify(nestedRelationships));

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
