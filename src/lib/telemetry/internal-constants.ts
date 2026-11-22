/**
 * Constants for detecting internal (Apso team/system) CLI runs.
 *
 * Internal runs are explicitly marked so external anonymous users can be
 * isolated in both PostHog and Sentry. This is separate from CI: CI is not
 * always internal, and internal is not always CI.
 */

/**
 * GitHub repository owners that are considered internal.
 * Any workflow in a repo owned by these orgs/users is marked internal.
 */
export const INTERNAL_GITHUB_OWNERS = ["apsoai"];

/**
 * Email domains that are considered internal.
 * Users with these domains are marked as internal.
 */
export const INTERNAL_EMAIL_DOMAINS = ["apso.ai", "mavrictech.com"];

/**
 * Workspace slugs that are considered internal.
 * Users in these workspaces are marked as internal.
 */
export const INTERNAL_WORKSPACE_SLUGS = ["apso", "apso-team", "mavric"];

/**
 * Workspace IDs that are considered internal.
 * Users in these workspaces are marked as internal.
 */
export const INTERNAL_WORKSPACE_IDS: string[] = [
  // Add specific workspace IDs here when known
];
