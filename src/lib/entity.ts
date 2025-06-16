import * as path from "path";
import { createFile } from "./utils/file-system";
import { Entity, Field, Relationship } from "./types";
import { typeExistsInEntity, getFieldForTemplate } from "./utils/field";
import { getRelationshipsForImport, getRelationshipForTemplate } from "./utils/relationships";
import { snakeCase, camelCase } from "./utils/casing";
import pluralize from "pluralize";
import * as Eta from "eta";

/**
 * Generates a TypeORM entity file based on the entity definition and relationships.
 *
 * @param apiBaseDir The base directory for the generated API module (e.g., 'src/autogen/users').
 * @param entity The entity definition object from the parsed .apsorc.
 * @param relationshipsNew An array of processed Relationship objects for this entity.
 * @param apiType The type of API being generated (e.g., "rest", "graphql").
 * @returns {Promise<void>} A promise that resolves when the entity file is created.
 */
export const createEntity = async (
  apiBaseDir: string,
  entity: Entity,
  relationshipsNew: Relationship[],
  apiType: string
): Promise<void> => {
  const { name, fields = [], indexes, uniques } = entity;
  const File = path.join(apiBaseDir, `${name}.entity.ts`);
  const columns = getFieldForTemplate(fields, name);

  const createPrimaryKey =
    columns.filter((column: Field) => column.primary === true)
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
    pluralizedName: camelCase(pluralize(name)),
    columns,
    associations: [...new Set(relationships)],
    entitiesToImport,
    importEnums: typeExistsInEntity(entity, "enum") !== -1,
    apiType,
  };

  const templatePath = apiType === "graphql" ? "./graphql/gql-entity-graphql" : "./entities/entity";

  const content: any = await Eta.renderFileAsync(templatePath, data);

  await createFile(File, content);
};
