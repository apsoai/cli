import * as Eta from "eta";
import * as path from "path";

import { createFile } from "./utils/file-system";
import { Entity, Field, Relationship } from "./types";
import {
  fieldToEnumType,
  getJsTypeFromFieldType,
  typeExistsInEntity,
} from "./utils/field";
import { getRelationshipIdField } from "./utils/relationships";

export interface ComputedField {
  name: string;
  primary?: boolean;
  dataType: string;
}

export const createDto = async (
  apiBaseDir: string,
  entity: Entity,
  relationships: Relationship[]
): Promise<void> => {
  const { name, fields = [] } = entity;
  const Dir = path.join(apiBaseDir, "dtos");
  const File = path.join(Dir, `${name}.dto.ts`);

  const relationshipFields = relationships
    .filter((relationship) => relationship.type === "ManyToOne")
    .map((relationship) => getRelationshipIdField(relationship));

  const columns: ComputedField[] = [
    ...fields.map((field: Field) => ({
      name: field.name,
      type: field.type,
      primary: field.primary,
      dataType:
        field.type === "enum"
          ? fieldToEnumType(field.name, name)
          : getJsTypeFromFieldType(field.type),
    })),
    ...relationshipFields.map((fieldName) => ({
      name: fieldName,
      dataType: "number",
    })),
  ];

  const primaryKeyColumns = columns.filter(
    (column: ComputedField) => column.primary === true
  );
  const addDefaultPKProperty = primaryKeyColumns.length === 0;

  const createdAt = entity.created_at;
  const updatedAt = entity.updated_at;
  const data = {
    name: entity.name,
    addDefaultPKProperty,
    createdAt,
    updatedAt,
    columns,
    importEnums: typeExistsInEntity(entity, "enum") !== -1,
  };

  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./rest/dto-rest", data);

  createFile(File, content);
};
