import { createFile } from "./util";
import * as Eta from "eta";
import * as path from "path";
import { ComputedField, mapTypes, Field, Entity } from "./entity";

export const createController = async (
  apiBaseDir: string,
  entity: Entity
): Promise<void> => {
  const { name: entityName, fields = [] } = entity;
  const Dir = path.join(apiBaseDir, "controllers");
  const File = path.join(Dir, `${entityName}Controller.ts`);
  // Dependencies
  const svcName = `${entityName}Service`;
  const ctrlName = `${entityName}Controller`;
  const pluralEntityName = `${entityName}s`;
  const columns: ComputedField[] = fields.map((field: Field) => ({
    ...field,
    dataType: mapTypes(field.type),
  }));

  const params = columns.reduce(
    (accum: any, column: ComputedField) => {
      const base: any = {
        field: column.name,
      };

      switch (column.type) {
        case "integer":
        case "text":
          base.type = column.dataType;
          break;
        case "enum":
          base.enum = column.dataType;
          break;
        case "array":
        case "boolean":
        default:
          break;
      }

      return {
        ...accum,
        [column.name]: base,
      };
    },
    {
      id: {
        field: "id",
        type: "number",
        primary: true,
      },
    }
  );

  console.log("PARAMS", params);
  const data = {
    svcName,
    ctrlName,
    entityName,
    pluralEntityName,
    params,
  };

  Eta.configure({
    // This tells Eta to look for templates
    // In the /templates directory
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./controller", data);

  //   if (fs.existsSync(File)) {
  //     return
  //   }

  createFile(File, content);
};
