import * as Eta from "eta";
import { createFile, withGeneratedMeta } from "./utils/file-system";
import * as path from "path";
import { Entity } from "./types";

/*
 * Generates NestJS service and spec files for a given entity.
 *
 * @param apiBaseDir The base directory for the generated API module (e.g., 'src/autogen/users').
 * @param entity The entity definition object from the parsed .apsorc.
 * @returns {Promise<void>} A promise that resolves when the service and spec files are created.
 */
export const createService = async (
  apiBaseDir: string,
  entity: Entity,
  relationshipMap?: any // RelationshipMap, optional for backward compatibility
): Promise<void> => {
  const { name: entityName } = entity;
  const serviceFileName = path.join(apiBaseDir, `${entityName}.service.ts`);
  const specFileName = path.join(apiBaseDir, `${entityName}.service.spec.ts`);

  // Names needed by the templates
  const svcName = `${entityName}Service`;
  const repoName = `${entityName}Repository`; // Assuming convention

  // --- NEW: Recursively collect all related entities for the test file ---
  let allRelatedEntities: string[] = [entityName];
  if (relationshipMap && relationshipMap[entityName]) {
    // Use a Set to avoid duplicates
    const visited = new Set<string>();
    const collect = (entity: string) => {
      if (visited.has(entity)) return;
      visited.add(entity);
      allRelatedEntities.push(entity);
      const rels = relationshipMap[entity] || [];
      for (const rel of rels) {
        if (!visited.has(rel.name)) {
          collect(rel.name);
        }
      }
    };
    allRelatedEntities = [];
    collect(entityName);
    // Remove self-duplicates using spread operator
    allRelatedEntities = [...new Set(allRelatedEntities)];
  }

  // Data for the Eta templates
  const data = {
    svcName,
    repoName,
    entityName,
    allRelatedEntities,
  };

  // Render service template
  const serviceContent: any = await Eta.renderFileAsync(
    "./rest/service-rest",
    withGeneratedMeta(data)
  );
  await createFile(serviceFileName, serviceContent);
  Eta.templates.remove("./rest/service-rest");

  // Render spec template
  const specContent: any = await Eta.renderFileAsync(
    "./rest/service-rest-spec",
    withGeneratedMeta(data)
  );
  await createFile(specFileName, specContent);
  Eta.templates.remove("./rest/service-rest-spec");
};
