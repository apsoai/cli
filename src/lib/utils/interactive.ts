/**
 * Interactive vs headless detection.
 *
 * Humans get prompts; agents and CI must run headless — every value comes from
 * a flag and the CLI never blocks on a prompt. Headless is forced by
 * APSO_NONINTERACTIVE=1, by CI=true, or auto-detected when stdin/stdout is not
 * a TTY (e.g. an agent capturing output). Commands should check `isInteractive()`
 * and, when false, require the equivalent flag instead of prompting.
 */
export function isInteractive(): boolean {
  if (
    process.env.APSO_NONINTERACTIVE === "1" ||
    process.env.APSO_NONINTERACTIVE === "true"
  ) {
    return false;
  }
  if (process.env.CI === "true" || process.env.CI === "1") {
    return false;
  }
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Message for a missing required value in headless mode. Name the flag that
 * would have supplied it so an agent can retry deterministically.
 */
export function missingFlag(details: string): string {
  return `Running non-interactively (no TTY / CI / APSO_NONINTERACTIVE). ${details}`;
}
