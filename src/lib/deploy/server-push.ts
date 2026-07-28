import AdmZip from "adm-zip";
import * as path from "path";
import { codeApi, githubApi } from "../api/services";

// Never ship these into the code zip — the backend reconstitutes the runnable
// base template and only needs the source + schema + user edits.
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".apso",
  "coverage",
]);

/** Zip the project source into a buffer, skipping build/vcs/dependency dirs. */
export function zipProject(cwd: string): Buffer {
  const zip = new AdmZip();
  zip.addLocalFolder(cwd, "", (filename: string) => {
    const parts = filename.split(path.sep);
    return !parts.some((p) => EXCLUDE_DIRS.has(p));
  });
  return zip.toBuffer();
}

/**
 * Server-side push: upload the project zip to S3 and have the platform push it
 * to the connected repo through the user's GitHub connection. No local git or
 * `gh` required — works on a bare machine that has only `apso login`.
 */
export async function serverSidePush(opts: {
  cwd: string;
  serviceId: string;
  connectionId: string;
  branch: string;
  message: string;
}): Promise<void> {
  const buffer = zipProject(opts.cwd);

  const { url } = await codeApi.getUploadUrl(opts.serviceId);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: buffer,
  });
  if (!res.ok) {
    throw new Error(
      `Code upload failed (${res.status}). ${await res.text().catch(() => "")}`
    );
  }

  await githubApi.push(opts.serviceId, opts.connectionId, {
    branch: opts.branch,
    message: opts.message,
  });
}
