import { Command, Flags } from "@oclif/core";
import {
  Entity,
  createEntity,
  createController,
  createModule,
  createService,
  createAppModule,
} from "../../lib";
import BaseCommand from "../../lib/baseCommand";
import * as path from "path";
import rc = require("rc");

export default class Scaffold extends BaseCommand {
  static description = "Setup new entities and interfaces for an Apso Server";

  static examples = [
    `$ apso server scaffold
`,
  ];

  static flags = {
    help: Flags.help({ char: "h" }),
    entity: Flags.string({
      char: "m",
      description: "model name",
    }),
  };

  static args = {};

  async scaffoldServer(dir: string, entity: Entity): Promise<void> {
    const entityName = entity.name;

    this.log("Creating Entity...");
    createEntity(dir, entity);
    this.log("Creating Service...");
    createService(dir, entityName);
    this.log("Creating Controller...");
    createController(dir, entity);
    this.log("Creating Module...");
    createModule(dir, entityName);
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Scaffold);

    let models: Entity[] = [];
    const apsoConfig = rc("apso");
    if (typeof flags.entity === "undefined") {
      this.log(JSON.stringify(apsoConfig));
      models = apsoConfig.entities;
      if (!apsoConfig) {
        this.error(
          "`entity` must be set (e.g. User) or define in .apsorc file"
        );
      }
    } else {
      models = [{ name: flags.entity }];
    }

    const dir = path.join(process.cwd(), apsoConfig.rootFolder || "src");
    models.forEach((entity) => {
      this.log(`Building... ${entity.name}`);

      const scaffoldModel = this.scaffoldServer.bind(this);

      scaffoldModel(dir, entity);
    });
    createAppModule(dir, models);

    await this.runNpmCommand(["run", "format"]);
  }
}
