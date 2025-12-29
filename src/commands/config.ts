import { Flags, Args } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { readConfig, updateConfig, writeConfig } from "../lib/config/index";

export default class Config extends BaseCommand {
  static description = "Manage CLI configuration";

  static examples = [
    `$ apso config set webUrl http://localhost:3000`,
    `$ apso config get webUrl`,
    `$ apso config list`,
  ];

  static flags = {
    json: Flags.boolean({
      char: "j",
      description: "Output as JSON",
      default: false,
    }),
  };

  static args = {
    action: Args.string({
      description: "Action: get, set, list, or reset",
      required: true,
      options: ["get", "set", "list", "reset"],
    }),
    key: Args.string({
      description: "Config key (for get/set)",
      required: false,
    }),
    value: Args.string({
      description: "Config value (for set)",
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Config);
    const { action, key, value } = args;

    switch (action) {
      case "get":
        if (!key) {
          this.error("Key is required for 'get' action");
        }
        await this.handleGet(key, flags.json);
        break;

      case "set":
        if (!key || !value) {
          this.error("Key and value are required for 'set' action");
        }
        await this.handleSet(key, value);
        break;

      case "list":
        await this.handleList(flags.json);
        break;

      case "reset":
        await this.handleReset();
        break;

      default:
        this.error(`Unknown action: ${action}`);
    }
  }

  private async handleGet(key: string, json: boolean): Promise<void> {
    const config = readConfig();
    const value = (config as any)[key];

    if (value === undefined) {
      if (json) {
        this.log(JSON.stringify({ key, value: null }));
      } else {
        this.log(`Config key '${key}' is not set`);
      }
      this.exit(1);
    } else if (json) {
      this.log(JSON.stringify({ key, value }));
    } else {
      this.log(value);
    }
  }

  private async handleSet(key: string, value: string): Promise<void> {
    readConfig();

    // Validate key
    const validKeys = [
      "defaultWorkspace",
      "defaultService",
      "editor",
      "colorScheme",
      "jsonOutput",
      "telemetry",
      "logLevel",
      "webUrl",
      "apiUrl",
    ];

    if (!validKeys.includes(key)) {
      this.error(
        `Invalid config key: ${key}\nValid keys: ${validKeys.join(", ")}`
      );
    }

    // Parse value based on key type
    let parsedValue: any = value;
    switch (key) {
      case "jsonOutput":
      case "telemetry": {
        parsedValue = value.toLowerCase() === "true";

        break;
      }
      case "colorScheme": {
        if (!["auto", "light", "dark"].includes(value)) {
          this.error(`Invalid colorScheme. Must be: auto, light, or dark`);
        }

        break;
      }
      case "logLevel": {
        if (!["debug", "info", "warn", "error"].includes(value)) {
          this.error(`Invalid logLevel. Must be: debug, info, warn, or error`);
        }

        break;
      }
      // No default
    }

    updateConfig({ [key]: parsedValue });
    this.log(`✓ Set ${key} = ${value}`);
  }

  private async handleList(json: boolean): Promise<void> {
    const config = readConfig();

    if (json) {
      this.log(JSON.stringify(config, null, 2));
      return;
    }

    this.log("Current configuration:");
    this.log("");
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        this.log(`  ${key}: ${value}`);
      }
    }
  }

  private async handleReset(): Promise<void> {
    const defaultConfig: import("../lib/config/index").Config = {
      colorScheme: "auto",
      jsonOutput: false,
      telemetry: true,
      logLevel: "info",
    };
    writeConfig(defaultConfig);
    this.log("✓ Configuration reset to defaults");
  }
}
