import { Flags } from "@oclif/core";
import * as path from "path";
import {
  Entity,
  RelationshipMap,
  createEntity,
  createController,
  createModule,
  createService,
  createAppModule,
  createDto,
  parseApsorc,
  createEnums,
  createGqlDTO,
} from "../../lib";
import BaseCommand from "../../lib/base-command";
import { typeExistsInEntity } from "../../lib/utils/field";

export enum ApiType {
  Rest = "rest",
  Graphql = "graphql",
}

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
    apiType: ApiType
  ): Promise<void> {
    this.log(`Building... ${entity.name}`);

    const entityName = entity.name;
    const filePath = path.join(dir, entityName);
    const entityRelationships = relationshipMap[entity.name] || [];
    const isGql = apiType !== ApiType.Rest;

    typeExistsInEntity(entity, "enum") !== -1 &&
      (await createEnums(filePath, entity, isGql));
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
    const { rootFolder, entities, relationshipMap } = parseApsorc();

    const dir = path.join(process.cwd(), rootFolder, "autogen");
    entities.forEach((entity) => {
      const scaffoldModel = this.scaffoldServer.bind(this);
      scaffoldModel(dir, entity, relationshipMap, ApiType.Graphql);
    });
    createAppModule(dir, entities);
    await this.runNpmCommand(["run", "format"]);
  }
}
