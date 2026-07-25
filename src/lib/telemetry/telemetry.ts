/**
 * CLI telemetry — usage analytics (PostHog) + error reporting (Sentry).
 *
 * Wired to the same Apso systems the web app and build engine use so CLI usage
 * shows up in the same funnels. Fully opt-out:
 *   - `apso config set telemetryDisabled true`
 *   - env DO_NOT_TRACK=1  (honors the console.dev standard)
 *   - env APSO_TELEMETRY_DISABLED=1
 *
 * Everything here is best-effort and MUST NOT throw or block a command. All
 * public functions swallow their own errors. The PostHog project keys and the
 * Sentry DSN are public client ingestion keys (the same class of token shipped
 * to browsers), safe to bundle.
 */
import { PostHog } from "posthog-node";
import * as Sentry from "@sentry/node";
import { createHash } from "crypto";
import os from "os";
import { globalConfig, credentials } from "../config";

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
let distinctId = "cli-anonymous";
let environment: "production" | "staging" = "production";
let startedAt = Date.now();

function isDisabled(telemetryDisabled: boolean): boolean {
  if (process.env.DO_NOT_TRACK === "1" || process.env.DO_NOT_TRACK === "true")
    return true;
  if (process.env.APSO_TELEMETRY_DISABLED === "1") return true;
  return !!telemetryDisabled;
}

/** Stable, non-PII fallback id for logged-out users (no username, no MAC). */
function anonMachineId(): string {
  const seed = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  return "cli_" + createHash("sha256").update(seed).digest("hex").slice(0, 20);
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
    environment = (cfg.apiUrl || "").includes("staging")
      ? "staging"
      : "production";

    const creds = credentials.read();
    distinctId = creds?.user?.id || anonMachineId();

    posthog = new PostHog(
      environment === "staging" ? POSTHOG_KEY_STAGING : POSTHOG_KEY_PROD,
      { host: POSTHOG_HOST, flushAt: 1, flushInterval: 0 }
    );
    if (creds?.user?.email) {
      // Attach identity so CLI events attribute to the same person as the app.
      posthog.identify({
        distinctId,
        properties: { email: creds.user.email, name: creds.user.name },
      });
    }

    const dsn = process.env.APSO_CLI_SENTRY_DSN || SENTRY_DSN_DEFAULT;
    if (dsn) {
      Sentry.init({
        dsn,
        environment,
        release: `apso-cli@${cliVersion}`,
        tracesSampleRate: 0,
      });
      Sentry.setUser({ id: distinctId, email: creds?.user?.email });
      Sentry.setTag("cli_version", cliVersion);
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
    authenticated: distinctId !== anonMachineId() && !distinctId.startsWith("cli_"),
  };
}

/** Emit a PostHog event. No-op when disabled. */
export function track(event: string, properties: Record<string, unknown> = {}): void {
  try {
    if (!enabled || !posthog) return;
    posthog.capture({
      distinctId,
      event,
      properties: { ...commonProps(), ...properties },
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

export const __testing = { isDisabled, anonMachineId };
