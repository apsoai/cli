/**
 * TUI Entry Point
 *
 * Launches the interactive terminal UI for Apso CLI.
 */

import React from "react";
import { render } from "ink";
import { App } from "./App";

export async function startTui(): Promise<void> {
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();
}
