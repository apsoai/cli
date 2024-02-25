import * as Eta from "eta";
import * as path from "path";
import pluralize from "pluralize";

import { createFile } from "./utils/file-system";
import { camelCase, snakeCase } from "./utils/casing";
import { ComputedField, Entity, Relationship } from "./types";
import { getFieldForTemplate, typeExistsInEntity } from "./utils/field";
import {
  getRelationshipForTemplate,
  getRelationshipsForImport,
} from "./utils/relationships";

export const createEntity = async (
  apiBaseDir: string,
  entity: Entity,
  relationshipsNew: Relationship[],
  apiType: string
): Promise<void> => {
  const { name, fields = [], indexes, uniques } = entity;
  const File = path.join(apiBaseDir, `${name}.entity.ts`);
  console.log("ENTITY: ", name)
  console.log("INDEXES: ", indexes); 
  const columns = getFieldForTemplate(fields, name);

  const createPrimaryKey =
    columns.filter((column: ComputedField) => column.primary === true)
      .length === 0;

  const createdAt = entity.created_at;
  const updatedAt = entity.updated_at;

  const relationships = getRelationshipForTemplate(name, relationshipsNew);
  const entitiesToImport = getRelationshipsForImport(name, relationships);

  const data = {
    name,
    indexes: indexes || [],
    uniques: uniques || [],
    createPrimaryKey,
    snakeCasedName: snakeCase(name),
    createdAt,
    updatedAt,
    pluralizedName: pluralize(camelCase(name)),
    columns,
    associations: [...new Set(relationships)],
    entitiesToImport,
    importEnums: typeExistsInEntity(entity, "enum") !== -1,
    apiType,
  };

  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./entities/entity", data);

  createFile(File, content);
};
