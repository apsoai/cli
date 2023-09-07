import * as Eta from "eta";
import * as path from "path";
// import * as fs from "fs";
import { createFile } from "./utils/file-system";

export const createModule = async (
  apiBaseDir: string,
  entityName: string,
  isGql: boolean
): Promise<void> => {
  const File = path.join(apiBaseDir, `${entityName}.module.ts`);
  // Dependencies
  const svcName = `${entityName}Service`;
  const ctrlName = `${entityName}Controller`;
  const modName = `${entityName}Module`;
  const pluralEntityName = `${entityName}s`;
  const data = {
    svcName,
    ctrlName,
    modName,
    entityName,
    pluralEntityName,
    isGql,
  };

  Eta.configure({
    // This tells Eta to look for templates
    // In the /templates directory
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./module", data);

  //   if (fs.existsSync(File)) {
  //     return
  //   }

  createFile(File, content);
};
