import { createFile } from "./utils/file-system";
import * as Eta from "eta";
import * as path from "path";

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
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./rest/service", data);

  createFile(File, content);
};
