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
  createGlobalAppModule,
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
    apiType: string
  ): Promise<void> {
    this.log(`Building... ${entity.name}`);

    const entityName = entity.name;
    const filePath = path.join(dir, entityName);
    const entityRelationships = relationshipMap[entity.name] || [];
    await createEntity(filePath, entity, entityRelationships, apiType);
    switch (apiType) {
      case ApiType.Graphql:
        await this.setupGraphqlFiles(dir, entity, relationshipMap);
        break;
      case ApiType.Rest:
        await this.setupRestFiles(dir, entity, relationshipMap);
        break;
      default:
        break;
    }
    await createModule(filePath, entityName, apiType);
  }

  async setupRestFiles(
    dir: string,
    entity: Entity,
    relationshipMap: RelationshipMap
  ) {
    const filePath = path.join(dir, entity.name);
    const entityRelationships = relationshipMap[entity.name] || [];
    await createDto(filePath, entity, entityRelationships);
    await createService(filePath, entity.name);
    await createController(filePath, entity, relationshipMap);
  }

  async setupGraphqlFiles(
    dir: string,
    entity: Entity,
    relationshipMap: RelationshipMap
  ) {
    const filePath = path.join(dir, entity.name);
    const entityRelationships = relationshipMap[entity.name] || [];
    await createGqlDTO(filePath, entity, entityRelationships);
  }

  async run(): Promise<void> {
    const { rootFolder, entities, relationshipMap, apiType } = parseApsorc();
    const rootPath = path.join(process.cwd(), rootFolder);
    const autogenPath = path.join(rootPath, "autogen");
    const lowerCaseApiType = apiType.toLowerCase();
    await createEnums(autogenPath, entities, lowerCaseApiType);
    entities.forEach((entity) => {
      const scaffoldModel = this.scaffoldServer.bind(this);
      scaffoldModel(autogenPath, entity, relationshipMap, lowerCaseApiType);
    });
    await createIndexAppModule(autogenPath, entities, lowerCaseApiType);
    await createGlobalAppModule(rootPath, lowerCaseApiType);
    await this.runNpmCommand(["run", "format"]);
  }
}
