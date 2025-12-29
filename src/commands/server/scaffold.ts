import { Flags } from "@oclif/core";
import * as path from "path";
import * as fs from "fs";
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
  createGuards,
} from "../../lib";
import BaseCommand from "../../lib/base-command";
import {
  ApiType,
  ApsorcType,
  parseApsorcV1,
  parseApsorcV2,
} from "../../lib/apsorc-parser";
import { performance } from "perf_hooks";
import * as Eta from "eta";

Eta.configure({
  views: path.join(__dirname, "../../lib/templates"),
  cache: false,
});

export default class Scaffold extends BaseCommand {
  static description = "Setup new entities and interfaces for an Apso Server";
  static examples = [`$ apso server scaffold`];
  static flags = {
    help: Flags.help({ char: "h" }),
  };

  static args = {};

  async scaffoldServer(options: {
    dir: string;
    entity: Entity;
    relationshipMap: RelationshipMap;
    apiType: string;
    allEntities: Entity[];
  }): Promise<void> {
    const { dir, entity, relationshipMap, apiType, allEntities } = options;
    const entityBuildStart = performance.now();
    this.log(`Building... ${entity.name}`);

    const entityName = entity.name;
    const filePath = path.join(dir, entityName);
    const entityRelationships = relationshipMap[entity.name] || [];
    await createEntity({
      apiBaseDir: filePath,
      entity,
      relationships: entityRelationships,
      apiType,
      allEntities,
    });
    switch (apiType) {
      case ApiType.Graphql:
        await this.setupGraphqlFiles(dir, entity, relationshipMap);
        break;
      case ApiType.Rest:
        await this.setupRestFiles(
          dir,
          entity,
          relationshipMap,
          apiType,
          allEntities
        );
        break;
      default:
        break;
    }
    await createModule(filePath, entity, { apiType });
    const entityBuildTime = performance.now() - entityBuildStart;
    console.log(
      `[apso] Finished building entity '${
        entity.name
      }' in ${entityBuildTime.toFixed(2)} ms`
    );
  }

  async setupRestFiles(
    dir: string,
    entity: Entity,
    relationshipMap: RelationshipMap,
    apiType: string,
    allEntities: Entity[]
  ) {
    const filePath = path.join(dir, entity.name);
    const entityRelationships = relationshipMap[entity.name] || [];

    const tDto = performance.now();
    await createDto(filePath, entity, entityRelationships, {
      apiType,
      allEntities,
    });
    if (process.env.DEBUG) {
      console.log(
        `[timing] createDto for ${entity.name}: ${(
          performance.now() - tDto
        ).toFixed(2)}ms`
      );
      const used = process.memoryUsage();
      console.log(
        `[mem] heapUsed after createDto for ${entity.name}: ${(
          used.heapUsed /
          1024 /
          1024
        ).toFixed(2)} MB`
      );
    }

    const tService = performance.now();
    await createService(filePath, entity, relationshipMap);
    if (process.env.DEBUG) {
      console.log(
        `[timing] createService for ${entity.name}: ${(
          performance.now() - tService
        ).toFixed(2)}ms`
      );
      const used = process.memoryUsage();
      console.log(
        `[mem] heapUsed after createService for ${entity.name}: ${(
          used.heapUsed /
          1024 /
          1024
        ).toFixed(2)} MB`
      );
    }

    const tController = performance.now();
    await createController(filePath, entity, relationshipMap);
    if (process.env.DEBUG) {
      console.log(
        `[timing] createController for ${entity.name}: ${(
          performance.now() - tController
        ).toFixed(2)}ms`
      );
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

    // Prefer a local .apsorc in the current working directory (e.g. code bundle)
    // so that `apso server scaffold` uses the schema next to the code by default.
    // Fall back to the global rc("apso") loader if no local file exists.
    let rootFolder: string;
    let entities: Entity[];
    let relationshipMap: RelationshipMap;
    let apiType: string;
    let auth: any;

    const localApsorcPath = path.join(process.cwd(), ".apsorc");

    if (fs.existsSync(localApsorcPath)) {
      const raw = fs.readFileSync(localApsorcPath);
      let parsedFile: any;
      try {
        // eslint-disable-next-line unicorn/prefer-json-parse-buffer
        parsedFile = JSON.parse(raw.toString("utf8"));
      } catch (error) {
        const err = error as Error;
        this.error(
          `Failed to parse .apsorc in current directory: ${err.message}`
        );
      }

      const version = parsedFile.version ?? 2;
      const apiTypeValue = (parsedFile.apiType || "Rest") as string;
      const apiTypeEnum =
        apiTypeValue.toLowerCase() === ApiType.Graphql.toLowerCase()
          ? ApiType.Graphql
          : ApiType.Rest;

      const apsorcInput: ApsorcType = {
        version,
        rootFolder: parsedFile.rootFolder || "src",
        apiType: apiTypeEnum,
        entities: parsedFile.entities || [],
        relationships: parsedFile.relationships || [],
        auth: parsedFile.auth,
      };

      const parsed =
        version === 1 ? parseApsorcV1(apsorcInput) : parseApsorcV2(apsorcInput);

      rootFolder = apsorcInput.rootFolder;
      entities = parsed.entities;
      relationshipMap = parsed.relationshipMap;
      apiType = apiTypeEnum.toLowerCase();
      auth = apsorcInput.auth;
    } else {
      // Fallback: use rc("apso")-based loader (original behaviour)
      const parsed = parseApsorc();
      rootFolder = parsed.rootFolder;
      entities = parsed.entities;
      relationshipMap = parsed.relationshipMap;
      apiType = parsed.apiType;
      auth = parsed.auth;
    }

    const rootPath = path.join(process.cwd(), rootFolder);
    const autogenPath = path.join(rootPath, "autogen");
    const lowerCaseApiType = apiType.toLowerCase();
    await createEnums(autogenPath, entities, lowerCaseApiType);
    await Promise.all(
      entities.map(async (entity) => {
        const scaffoldModel = this.scaffoldServer.bind(this);
        await scaffoldModel({
          dir: autogenPath,
          entity,
          relationshipMap,
          apiType: lowerCaseApiType,
          allEntities: entities,
        });
        if (process.env.DEBUG) {
          const used = process.memoryUsage();
          console.log(
            `[mem] heapUsed after ${entity.name}: ${(
              used.heapUsed /
              1024 /
              1024
            ).toFixed(2)} MB`
          );
        }
      })
    );

    // Generate guards (auth and/or scope) based on .apsorc configuration
    await createGuards(rootPath, entities, auth);

    await createIndexAppModule(autogenPath, entities, lowerCaseApiType);
    const totalBuildTime = performance.now() - totalBuildStart;
    console.log(
      `[apso] Finished building all entities in ${totalBuildTime.toFixed(2)} ms`
    );
    const formatStart = performance.now();
    console.log("[apso] Formatting files...");
    await this.runNpmCommand(
      ["run", "format", "src/autogen/**/*.ts", "src/guards/**/*.ts"],
      true
    );
    const formatTime = performance.now() - formatStart;
    console.log(`[apso] Finished formatting in ${formatTime.toFixed(2)} ms`);
  }
}
