import { camelCase, createFile } from "./util";
import * as Eta from "eta";
import * as path from "path";

import { mapTypes, Field, Entity } from "./entity";

export interface ComputedField {
  name: string;
  dataType: string;
}

export interface EnumType {
  name: string;
  values?: string[];
}

const fieldToEnumType = (fieldName: string) =>
  `${camelCase(fieldName, true)}Enum`;

export const createDto = async (
  apiBaseDir: string,
  entity: Entity
): Promise<void> => {
  const { name, fields = [], associations = [] } = entity;
  const Dir = path.join(apiBaseDir, "dtos");
  const File = path.join(Dir, `${name}.dto.ts`);

  const relationshipFields = associations
    .filter((association) => association.type === "ManyToOne")
    .map((association) => `${camelCase(association.name)}Id`);

  console.log(relationshipFields);
  const columns: ComputedField[] = [
    ...fields.map((field: Field) => ({
      name: field.name,
      dataType:
        field.type === "enum"
          ? fieldToEnumType(field.name)
          : mapTypes(field.type),
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

  const data = {
    name: entity.name,
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
