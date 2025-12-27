/**
 * Platform CLI Configuration Module
 *
 * Exports configuration types, paths, and managers.
 */

export * from "./types";
export * from "./paths";
export {
  globalConfig,
  credentials,
  projectLink,
  syncQueue,
  createBackup,
} from "./manager";
