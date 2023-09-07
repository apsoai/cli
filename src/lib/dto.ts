import * as Eta from "eta";
import * as path from "path";

import { createFile } from "./utils/file-system";
import { Entity, Field, Relationship } from "./types";
import { fieldToEnumType, getJsTypeFromFieldType } from "./utils/field";
import { getRelationshipIdField } from "./utils/relationships";
import { EnumType } from "./enums";

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
      dataType:
        field.type === "enum"
          ? fieldToEnumType(field.name)
          : getJsTypeFromFieldType(field.type),
    })),
    ...relationshipFields.map((fieldName) => ({
      name: fieldName,
      dataType: "number",
    })),
  ];

  const enumTypes: EnumType[] = fields
    .filter((field: Field) => field.type === "enum")
    .map((field: Field) => ({
      name: fieldToEnumType(field.name),
      values: field.values,
    }));

  const createPrimaryKey =
    columns.filter((column: ComputedField) => column.primary === true)
      .length === 0;

  const createdAt = entity.created_at;
  const updatedAt = entity.updated_at;
  const data = {
    name: entity.name,
    createPrimaryKey,
    createdAt,
    updatedAt,
    columns,
    enumTypes,
  };

  Eta.configure({
    // This tells Eta to look for templates
    // In the /templates directory
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./dto", data);

  //   if (fs.existsSync(File)) {
  //     return
  //   }

  createFile(File, content);
};
