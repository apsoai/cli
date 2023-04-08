import { createFile } from "./util";
import * as Eta from "eta";
import * as path from "path";
// import * as fs from "fs";

export const createService = async (
  apiBaseDir: string,
  entityName: string
): Promise<void> => {
  const File = path.join(apiBaseDir, `${entityName}.service.ts`);
  // Dependencies
  const svcName = `${entityName}Service`;
  const pluralEntityName = `${entityName}s`;
  const data = {
    svcName,
    entityName,
    pluralEntityName,
  };

  Eta.configure({
    // This tells Eta to look for templates
    // In the /templates directory
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./service", data);

  //   if (fs.existsSync(File)) {
  //     return
  //   }

  createFile(File, content);
};
