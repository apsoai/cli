import { createFile } from "./util";
import * as Eta from "eta";
import * as path from "path";
import { Entity } from "./entity";

export const createController = async (
  apiBaseDir: string,
  entity: Entity
): Promise<void> => {
  const { name: entityName } = entity;
  const Dir = path.join(apiBaseDir, "controllers");
  const File = path.join(Dir, `${entityName}Controller.ts`);
  // Dependencies
  const svcName = `${entityName}Service`;
  const ctrlName = `${entityName}Controller`;
  const pluralEntityName = `${entityName}s`;

  const data = {
    svcName,
    ctrlName,
    entityName,
    pluralEntityName,
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
