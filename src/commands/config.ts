import { Args } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { globalConfig } from "../lib/config";
import { GlobalConfigFile, DEFAULT_GLOBAL_CONFIG } from "../lib/config/types";

const VALID_KEYS: Array<keyof GlobalConfigFile> = [
  "apiUrl",
  "webUrl",
  "verbose",
  "noColor",
  "telemetryDisabled",
  "defaultWorkspace",
];

const BOOLEAN_KEYS: Array<keyof GlobalConfigFile> = [
  "verbose",
  "noColor",
  "telemetryDisabled",
];

function parseBoolean(value: string): boolean | null {
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return null;
}

export default class Config extends BaseCommand {
  static description = "View or modify CLI configuration";

  static examples = [
    `$ apso config`,
    `$ apso config get apiUrl`,
    `$ apso config set verbose true`,
    `$ apso config reset`,
  ];

  static strict = false;

  static args = {
    action: Args.string({
      description: "Action: get, set, or reset",
      required: false,
    }),
    key: Args.string({
      description: "Configuration key",
      required: false,
    }),
    value: Args.string({
      description: "Value to set",
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, argv } = await this.parse(Config);

    const action = args.action;
    const rawArgv = argv as string[];

    // No action: show all config
    if (!action) {
      this.showAll();
      return;
    }

    if (action === "reset") {
      globalConfig.reset();
      this.log("Configuration reset to defaults.");
      return;
    }

    if (action === "get") {
      const key = args.key;
      if (!key) {
        this.error("Usage: apso config get <key>");
      }
      if (!VALID_KEYS.includes(key as keyof GlobalConfigFile)) {
        this.error(
          `Unknown key: ${key}\nValid keys: ${VALID_KEYS.join(", ")}`
        );
      }
      const value = globalConfig.get(key as keyof GlobalConfigFile);
      this.log(String(value ?? ""));
      return;
    }

    if (action === "set") {
      const key = args.key || rawArgv[1];
      const value = args.value || rawArgv[2];

      if (!key || value === undefined) {
        this.error("Usage: apso config set <key> <value>");
      }
      if (!VALID_KEYS.includes(key as keyof GlobalConfigFile)) {
        this.error(
          `Unknown key: ${key}\nValid keys: ${VALID_KEYS.join(", ")}`
        );
      }

      if (BOOLEAN_KEYS.includes(key as keyof GlobalConfigFile)) {
        const boolVal = parseBoolean(value);
        if (boolVal === null) {
          this.error(
            `Invalid boolean value: ${value}. Use true/false or 1/0.`
          );
        }
        globalConfig.set(key as keyof GlobalConfigFile, boolVal as any);
      } else {
        globalConfig.set(key as keyof GlobalConfigFile, value as any);
      }

      this.log(`${key} = ${value}`);
      return;
    }

    this.error(
      `Unknown action: ${action}\nUsage: apso config [get|set|reset]`
    );
  }

  private showAll(): void {
    const config = globalConfig.read();
    this.log("Current configuration:\n");
    for (const key of VALID_KEYS) {
      const value = config[key];
      const defaultVal = (DEFAULT_GLOBAL_CONFIG as any)[key];
      const isDefault = value === defaultVal;
      const suffix = isDefault ? " (default)" : "";
      this.log(`  ${key} = ${value ?? "(not set)"}${suffix}`);
    }
  }
}
