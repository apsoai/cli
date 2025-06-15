import * as Eta from "eta";
import { createFile } from "./utils/file-system";
import * as path from "path";

import { Entity } from "./types";

/**
 * Generates an index file (e.g., index.ts) that exports all generated entity modules.
 *
 * This file serves as a central point for importing and managing the generated modules
 * within the application, tailored to the specified API type (REST or GraphQL).
 *
 * @param apiBaseDir The base directory where the generated API modules reside (e.g., 'src/autogen').
 * @param entities An array of Entity definition objects, used to determine which modules to export.
 * @param apiType The type of API being generated ('rest' or 'graphql'), which determines the template used.
 * @returns {Promise<void>} A promise that resolves when the index file is created.
 */
export const createIndexAppModule = async (
  apiBaseDir: string,
  entities: Entity[],
  apiType: string
): Promise<void> => {
  const File = path.join(apiBaseDir, `index.ts`);

  const content: any = await Eta.renderFileAsync(
    `./${apiType}/index-module-${apiType}`,
    {
      entities,
    }
  );

  await createFile(File, content);
};
