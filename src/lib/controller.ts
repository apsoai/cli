import * as Eta from "eta";
import * as path from "path";
import { createFile, withGeneratedMeta } from "./utils/file-system";
import { Entity, RelationshipMap } from "./types";
import { getRelationshipForTemplate } from "./utils/relationships";
import { streamNestedRelationships } from "./utils/relationships/parse";
import pluralize from "pluralize";
import { performance } from "perf_hooks";
import fs from "fs";
import os from "os";
import { promisify } from "util";
const unlinkAsync = promisify(fs.unlink);

/**
 * Generates NestJS controller and spec files for a given entity.
 *
 * @param apiBaseDir The base directory for the generated API module (e.g., 'src/autogen/users').
 * @param entity The entity definition object from the parsed .apsorc.
 * @param relationshipMap The complete RelationshipMap generated from parsing all relationships.
 * @returns {Promise<void>} A promise that resolves when the controller and spec files are created.
 */
export const createController = async (
  apiBaseDir: string,
  entity: Entity,
  relationshipMap: RelationshipMap
): Promise<void> => {
  const { name: entityName } = entity;
  const controllerFileName = path.join(
    apiBaseDir,
    `${entityName}.controller.ts`
  );
  const specFileName = path.join(
    apiBaseDir,
    `${entityName}.controller.spec.ts`
  );

  const startTotal = performance.now();

  const startRel = performance.now();
  const relationships = getRelationshipForTemplate(
    entityName,
    relationshipMap[entityName]
  );
  const relTime = performance.now() - startRel;
  if (process.env.DEBUG) {
    console.log(
      `[createController][${entityName}] getRelationshipForTemplate: ${relTime.toFixed(
        2
      )} ms`
    );
  }

  const startNested = performance.now();
  const tmpDir = os.tmpdir();
  const nestedJoinsFile = path.join(
    tmpDir,
    `apso-nested-joins-${entityName}-${Date.now()}.eta`
  );
  const nestedJoinsStream = fs.createWriteStream(nestedJoinsFile, {
    encoding: "utf8",
  });
  let nestedCount = 0;
  nestedCount = await streamNestedRelationships(
    entityName,
    relationshipMap,
    nestedJoinsStream
  );
  nestedJoinsStream.end();
  await new Promise((resolve) => {
    nestedJoinsStream.on("finish", resolve);
  });
  const nestedTime = performance.now() - startNested;
  if (process.env.DEBUG) {
    console.log(
      `[createController][${entityName}] getNestedRelationships (streamed ${nestedCount} paths): ${nestedTime.toFixed(
        2
      )} ms`
    );
  }

  const svcName = `${entityName}Service`;
  const ctrlName = `${entityName}Controller`;
  const pluralEntityName = pluralize(entityName);

  const data = {
    svcName,
    ctrlName,
    entityName,
    pluralEntityName,
    associations: [...new Set(relationships)],
    nestedJoinsFile,
  };

  const startRenderController = performance.now();
  const controllerContent: any = await Eta.renderFileAsync(
    "./rest/controller-rest",
    withGeneratedMeta(data)
  );
  const renderControllerTime = performance.now() - startRenderController;
  if (process.env.DEBUG) {
    console.log(
      `[createController][${entityName}] renderController: ${renderControllerTime.toFixed(
        2
      )} ms`
    );
  }

  const startWriteController = performance.now();
  await createFile(controllerFileName, controllerContent);
  const writeControllerTime = performance.now() - startWriteController;
  if (process.env.DEBUG) {
    console.log(
      `[createController][${entityName}] writeController: ${writeControllerTime.toFixed(
        2
      )} ms`
    );
  }

  const startRenderSpec = performance.now();
  const specContent: any = await Eta.renderFileAsync(
    "./rest/controller-rest-spec",
    withGeneratedMeta(data)
  );
  const renderSpecTime = performance.now() - startRenderSpec;
  if (process.env.DEBUG) {
    console.log(
      `[createController][${entityName}] renderSpec: ${renderSpecTime.toFixed(
        2
      )} ms`
    );
  }

  const startWriteSpec = performance.now();
  await createFile(specFileName, specContent);
  const writeSpecTime = performance.now() - startWriteSpec;
  if (process.env.DEBUG) {
    console.log(
      `[createController][${entityName}] writeSpec: ${writeSpecTime.toFixed(
        2
      )} ms`
    );
  }

  try {
    await unlinkAsync(nestedJoinsFile);
  } catch (error) {
    console.warn(
      `[createController][${entityName}] Warning: Failed to delete temp file ${nestedJoinsFile}:`,
      error
    );
  }

  const totalTime = performance.now() - startTotal;
  if (process.env.DEBUG) {
    console.log(
      `[createController][${entityName}] TOTAL: ${totalTime.toFixed(2)} ms`
    );
  }
};
