import { Flags } from "@oclif/core";
import * as path from "path";
import {
  Entity,
  RelationshipMap,
  createEntity,
  createController,
  createModule,
  createService,
  createIndexAppModule,
  createDto,
  parseApsorc,
  createEnums,
  createGqlDTO,
  updateAppModuleForGql,
} from "../../lib";
import BaseCommand from "../../lib/base-command";
import { ApiType } from "../../lib/apsorc-parser";

export default class Scaffold extends BaseCommand {
  static description = "Setup new entities and interfaces for an Apso Server";
  static examples = [`$ apso server scaffold`];
  static flags = {
    help: Flags.help({ char: "h" }),
  };

  static args = {};

  async scaffoldServer(
    dir: string,
    entity: Entity,
    relationshipMap: RelationshipMap,
    isGql: boolean
  ): Promise<void> {
    this.log(`Building... ${entity.name}`);

    const entityName = entity.name;
    const filePath = path.join(dir, entityName);
    const entityRelationships = relationshipMap[entity.name] || [];

    await createEntity(filePath, entity, entityRelationships, isGql);
    await (isGql
      ? createGqlDTO(filePath, entity, entityRelationships)
      : createDto(filePath, entity, entityRelationships));
    if (!isGql) {
      await createService(filePath, entityName);
      await createController(filePath, entity, relationshipMap);
    }
    await createModule(filePath, entityName, isGql);
  }

  async run(): Promise<void> {
    const { rootFolder, entities, relationshipMap, apiType } = parseApsorc();
    const rootPath = path.join(process.cwd(), rootFolder);
    const autogenPath = path.join(rootPath, "autogen");
    const isGql = apiType.toLowerCase() !== ApiType.Rest.toLowerCase();
    await createEnums(autogenPath, entities, isGql);
    entities.forEach((entity) => {
      const scaffoldModel = this.scaffoldServer.bind(this);
      scaffoldModel(autogenPath, entity, relationshipMap, isGql);
    });
    createIndexAppModule(autogenPath, entities);
    if (isGql) {
      await updateAppModuleForGql(rootPath, isGql);
    }
    await this.runNpmCommand(["run", "format"]);
  }
}
