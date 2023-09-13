import * as Eta from "eta";
import * as path from "path";
import { createFile } from "./utils/file-system";

export const createModule = async (
  apiBaseDir: string,
  entityName: string,
  apiType: string
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
  };

  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync(
    `./${apiType}/module-${apiType}`,
    data
  );

  createFile(File, content);
};
