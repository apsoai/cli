import * as path from "path";
import pluralize from "pluralize";
import * as Eta from "eta";

import { Entity } from "./types/entity";
import { ComputedField } from "./types/field";
import { getFieldForTemplate, typeExistsInEntity } from "./utils/field";
import {
  getRelationshipForTemplate,
  getRelationshipsForImport,
} from "./utils/relationships";
import { Relationship } from "./types";
import { camelCase, snakeCase } from "./utils/casing";
import { createFile } from "./utils/file-system";

export const createGqlDTO = async (
  apiBaseDir: string,
  entity: Entity,
  relationshipsNew: Relationship[]
): Promise<void> => {
  const { name, fields = [], indexes } = entity;
  const Dir = path.join(apiBaseDir, "dtos");
  const File = path.join(Dir, `${name}.dto.ts`);

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
    createPrimaryKey,
    snakeCasedName: snakeCase(name),
    createdAt,
    updatedAt,
    pluralizedName: camelCase(pluralize(name)),
    columns,
    associations: relationships,
    entitiesToImport,
    importEnums: typeExistsInEntity(entity, "enum") !== -1,
  };

  const contentEntity: any = await Eta.renderFileAsync(
    "./graphql/gql-dto-graphql",
    data
  );
  await createFile(File, contentEntity);
};
