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
} from "../../lib";
import BaseCommand from "../../lib/base-command";

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
    relationshipMap: RelationshipMap
  ): Promise<void> {
    this.log(`Building... ${entity.name}`);

    const entityName = entity.name;
    const filePath = path.join(dir, entityName);
    const entityRelationships = relationshipMap[entity.name] || [];

    createEntity(filePath, entity, entityRelationships);
    createDto(filePath, entity, entityRelationships);
    createService(filePath, entityName);
    createController(filePath, entity, relationshipMap);
    createModule(filePath, entityName);
  }

  async run(): Promise<void> {
    const { rootFolder, entities, relationshipMap } = parseApsorc();

    const dir = path.join(process.cwd(), rootFolder, "autogen");
    entities.forEach((entity) => {
      const scaffoldModel = this.scaffoldServer.bind(this);
      scaffoldModel(dir, entity, relationshipMap);
    });
    createAppModule(dir, entities);
    await this.runNpmCommand(["run", "format"]);
  }
}
