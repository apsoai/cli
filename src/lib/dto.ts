import { createFile, camelCase } from "./util";
import * as Eta from "eta";
import * as path from "path";

import { mapTypes, Field, Entity } from "./entity";

export interface ComputedField {
  name: string;
  dataType: string;
}

export const createDto = async (
  apiBaseDir: string,
  entity: Entity
): Promise<void> => {
  const { name, fields = [] } = entity;
  const Dir = path.join(apiBaseDir, "dtos");
  const File = path.join(Dir, `${name}.dto.ts`);

  const columns: ComputedField[] = fields.map((field: Field) => ({
    name: field.name,
    dataType: mapTypes(field.type),
  }));

  const data = {
    name: entity.name,
    columns,
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
