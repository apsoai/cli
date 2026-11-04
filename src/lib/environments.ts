import { Flags } from "@oclif/core";
import type { Command } from "@oclif/core";
import { credentials, projectLink } from "./config";
import { servicesApi, SERVICE_ENVS, type ServiceEnv } from "./api/services";
import type { Service } from "./api/types";
import { isInteractive, missingFlag } from "./utils/interactive";

// --env for commands that act on one environment. Production is the default, so existing scripts behave as before.
export const envFlag = Flags.string({
  description: "Environment to target",
  options: SERVICE_ENVS,
  default: "production",
});

export const asEnv = (value: string | undefined): ServiceEnv =>
  value === "staging" ? "staging" : "production";

// The linked service, after the login and link checks every platform command makes.
export async function linkedService(cmd: Command): Promise<Service> {
  if (!credentials.isValid()) cmd.error("Not logged in. Run 'apso login' first.");
  const link = projectLink.read();
  if (!link) cmd.error("Project not linked. Run 'apso link' first.");
  return servicesApi.get(link.workspaceId, link.serviceSlug);
}

// Asks before a step that costs money or replaces something; headless runs must pass --yes.
export async function confirmOrExit(cmd: Command, yes: boolean, question: string): Promise<boolean> {
  if (yes) return true;
  if (!isInteractive()) cmd.error(missingFlag(`${question} Pass --yes to proceed.`));
  const inquirer = await import("inquirer");
  const { ok } = await inquirer.default.prompt([
    { type: "confirm", name: "ok", message: question, default: false },
  ]);
  return ok;
}
