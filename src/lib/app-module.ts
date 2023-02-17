import { createFile } from "./util";
import * as Eta from "eta";
import * as path from "path";
// import * as fs from "fs";
import { Entity } from "./entity";

export const createAppModule = async (
  apiBaseDir: string,
  entities: Entity[]
): Promise<void> => {
  const Dir = path.join(apiBaseDir, "modules");
  const File = path.join(Dir, `AppModule.ts`);

  Eta.configure({
    // This tells Eta to look for templates
    // In the /templates directory
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./app-module", { entities });

  //   if (fs.existsSync(File)) {
  //     return
  //   }

  createFile(File, content);
};
