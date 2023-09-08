import * as Eta from "eta";
import * as path from "path";
import { createFile } from "./utils/file-system";
import { Entity, Field } from "./types";
import { fieldToEnumType } from "./utils/field";

export interface EnumType {
  name: string;
  values?: string[];
}

export const createEnums = async (
  apiBaseDir: string,
  entities: Entity[],
  isGql: boolean
) => {
  if (entities.length > 0) {
    const outputFile = path.join(apiBaseDir, "enums.ts");
    const uniqueEnumNames: string[] = [];
    const allEnumsFields = entities
      .flatMap((entity) =>
        (entity.fields || []).map((field: Field) => {
          if (field.type === "enum" && !uniqueEnumNames.includes(field.name)) {
            uniqueEnumNames.push(field.name);
            return { ...field, name: fieldToEnumType(field.name) };
          }
          return null;
        })
      )
      .filter(Boolean);

    if (allEnumsFields.length > 0) {
      Eta.configure({
        views: path.join(__dirname, "templates"),
      });

      const content: any = await Eta.renderFileAsync("./enums", {
        allEnumsFields,
        isGql,
      });
      createFile(outputFile, content);
    }
  }
};
