import * as Eta from "eta";
import * as path from "path";

import { createFile } from "./utils/file-system";
import { Entity } from "./types/entity";
import { ComputedField } from "./types/field";
import { getFieldForTemplate, typeExistsInEntity } from "./utils/field";
import { getRelationshipForTemplate } from "./utils/relationships";
import { camelCase } from "./utils/casing";

/**
 * Generates Data Transfer Object (DTO) files (create and update) for a given entity.
 *
 * @param apiBaseDir The base directory for the generated API module (e.g., 'src/autogen/users').
 * @param entity The entity definition object from the parsed .apsorc.
 * @param options Optional configuration flags.
 * @param options.apiType The type of API being generated (default: "rest").
 * @returns {Promise<void>} A promise that resolves when the DTO files are created.
 */
export const createDto = async (
  apiBaseDir: string,
  entity: Entity,
  options?: { apiType?: string }
): Promise<void> => {
  const { name: entityName, fields = [], associations } = entity;
  const dtoDir = path.join(apiBaseDir, "dto");
  const dtoFile = path.join(dtoDir, `${entityName}.dto.ts`);

  const columns = getFieldForTemplate(fields, entityName);
  const relationshipsTemplate = getRelationshipForTemplate(
    entityName,
    associations || []
  );

  const primaryKeyColumns = columns.filter(
    (column: ComputedField) => column.primary === true
  );
  const addDefaultPKProperty = primaryKeyColumns.length === 0;

  const createdAt = entity.created_at;
  const updatedAt = entity.updated_at;

  // Filter columns: remove id, createdAt, updatedAt
  const dtoColumns = columns.filter(
    (col: ComputedField) =>
      !["id", "createdAt", "updatedAt"].includes(col.name)
  );

  // Class names
  const createDtoName = `Create${camelCase(entityName, true)}Dto`;
  const updateDtoName = `Update${camelCase(entityName, true)}Dto`;

  const data = {
    entityName,
    addDefaultPKProperty,
    createdAt,
    updatedAt,
    columns: dtoColumns,
    associations: relationshipsTemplate,
    createDtoName,
    updateDtoName,
    apiType: options?.apiType ?? "rest", // default to rest if not provided
    importEnums: typeExistsInEntity(entity, "enum") !== -1,
  };

  // Configure Eta
  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  // Render the unified template only once
  const dtoContent: any = await Eta.renderFileAsync("./rest/dto-rest", data);

  // Create only one DTO file
  createFile(dtoFile, dtoContent);
};
