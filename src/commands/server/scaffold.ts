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
} from "../../lib";
import BaseCommand from "../../lib/base-command";
import { ApiType } from "../../lib/apsorc-parser";
import { performance } from "perf_hooks";
import * as Eta from "eta";

Eta.configure({
  views: path.join(__dirname, "../../lib/templates"),
  cache: false
});

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
    const entityBuildStart = performance.now();
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
        await this.setupRestFiles(dir, entity, relationshipMap, apiType);
        break;
      default:
        break;
    }
    await createModule(filePath, entity, { apiType });
    const entityBuildTime = performance.now() - entityBuildStart;
    console.log(`[apso] Finished building entity '${entity.name}' in ${entityBuildTime.toFixed(2)} ms`);
  }

  async setupRestFiles(
    dir: string,
    entity: Entity,
    relationshipMap: RelationshipMap,
    apiType: string
  ) {
    const filePath = path.join(dir, entity.name);
    const entityRelationships = relationshipMap[entity.name] || [];

    const tDto = performance.now();
    await createDto(filePath, entity, entityRelationships, { apiType });
    if (process.env.DEBUG) {
      console.log(`[timing] createDto for ${entity.name}: ${(performance.now() - tDto).toFixed(2)}ms`);
      const used = process.memoryUsage();
      console.log(`[mem] heapUsed after createDto for ${entity.name}: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    }

    const tService = performance.now();
    await createService(filePath, entity, relationshipMap);
    if (process.env.DEBUG) {
      console.log(`[timing] createService for ${entity.name}: ${(performance.now() - tService).toFixed(2)}ms`);
      const used = process.memoryUsage();
      console.log(`[mem] heapUsed after createService for ${entity.name}: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    }

    const tController = performance.now();
    await createController(filePath, entity, relationshipMap);
    if (process.env.DEBUG) {
      console.log(`[timing] createController for ${entity.name}: ${(performance.now() - tController).toFixed(2)}ms`);
    }
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
    const totalBuildStart = performance.now();
    const { rootFolder, entities, relationshipMap, apiType } = parseApsorc();
    const rootPath = path.join(process.cwd(), rootFolder);
    const autogenPath = path.join(rootPath, "autogen");
    const lowerCaseApiType = apiType.toLowerCase();
    await createEnums(autogenPath, entities, lowerCaseApiType);
    await Promise.all(
      entities.map(async (entity) => {
        const scaffoldModel = this.scaffoldServer.bind(this);
        await scaffoldModel(autogenPath, entity, relationshipMap, lowerCaseApiType);
        if (process.env.DEBUG) {
          const used = process.memoryUsage();
          console.log(`[mem] heapUsed after ${entity.name}: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        }
      })
    );
    await createIndexAppModule(autogenPath, entities, lowerCaseApiType);
    const totalBuildTime = performance.now() - totalBuildStart;
    console.log(`[apso] Finished building all entities in ${totalBuildTime.toFixed(2)} ms`);
    const formatStart = performance.now();
    console.log("[apso] Formatting files...");
    await this.runNpmCommand(["run", "format", "src/autogen/**/*.ts"], true);
    const formatTime = performance.now() - formatStart;
    console.log(`[apso] Finished formatting in ${formatTime.toFixed(2)} ms`);
  }
}
