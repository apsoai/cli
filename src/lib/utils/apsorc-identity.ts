import * as fs from "fs";
import * as path from "path";

export interface ApsorcIdentity {
  /** Service slug. Becomes service.name in telemetry. */
  serviceName: string;
  serviceId: string;
  workspaceId: string;
}

/**
 * Write the registered service's name and ids into .apsorc so the generated
 * service can report who it is at startup. Returns false when there is no
 * readable .apsorc (the caller decides whether that matters).
 */
export function writeApsorcIdentity(
  projectDir: string,
  identity: ApsorcIdentity
): boolean {
  const file = path.join(projectDir, ".apsorc");
  if (!fs.existsSync(file)) return false;
  const raw = fs.readFileSync(file, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const indent = /\n(\s+)"/.exec(raw)?.[1] ?? "  ";
  const { serviceName, serviceId, workspaceId } = identity;
  const rest = { ...parsed };
  delete rest.serviceName;
  delete rest.serviceId;
  delete rest.workspaceId;
  const ids = { serviceName, serviceId: String(serviceId), workspaceId: String(workspaceId) };
  // Keep "version" first, then the identity, then the rest of the file.
  const next =
    "version" in rest
      ? { version: rest.version, ...ids, ...rest }
      : { ...ids, ...rest };
  fs.writeFileSync(file, JSON.stringify(next, null, indent) + "\n");
  return true;
}
