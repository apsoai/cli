import * as path from "path";
import { createFile } from "./utils/file-system";
import { Entity, Field } from "./types";
import { fieldToEnumType } from "./utils/field";
import * as Eta from "eta";

export interface EnumType {
  name: string;
  values?: string[];
}

export const createEnums = async (
  apiBaseDir: string,
  entities: Entity[],
  apiType: string
) => {
  if (entities.length > 0) {
    const outputFile = path.join(apiBaseDir, "enums.ts");
    const allEnumsFields = entities
      .flatMap((entity) =>
        (entity.fields || []).map((field: Field) => {
          if (field.type === "enum") {
            return { ...field, name: fieldToEnumType(field.name, entity.name) };
          }
          return null;
        })
      )
      .filter(Boolean);

    if (allEnumsFields.length > 0) {
      const content: any = await Eta.renderFileAsync(
        `./${apiType}/enums-${apiType}`,
        {
          allEnumsFields,
        }
      );
      await createFile(outputFile, content);
    }
  }
};
