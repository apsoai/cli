/**
 * Upgrade-on-limit flow.
 *
 * When the platform rejects an action for a plan or billing reason (the free-tier
 * service cap, staging on a free service, a suspended service), the CLI opens the
 * web app page where the user fixes it and retries once they are done.
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
 * Open the web app page that resolves a plan or billing refusal, then wait for
 * the user to finish there. Returns true if the caller should retry.
 */
export async function promptUpgrade(
  error: ApiClientError,
  ctx: PageContext = {}
): Promise<boolean> {
  const { url, label } = fixPage(error, ctx);

  console.log("");
  console.log(`  ⚠  ${error.message || "You've reached a plan limit."}`);
  console.log("");
  console.log(`  Opening ${label} in your browser: ${url}`);
  console.log("  If the browser doesn't open, visit the URL above.");
  console.log("");
  await openBrowser(url);

  const { done } = await inquirer.prompt<{ done: boolean }>([
    {
      type: "confirm",
      name: "done",
      message: "Done there? Retry now",
      default: true,
    },
  ]);

  if (!done) console.log(`  You can finish this any time at: ${url}`);
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
