import * as Eta from "eta";
import * as path from "path";

import { createFile, withGeneratedMeta } from "./utils/file-system";
import { Entity } from "./types/entity";
import { ComputedField } from "./types/field";
import { getFieldForTemplate, typeExistsInEntity } from "./utils/field";
import { getRelationshipForTemplate } from "./utils/relationships";
import { camelCase, pascalCase } from "./utils/casing";

/**
 * Generates Data Transfer Object (DTO) files (create and update) for a given entity.
 *
 * @param apiBaseDir The base directory for the generated API module (e.g., 'src/autogen/users').
 * @param entity The entity definition object from the parsed .apsorc.
 * @param relationships The relationships array from the parsed .apsorc.
 * @param options Optional configuration flags.
 * @param options.apiType The type of API being generated (default: "rest").
 * @param options.allEntities Optional array of all entities, used to determine foreign key types.
 * @returns {Promise<void>} A promise that resolves when the DTO files are created.
 */
export const createDto = async (
  apiBaseDir: string,
  entity: Entity,
  relationships: any[], // Relationship[]
  options?: { apiType?: string; allEntities?: Entity[] }
): Promise<void> => {
  const { name: entityName, fields = [] } = entity;
  const dtoDir = path.join(apiBaseDir, "dtos");
  const dtoFile = path.join(dtoDir, `${entityName}.dto.ts`);

  const columns = getFieldForTemplate(fields, entityName);
  const relationshipsTemplate = getRelationshipForTemplate(
    entityName,
    relationships
  );

  // if (process.env.DEBUG) {
  //   console.log('[DTO DEBUG] Generating DTO for:', entityName);
  //   console.log('[DTO DEBUG] relationshipsTemplate:', relationshipsTemplate);
  // }
  // Add foreign key columns for ManyToOne relationships if not present
  relationshipsTemplate.forEach(rel => {
    if (rel.type === 'ManyToOne') {
      const fkName = camelCase(rel.referenceName || rel.name) + 'Id';

      // Look up the referenced entity to determine the foreign key type
      const referencedEntity = options?.allEntities?.find(e => e.name === rel.name);
      const referencedPrimaryKeyType = referencedEntity?.primaryKeyType || 'serial';
      const fkDataType = referencedPrimaryKeyType === 'uuid' ? 'string' : 'number';
      const fkType = referencedPrimaryKeyType === 'uuid' ? 'uuid' : 'integer';

      // if (process.env.DEBUG) {
      //   console.log('[DTO DEBUG]', {
      //     relType: rel.type,
      //     relName: rel.name,
      //     referenceName: rel.referenceName,
      //     fkName,
      //     referencedPrimaryKeyType,
      //     fkDataType,
      //     columns: columns.map(c => c.name)
      //   });
      // }
      if (!columns.some(col => col.name === fkName)) {
        columns.push({
          name: fkName,
          dataType: fkDataType,
          type: fkType,
        });
      }
    }
  });

  const primaryKeyColumns = columns.filter(
    (column: ComputedField) => column.primary === true
  );
  const addDefaultPKProperty = primaryKeyColumns.length === 0;

  const createdAt = entity.created_at;
  const updatedAt = entity.updated_at;
  const primaryKeyType = entity.primaryKeyType || 'serial'; // Default to 'serial' if not specified

  // Filter columns: remove id, createdAt, updatedAt
  const dtoColumns = columns.filter(
    (col: ComputedField) =>
      !["id", "createdAt", "updatedAt"].includes(col.name)
  );

  // Class names
  const createDtoName = `Create${pascalCase(entityName)}Dto`;
  const updateDtoName = `Update${pascalCase(entityName)}Dto`;

  const data = {
    entityName,
    addDefaultPKProperty,
    primaryKeyType,
    createdAt,
    updatedAt,
    columns: dtoColumns,
    associations: relationshipsTemplate,
    createDtoName,
    updateDtoName,
    apiType: options?.apiType ?? "rest", // default to rest if not provided
    importEnums: typeExistsInEntity(entity, "enum") !== -1,
  };

  // Render the unified template only once
  const dtoContent: any = await Eta.renderFileAsync("./rest/dto-rest", withGeneratedMeta(data));

  // Create only one DTO file
  await createFile(dtoFile, dtoContent);
};
