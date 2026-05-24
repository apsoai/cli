import { Flags } from "@oclif/core";
import inquirer from "inquirer";
import BaseCommand from "../lib/base-command";
import { projectLink } from "../lib/config";

export default class Unlink extends BaseCommand {
  static description = "Remove the link between this project and the platform";

  static examples = [
    `$ apso unlink`,
    `$ apso unlink --yes`,
  ];

  static flags = {
    yes: Flags.boolean({
      char: "y",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Unlink);

    const link = projectLink.read();
    if (!link) {
      this.log("Project is not linked. Nothing to do.");
      return;
    }

    this.log(
      `Currently linked to: ${link.workspaceSlug}/${link.serviceSlug}`
    );

    if (!flags.yes) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: "confirm",
          name: "confirm",
          message: "Remove project link?",
          default: false,
        },
      ]);
      if (!confirm) {
        this.log("Unlink cancelled.");
        return;
      }
    }

    projectLink.remove();
    this.log("Project unlinked.");
  }
}
