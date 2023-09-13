import { createFile } from "./utils/file-system";
import * as Eta from "eta";
import * as path from "path";

import { Entity } from "./types";

export const createIndexAppModule = async (
  apiBaseDir: string,
  entities: Entity[],
  apiType: string
): Promise<void> => {
  const File = path.join(apiBaseDir, `index.ts`);

  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync(
    `./${apiType}/index-module-${apiType}`,
    {
      entities,
    }
  );

  createFile(File, content);
};
