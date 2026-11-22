/**
 * CLI telemetry — usage analytics (PostHog) + error reporting (Sentry).
 *
 * Wired to the same Apso systems the web app and build engine use so CLI usage
 * shows up in the same funnels. Fully opt-out:
 *   - `apso config set telemetry off` (or `telemetryDisabled true`)
 *   - env APSO_TELEMETRY=0
 *   - env DO_NOT_TRACK=1  (honors the consoledonottrack.com standard)
 *   - env APSO_TELEMETRY_DISABLED=1  (legacy alias)
 *
 * The anonymous id is a random UUID persisted in the CLI config (`installId`),
 * never derived from any machine identifier. No code, schema, or file contents
 * are ever collected.
 *
 * Everything here is best-effort and MUST NOT throw or block a command. All
 * public functions swallow their own errors. The PostHog project keys and the
 * Sentry DSN are public client ingestion keys (the same class of token shipped
 * to browsers), safe to bundle.
 */
import { PostHog } from "posthog-node";
import * as Sentry from "@sentry/node";
import { createHash, randomUUID } from "crypto";
import os from "os";
import ciInfo from "ci-info";
import { globalConfig, credentials, projectLink } from "../config";
import { extractErrorProperties } from "./error-utils";

// Public ingestion keys (same tokens the browser/build-engine ship, per env).
const POSTHOG_KEY_PROD = "phc_Es9UUMw8pOs7Bs21b5PhfC5Qdo94GpYVv8MfdrG12LC";
const POSTHOG_KEY_STAGING = "phc_bkc33v3wo5LRvgPF6IdjsgDEDOwgJMz95MR2YIlvELk";
const POSTHOG_HOST = "https://us.i.posthog.com";

// Dedicated apsoai/apso-cli Sentry project DSN (public client key).
const SENTRY_DSN_DEFAULT =
  "https://754ae10322af78af3edbb87b93383ebb@o4509208616435714.ingest.us.sentry.io/4511796852162560";

let cliVersion = "0.0.0";
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cliVersion = require("../../../package.json").version || cliVersion;
} catch {
  // ignore
}

let posthog: PostHog | null = null;
let enabled = false;
let sentryOn = false;
let authenticatedUser = false;
let distinctId = "cli-anonymous";
let workspaceId: string | undefined;
let workspaceSlug: string | undefined;
let serviceId: string | undefined;
let environment: "production" | "staging" = "production";
let startedAt = Date.now();
let noticePending = false;

function isDisabled(telemetryDisabled: boolean): boolean {
  if (process.env.DO_NOT_TRACK === "1" || process.env.DO_NOT_TRACK === "true")
    return true;
  // Canonical opt-out env var (issue #96); APSO_TELEMETRY_DISABLED is a legacy alias.
  if (process.env.APSO_TELEMETRY === "0" || process.env.APSO_TELEMETRY === "false")
    return true;
  if (process.env.APSO_TELEMETRY_DISABLED === "1") return true;
  return Boolean(telemetryDisabled);
}

/** Stable, non-PII fallback id (only used if the config write fails). */
function anonMachineId(): string {
  const seed = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  return "cli_" + createHash("sha256").update(seed).digest("hex").slice(0, 20);
}

/**
 * Read (or lazily create + persist) the anonymous install id: a random UUID
 * stored in the CLI config. Not derived from any machine identifier. Falls
 * back to a stable hashed id only if the config can't be written.
 */
function getOrCreateInstallId(currentInstallId?: string): string {
  if (currentInstallId) return currentInstallId;
  const id = randomUUID();
  try {
    globalConfig.write({ installId: id });
    return id;
  } catch {
    return anonMachineId();
  }
}

/**
 * Initialize telemetry. Call once at process start (init hook). Safe to call
 * when disabled — it just no-ops everything downstream.
 */
export function initTelemetry(): void {
  try {
    startedAt = Date.now();
    const cfg = globalConfig.read();
    if (isDisabled(cfg.telemetryDisabled)) {
      enabled = false;
      return;
    }
    enabled = true;

    // Install uncaught exception and unhandled rejection handlers
    installGlobalErrorHandlers();
    environment = (cfg.apiUrl || "").includes("staging")
      ? "staging"
      : "production";

    // Show the transparency notice once, on the first enabled run.
    noticePending = !cfg.telemetryNoticeShown;

    const creds = credentials.read();
    authenticatedUser = Boolean(creds?.user?.id);
    const installId = getOrCreateInstallId(cfg.installId);
    // Logged in: the Apso user id (the same distinct id the web app uses), so
    // CLI and app activity land on one person. No email or name is sent.
    distinctId = creds?.user?.id ? String(creds.user.id) : installId;

    // Workspace context: the linked project (.apso/link.json) wins, else the
    // workspace chosen with `apso use`.
    let link: ReturnType<typeof projectLink.read> = null;
    try {
      link = projectLink.read();
    } catch {
      link = null;
    }
    workspaceId = link?.workspaceId || cfg.activeWorkspaceId || undefined;
    workspaceSlug = link?.workspaceSlug || cfg.activeWorkspaceSlug || undefined;
    serviceId = link?.serviceId || undefined;

    posthog = new PostHog(
      environment === "staging" ? POSTHOG_KEY_STAGING : POSTHOG_KEY_PROD,
      { host: POSTHOG_HOST, flushAt: 1, flushInterval: 0 }
    );
    // First run after login: merge this install's earlier anonymous events
    // into the user, once per user.
    if (authenticatedUser && installId !== distinctId && cfg.telemetryAliasedUserId !== distinctId) {
      posthog.alias({ distinctId, alias: installId });
      try {
        globalConfig.write({ telemetryAliasedUserId: distinctId });
      } catch {
        // ignore — worst case we alias again next run
      }
    }

    const dsn = process.env.APSO_CLI_SENTRY_DSN || SENTRY_DSN_DEFAULT;
    if (dsn) {
      Sentry.init({
        dsn,
        environment,
        release: `apso-cli@${cliVersion}`,
        tracesSampleRate: 0,
      });
      Sentry.setUser({ id: distinctId });
      Sentry.setTag("cli_version", cliVersion);
      if (workspaceId) Sentry.setTag("workspace_id", workspaceId);
      if (serviceId) Sentry.setTag("service_id", serviceId);
      sentryOn = true;
    }
  } catch {
    enabled = false;
  }
}

function commonProps(): Record<string, unknown> {
  return {
    cli_version: cliVersion,
    environment,
    os: os.platform(),
    arch: os.arch(),
    node_version: process.version,
    authenticated: authenticatedUser,
    ci: ciInfo.isCI,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    ...(workspaceSlug ? { workspace_slug: workspaceSlug } : {}),
    ...(serviceId ? { service_id: serviceId } : {}),
  };
}

/**
 * The one-time transparency notice text (issue #96). Printed to stderr by the
 * init hook so it never pollutes stdout / piped output.
 */
export const FIRST_RUN_NOTICE =
  "Apso collects usage data (command name, CLI version, OS) to improve the tool. When you're\n" +
  "logged in, it's tied to your Apso account id and workspace id. No email, code, schema, or\n" +
  "file contents are collected.\n" +
  "Opt out any time: apso config set telemetry off  (or APSO_TELEMETRY=0, or DO_NOT_TRACK=1)";

/**
 * True once per install: telemetry is enabled and the notice hasn't been shown
 * yet. The init hook prints the notice and then calls markFirstRunNoticeShown().
 */
export function shouldShowFirstRunNotice(): boolean {
  return enabled && noticePending;
}

/** Persist that the transparency notice has been shown. Best-effort. */
export function markFirstRunNoticeShown(): void {
  noticePending = false;
  try {
    globalConfig.write({ telemetryNoticeShown: true });
  } catch {
    // ignore — worst case the notice shows again next run
  }
}

/** Emit a PostHog event. No-op when disabled. */
export function track(event: string, properties: Record<string, unknown> = {}): void {
  try {
    if (!enabled || !posthog) return;
    posthog.capture({
      distinctId,
      event,
      properties: { ...commonProps(), ...properties },
      // PostHog group analytics: roll activity up per workspace.
      ...(workspaceId ? { groups: { workspace: workspaceId } } : {}),
    });
  } catch {
    // never break a command over telemetry
  }
}

/** Report an exception to Sentry. No-op when disabled. */
export function captureException(
  err: unknown,
  context: Record<string, unknown> = {}
): void {
  try {
    if (!enabled || !sentryOn) return;
    Sentry.captureException(err, { extra: context });
  } catch {
    // ignore
  }
}

/**
 * Capture an exception event in PostHog with structured error properties.
 *
 * PostHog's posthog-node SDK (v5.21.2+) doesn't have a direct captureException
 * method, so we send an $exception event with $exception_list in the standard
 * format: https://posthog.com/docs/data/exceptions
 *
 * @param err - The error to capture
 * @param context - Additional context properties (command, etc.)
 */
export function capturePostHogException(
  err: unknown,
  context: Record<string, unknown> = {}
): void {
  try {
    if (!enabled || !posthog) return;

    const errorProps = extractErrorProperties(err);
    const stack = err instanceof Error ? err.stack : undefined;

    // PostHog exception format: $exception event with $exception_list
    posthog.capture({
      distinctId,
      event: "$exception",
      properties: {
        ...commonProps(),
        ...context,
        // eslint-disable-next-line camelcase
        $exception_list: [
          {
            // eslint-disable-next-line camelcase
            type: errorProps.error_class || "Error",
            // eslint-disable-next-line camelcase
            value: errorProps.error_message || String(err),
            ...(stack ? { stacktrace: { frames: parseStackTrace(stack) } } : {}),
          },
        ],
        // Additional structured error properties
        ...errorProps,
      },
      ...(workspaceId ? { groups: { workspace: workspaceId } } : {}),
    });
  } catch {
    // never break a command over telemetry
  }
}

/**
 * Parse a stack trace string into PostHog's frame format.
 * Best-effort parsing; PostHog accepts frames with minimal structure.
 */
function parseStackTrace(stack: string): Array<Record<string, unknown>> {
  try {
    const lines = stack.split("\n").slice(1); // Skip the error message line
    return lines.slice(0, 10).map((line) => {
      // Basic parsing: extract function name and location if available
      const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
      if (match) {
        const [, fn, filename, lineno, colno] = match;
        return {
          function: fn || "<anonymous>",
          filename: filename?.replace(os.homedir(), "~") || "unknown",
          lineno: Number.parseInt(lineno, 10),
          colno: Number.parseInt(colno, 10),
        };
      }
      return { raw: line.trim() };
    });
  } catch {
    return [{ raw: "Failed to parse stack trace" }];
  }
}

/** Milliseconds since the process (CLI invocation) started. */
export function elapsedMs(): number {
  return Date.now() - startedAt;
}

/** Flush + close both clients. Call before the process exits. */
export async function shutdownTelemetry(): Promise<void> {
  try {
    if (posthog) await posthog.shutdown();
  } catch {
    // ignore
  }
  try {
    if (sentryOn) await Sentry.close(2000);
  } catch {
    // ignore
  }
}

/**
 * Install global handlers for uncaught exceptions and unhandled rejections.
 * These are captured in both Sentry and PostHog.
 */
function installGlobalErrorHandlers(): void {
  process.on("uncaughtException", (err: Error) => {
    try {
      // eslint-disable-next-line camelcase
      captureException(err, { event_type: "uncaught_exception" });
      // eslint-disable-next-line camelcase
      capturePostHogException(err, { event_type: "uncaught_exception" });
      // Flush both clients before the process exits
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      shutdownTelemetry();
    } catch {
      // ignore
    }
  });

  process.on("unhandledRejection", (reason: unknown) => {
    try {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      // eslint-disable-next-line camelcase
      captureException(err, { event_type: "unhandled_rejection" });
      // eslint-disable-next-line camelcase
      capturePostHogException(err, { event_type: "unhandled_rejection" });
    } catch {
      // ignore
    }
  });
}

export const __testing = { isDisabled, anonMachineId, getOrCreateInstallId };
