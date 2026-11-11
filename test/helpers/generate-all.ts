import * as fs from "fs";
import { parseApsorcV2 } from "../../src/lib/apsorc-parser";
import { createGenerator } from "../../src/lib/generators";
import { GeneratedFile, TargetLanguage } from "../../src/lib/types";

/** Every autogen file `apso generate` writes for an .apsorc, by path. */
export async function generateAll(
  language: TargetLanguage,
  apsorcFile: string
): Promise<Map<string, string>> {
  const { entities, relationshipMap } = parseApsorcV2(
    JSON.parse(fs.readFileSync(apsorcFile).toString())
  );
  const apiType = "rest";
  const generator = createGenerator({
    language,
    rootFolder: ".",
    apiType,
    entities,
    relationshipMap,
  });
  const files: GeneratedFile[] = [
    ...(await generator.generateEnums(entities, apiType)),
    ...(await generator.generateQueryUtils(entities, apiType)),
  ];
  for (const entity of entities) {
    const options = {
      entity,
      relationships: relationshipMap[entity.name] || [],
      allEntities: entities,
      apiType,
      relationshipMap,
    };
    // eslint-disable-next-line no-await-in-loop
    for (const generated of await Promise.all([
      generator.generateEntity(options),
      generator.generateDto(options),
      generator.generateService(options),
      generator.generateController(options),
    ]))
      files.push(...generated);
  }
  files.push(
    ...(await generator.generateGuards(entities)),
    ...(await generator.generateIndexModule(entities, apiType))
  );
  return new Map(files.map((f) => [f.path, f.content]));
}
