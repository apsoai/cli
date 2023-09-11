import * as Eta from "eta";
import * as path from "path";
import pluralize from "pluralize";

import { createFile } from "./utils/file-system";
import { camelCase, snakeCase } from "./utils/casing";
import { ComputedField, Entity, Relationship } from "./types";
import { getFieldForTemplate } from "./utils/field";
import {
  getRelationshipForTemplate,
  getRelationshipsForImport,
} from "./utils/relationships";

export const createEntity = async (
  apiBaseDir: string,
  entity: Entity,
  relationshipsNew: Relationship[]
): Promise<void> => {
  const { name, fields = [] } = entity;
  const File = path.join(apiBaseDir, `${name}.entity.ts`);

  const columns = getFieldForTemplate(fields);

  const createPrimaryKey =
    columns.filter((column: ComputedField) => column.primary === true)
      .length === 0;

  const createdAt = entity.created_at;
  const updatedAt = entity.updated_at;

  const relationships = getRelationshipForTemplate(name, relationshipsNew);
  const entitiesToImport = getRelationshipsForImport(
    entity.name,
    relationships
  );

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
    entitiesToImport,
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
