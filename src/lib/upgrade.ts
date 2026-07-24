/**
 * Upgrade-on-limit flow.
 *
 * When the platform rejects an action because the workspace hit a plan limit
 * (e.g. the free-tier service cap), we surface a friendly prompt that opens the
 * upgrade page in the browser and retries once the user is done — mirroring the
 * "you've hit a limit, upgrade?" flow developers expect from modern CLIs.
 */

import { exec } from "child_process";
import inquirer from "inquirer";
import { ApiClientError } from "./api/client";
import { globalConfig } from "./config";

/**
 * Open a URL in the default browser (best-effort).
 */
function openBrowser(url: string): Promise<void> {
  return new Promise((resolve) => {
    const platform = process.platform;
    const command =
      platform === "darwin"
        ? `open "${url}"`
        : platform === "win32"
          ? `start "" "${url}"`
          : `xdg-open "${url}"`;
    exec(command, () => resolve());
  });
}

/**
 * Prompt the user to upgrade after a limit error, open the upgrade page, and
 * wait for them to finish. Returns true if the caller should retry the action.
 */
export async function promptUpgrade(error: ApiClientError): Promise<boolean> {
  const config = globalConfig.read();
  const upgradeUrl = `${config.webUrl}${error.upgradeUrl || "/billing/upgrade"}`;

  console.log("");
  console.log(`  ⚠  ${error.message || "You've reached a plan limit."}`);
  console.log("");

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: "confirm",
      name: "proceed",
      message: "Open the upgrade page in your browser?",
      default: true,
    },
  ]);

  if (!proceed) {
    console.log(`  You can upgrade any time at: ${upgradeUrl}`);
    return false;
  }

  console.log("");
  console.log(`  Opening ${upgradeUrl}`);
  console.log("  If the browser doesn't open, visit the URL above.");
  await openBrowser(upgradeUrl);

  const { done } = await inquirer.prompt<{ done: boolean }>([
    {
      type: "confirm",
      name: "done",
      message: "Press enter once your upgrade is complete to retry",
      default: true,
    },
  ]);

  return done;
}

/**
 * Run an action; if it fails with an upgradeable plan-limit error, offer to
 * upgrade and retry once.
 */
export async function withUpgradeRetry<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ApiClientError && error.isLimitError()) {
      const retry = await promptUpgrade(error);
      if (retry) {
        return action();
      }
    }
    throw error;
  }
}
