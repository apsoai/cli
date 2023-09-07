import { fieldToEnumType } from "./utils/field";
import * as Eta from "eta";
import * as path from "path";

import { Field } from "./types/field";
import { Entity } from "./types/entity";
import { createFile } from "./utils/file-system";

export interface EnumType {
  name: string;
  values?: string[];
}

export const createEnums = async (
  apiBaseDir: string,
  entity: Entity,
  isGql: boolean
): Promise<void> => {
  const { name, fields = [] } = entity;
  const File = path.join(apiBaseDir, `${name}.enum.ts`);

  const enumTypes: EnumType[] = fields
    .filter((field: Field) => field.type === "enum")
    .map((field: Field) => ({
      name: fieldToEnumType(field.name),
      values: field.values,
    }));

  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./enums", {
    enumTypes,
    isGql,
  });
  createFile(File, content);
};
