import * as Eta from "eta";
import * as path from "path";
import { createFile } from "./utils/file-system";
import { Entity } from "./types";

/**
 * Generates a NestJS module file for a given entity.
 *
 * @param apiBaseDir The base directory for the generated API module (e.g., 'src/autogen/users').
 * @param entity The entity definition object from the parsed .apsorc.
 * @param options Optional configuration flags.
 * @param options.apiType The type of API being generated (default: "rest").
 * @returns {Promise<void>} A promise that resolves when the module file is created.
 */
export const createModule = async (
  apiBaseDir: string,
  entity: Entity,
  options?: { apiType?: string }
): Promise<void> => {
  const { name: entityName } = entity;
  const moduleFileName = path.join(apiBaseDir, `${entityName}.module.ts`);

  // Names needed by the templates
  const moduleName = `${entityName}Module`;
  const svcName = `${entityName}Service`;
  const ctrlName = `${entityName}Controller`; // Used by REST template
  const resolverName = `${entityName}Resolver`; // Used by GQL template

  // Data for the Eta templates
  const data = {
    moduleName,
    svcName,
    ctrlName,
    resolverName,
    entityName,
  };

  // Determine template based on API type
  const templatePath = options?.apiType === "graphql" ? "./graphql/gql-module-graphql" : "./rest/module-rest";

  // Render the template
  const content: any = await Eta.renderFileAsync(templatePath, data);

  // Create the module file
  await createFile(moduleFileName, content);
};
