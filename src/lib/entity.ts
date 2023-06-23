import * as Eta from "eta";
import * as path from "path";
import * as pluralize from "pluralize";

import { createFile, camelCase, snakeCase } from "./util";
import { Entity } from "./types/entity";
import { ComputedField, getFieldForTemplate } from "./types/field";
import { getAssociationForTemplate } from "./types/relationship";

export const createEntity = async (
  apiBaseDir: string,
  entity: Entity,
  entities: Entity[]
): Promise<void> => {
  const { name, fields = [], associations = [] } = entity;
  const File = path.join(apiBaseDir, `${name}.entity.ts`);

  const columns = getFieldForTemplate(fields);

  const createPrimaryKey =
    columns.filter((column: ComputedField) => column.primary === true)
      .length === 0;

  const createdAt = entity.created_at;
  const updatedAt = entity.updated_at;

  const relationships = getAssociationForTemplate(name, associations, entities);

  const data = {
    name: entity.name,
    indexes: entity.indexes || [],
    createPrimaryKey,
    snakeCasedName: snakeCase(entity.name),
    createdAt,
    updatedAt,
    pluralizedName: pluralize(camelCase(entity.name)),
    columns,
    associations: relationships,
  };

  Eta.configure({
    // This tells Eta to look for templates
    // In the /templates directory
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./entity", data);

  //   if (fs.existsSync(File)) {
  //     return
  //   }

  createFile(File, content);
};
