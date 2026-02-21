export * from "./types";
export * from "./platform-to-local";
export * from "./local-to-platform";

import { PlatformToLocalConverter } from "./platform-to-local";
import { LocalToPlatformConverter } from "./local-to-platform";
import { LocalApsorcSchema, ConversionResult } from "./types";

/**
 * Convert platform schema to local .apsorc format
 */
export function convertPlatformToLocal(
  platformSchema: any,
  options?: { preserveUnsupported?: boolean; warnUnsupported?: boolean }
): ConversionResult<LocalApsorcSchema> {
  const converter = new PlatformToLocalConverter(options);
  return converter.convert(platformSchema);
}

/**
 * Convert local .apsorc schema to platform format
 */
export function convertLocalToPlatform(
  localSchema: LocalApsorcSchema
): ConversionResult<any> {
  const converter = new LocalToPlatformConverter();
  return converter.convert(localSchema);
}

