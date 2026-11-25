/**
 * Detection logic for internal (Apso team/system) CLI runs.
 *
 * Multiple detection methods ensure all internal runs are tagged, with any
 * match marking the run as internal. The override env var APSO_INTERNAL=0
 * forces false for testing external behavior internally.
 */

import {
  INTERNAL_GITHUB_OWNERS,
  INTERNAL_EMAIL_DOMAINS,
  INTERNAL_WORKSPACE_SLUGS,
  INTERNAL_WORKSPACE_IDS,
} from "./internal-constants";

export type InternalReason =
  | "env"
  | "github_owner"
  | "config"
  | "account"
  | "workspace";

export interface InternalDetectionResult {
  internal: boolean;
  reason?: InternalReason;
}

/**
 * Detect if this CLI run should be marked as internal.
 *
 * Detection methods, in order of precedence:
 * 1. Explicit env var APSO_INTERNAL (1/true = internal, 0 = force false override)
 * 2. GitHub Actions auto-detection (GITHUB_ACTIONS=true + owner in INTERNAL_GITHUB_OWNERS)
 * 3. Config flag: `apso config set internal true`
 * 4. Account-based: authenticated user email domain or workspace
 *
 * @param opts - Detection context
 * @returns Object with internal boolean and reason
 */
export function detectInternal(opts: {
  configInternal?: boolean;
  userEmail?: string;
  workspaceSlug?: string;
  workspaceId?: string;
}): InternalDetectionResult {
  // 1. Explicit env var (with override)
  const envVar = process.env.APSO_INTERNAL;
  if (envVar === "0" || envVar === "false") {
    // Force false - for testing external behavior internally
    return { internal: false };
  }
  if (envVar === "1" || envVar === "true") {
    return { internal: true, reason: "env" };
  }

  // 2. GitHub Actions auto-detection
  if (process.env.GITHUB_ACTIONS === "true") {
    const repoOwner =
      process.env.GITHUB_REPOSITORY_OWNER ||
      process.env.GITHUB_REPOSITORY?.split("/")[0];
    if (
      repoOwner &&
      INTERNAL_GITHUB_OWNERS.some(
        (owner) => owner.toLowerCase() === repoOwner.toLowerCase()
      )
    ) {
      return { internal: true, reason: "github_owner" };
    }
  }

  // 3. Config flag: apso config set internal true
  if (opts.configInternal === true) {
    return { internal: true, reason: "config" };
  }

  // 4. Account-based: email domain
  if (opts.userEmail) {
    const domain = opts.userEmail.split("@")[1]?.toLowerCase();
    if (domain && INTERNAL_EMAIL_DOMAINS.includes(domain)) {
      return { internal: true, reason: "account" };
    }
  }

  // 4. Account-based: workspace slug or ID
  if (opts.workspaceSlug) {
    const slug = opts.workspaceSlug.toLowerCase();
    if (INTERNAL_WORKSPACE_SLUGS.includes(slug)) {
      return { internal: true, reason: "workspace" };
    }
  }
  if (opts.workspaceId && INTERNAL_WORKSPACE_IDS.includes(opts.workspaceId)) {
    return { internal: true, reason: "workspace" };
  }

  return { internal: false };
}

/**
 * Extract email domain from an email address (without sending the full email).
 *
 * @param email - Email address
 * @returns Domain part of the email (e.g., "apso.ai")
 */
export function getEmailDomain(email: string): string | undefined {
  return email.split("@")[1]?.toLowerCase();
}
