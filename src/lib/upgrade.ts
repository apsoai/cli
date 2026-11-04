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
import { ApiClientError, APP_FIX_PAGES } from "./api/client";
import { globalConfig } from "./config";
import { isInteractive } from "./utils/interactive";

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

/** Where the user is when the refusal happened, so the link can go to the exact page. */
export interface PageContext {
  workspaceSlug?: string;
  serviceId?: string;
}

/** The web app page that resolves this refusal, and how to name it in a prompt. */
export function fixPage(
  error: ApiClientError,
  ctx: PageContext = {}
): { url: string; label: string } {
  const web = globalConfig.read().webUrl;
  const where = error.code ? APP_FIX_PAGES[error.code] : undefined;
  if (where === "service" && ctx.workspaceSlug && ctx.serviceId) {
    return {
      url: `${web}/${ctx.workspaceSlug}/services/${ctx.serviceId}/deployments`,
      label: "the service's Deployments page",
    };
  }
  if (where === "billing" && ctx.workspaceSlug) {
    return { url: `${web}/${ctx.workspaceSlug}/billing`, label: "Billing" };
  }
  return {
    url: `${web}${error.upgradeUrl || "/billing/upgrade"}`,
    label: "the upgrade page",
  };
}

/**
 * Prompt the user to resolve a plan or billing refusal in the web app, open the
 * page, and wait for them to finish. Returns true if the caller should retry.
 */
export async function promptUpgrade(
  error: ApiClientError,
  ctx: PageContext = {}
): Promise<boolean> {
  const { url: upgradeUrl, label } = fixPage(error, ctx);

  console.log("");
  console.log(`  ⚠  ${error.message || "You've reached a plan limit."}`);
  console.log("");

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: "confirm",
      name: "proceed",
      message: `Open ${label} in your browser?`,
      default: true,
    },
  ]);

  if (!proceed) {
    console.log(`  You can do this any time at: ${upgradeUrl}`);
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
      message: "Press enter once you are done there to retry",
      default: true,
    },
  ]);

  return done;
}

/**
 * Run an action; if it fails with an upgradeable plan-limit error, offer to
 * upgrade and retry once.
 */
export async function withUpgradeRetry<T>(
  action: () => Promise<T>,
  ctx: PageContext = {}
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ApiClientError && error.isLimitError()) {
      // Headless (agent/CI): never open a browser or prompt — surface the limit
      // as a clear error with the upgrade URL so the caller can act on it.
      if (!isInteractive()) {
        const { url } = fixPage(error, ctx);
        throw new Error(
          `${(error.message || "Plan limit reached").replace(/\.?$/, ".")} Resolve it at ${url}`
        );
      }
      const retry = await promptUpgrade(error, ctx);
      if (retry) {
        return action();
      }
    }
    throw error;
  }
}
