import { createFile } from "./utils/file-system";
import * as Eta from "eta";
import * as path from "path";
import { Entity } from "./types";

/**
 * Generates NestJS service and spec files for a given entity.
 *
 * @param apiBaseDir The base directory for the generated API module (e.g., 'src/autogen/users').
 * @param entity The entity definition object from the parsed .apsorc.
 * @returns {Promise<void>} A promise that resolves when the service and spec files are created.
 */
export const createService = async (
  apiBaseDir: string,
  entity: Entity
): Promise<void> => {
  const { name: entityName } = entity;
  const serviceFileName = path.join(apiBaseDir, `${entityName}.service.ts`);
  const specFileName = path.join(apiBaseDir, `${entityName}.service.spec.ts`);

  // Names needed by the templates
  const svcName = `${entityName}Service`;
  const repoName = `${entityName}Repository`; // Assuming convention

  // Data for the Eta templates
  const data = {
    svcName,
    repoName,
    entityName,
  };

  // Configure Eta
  Eta.configure({
    views: path.join(__dirname, "templates"),
  });

  // Render service template
  const serviceContent: any = await Eta.renderFileAsync(
    "./rest/service-rest",
    data
  );
  createFile(serviceFileName, serviceContent);

  // Render spec template
  const specContent: any = await Eta.renderFileAsync(
    "./rest/service-rest-spec",
    data
  );
  createFile(specFileName, specContent);
};
