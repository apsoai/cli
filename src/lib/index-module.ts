import { createFile } from "./utils/file-system";
import * as Eta from "eta";
import * as path from "path";
// import * as fs from "fs";
import { Entity } from "./types";

export const createIndexAppModule = async (
  apiBaseDir: string,
  entities: Entity[]
): Promise<void> => {
  const File = path.join(apiBaseDir, `index.ts`);

  Eta.configure({
    // This tells Eta to look for templates
    // In the /templates directory
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./index-module", {
    entities,
  });

  //   if (fs.existsSync(File)) {
  //     return
  //   }

  createFile(File, content);
};
