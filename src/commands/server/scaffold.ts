import { Flags } from "@oclif/core";
import {
  Entity,
  createEntity,
  createController,
  createModule,
  createService,
  createAppModule,
  createDto,
} from "../../lib";
import BaseCommand from "../../lib/base-command";
import * as path from "path";
import rc = require("rc");

export default class Scaffold extends BaseCommand {
  static description = "Setup new entities and interfaces for an Apso Server";
  static examples = [`$ apso server scaffold`];
  static flags = {
    help: Flags.help({ char: "h" }),
    entity: Flags.string({
      char: "m",
      description: "model name",
    }),
  };

  static args = {};

  async scaffoldServer(
    dir: string,
    entity: Entity,
    entities: Entity[]
  ): Promise<void> {
    this.log(`Building... ${entity.name}`);

    const entityName = entity.name;
    const filePath = path.join(dir, entityName);

    createEntity(filePath, entity);
    createDto(filePath, entity);
    createService(filePath, entityName);
    createController(filePath, entity, entities);
    createModule(filePath, entityName);
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Scaffold);

    let models: Entity[] = [];
    const apsoConfig = rc("apso");
    if (typeof flags.entity === "undefined") {
      models = apsoConfig.entities;
      if (!apsoConfig) {
        this.error(
          "`entity` must be set (e.g. User) or define in .apsorc file"
        );
      }
    } else {
      models = [{ name: flags.entity }];
    }

    const dir = path.join(
      process.cwd(),
      apsoConfig.rootFolder || "src",
      "autogen"
    );
    models.forEach((entity) => {
      const scaffoldModel = this.scaffoldServer.bind(this);
      scaffoldModel(dir, entity, models);
    });
    createAppModule(dir, models);
    await this.runNpmCommand(["run", "format"]);
  }
}
