import { createFile } from "./utils/file-system";
import * as Eta from "eta";
import * as path from "path";

export const updateAppModuleForGql = async (
  filePath: string,
  isGql: boolean
): Promise<void> => {
  const File = path.join(filePath, `app.module.ts`);

  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./app-module", {
    isGql,
  });

  createFile(File, content);
};
