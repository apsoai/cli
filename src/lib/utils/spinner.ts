/**
 * Spinner Utility
 *
 * Thin wrapper around `ora` for consistent spinner behavior.
 * Respects the noColor config setting.
 */

import { globalConfig } from "../config";

interface SpinnerInstance {
  start(text?: string): SpinnerInstance;
  stop(): SpinnerInstance;
  succeed(text?: string): SpinnerInstance;
  fail(text?: string): SpinnerInstance;
  text: string;
}

/**
 * Create a spinner that respects noColor config.
 * Falls back to simple log messages if ora is not available.
 */
export async function createSpinner(text: string): Promise<SpinnerInstance> {
  const config = globalConfig.read();

  try {
    // Dynamic import to keep ora optional at startup
    const ora = (await import("ora")).default;
    const spinner = ora({
      text,
      color: config.noColor ? undefined : "cyan",
      isSilent: false,
    });
    return spinner;
  } catch {
    // Fallback: simple text output when ora is not installed
    return createFallbackSpinner(text);
  }
}

/**
 * Fallback spinner that uses plain text output.
 */
function createFallbackSpinner(initialText: string): SpinnerInstance {
  let currentText = initialText;

  const instance: SpinnerInstance = {
    get text() {
      return currentText;
    },
    set text(value: string) {
      currentText = value;
    },
    start(text?: string) {
      if (text) currentText = text;
      console.log(`  ${currentText}...`);
      return instance;
    },
    stop() {
      return instance;
    },
    succeed(text?: string) {
      console.log(`  ${text || currentText}`);
      return instance;
    },
    fail(text?: string) {
      console.log(`  ${text || currentText}`);
      return instance;
    },
  };

  return instance;
}
