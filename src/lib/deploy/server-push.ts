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

/**
 * Never push local secrets to the repo. `.env` and `.env.*` (e.g. `.env.local`)
 * routinely hold DB passwords and session secrets; `.env.example` is the one
 * env file that is meant to be committed. The backend injects real production
 * env at runtime, so these are never needed in the pushed code.
 */
function isSecretEnvFile(basename: string): boolean {
  if (basename === ".env.example" || basename === ".env.sample") return false;
  return basename === ".env" || basename.startsWith(".env.");
}

/** Zip the project source into a buffer, skipping build/vcs/dependency/secret files. */
export function zipProject(cwd: string): Buffer {
  const zip = new AdmZip();
  zip.addLocalFolder(cwd, "", (filename: string) => {
    const parts = filename.split(path.sep);
    if (parts.some((p) => EXCLUDE_DIRS.has(p))) return false;
    const base = parts[parts.length - 1];
    if (isSecretEnvFile(base)) return false;
    return true;
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

  // Record the S3 metadata (bucket/key/version) on the service row. The
  // presigned PUT lands the zip in S3 but does NOT persist where it went; the
  // backend push reads s3_code_key from the DB, so without this it fails with
  // "No S3 code found". Same three-step flow the browser upload uses.
  await codeApi.finalize(opts.serviceId);

  await githubApi.push(opts.serviceId, opts.connectionId, {
    branch: opts.branch,
    message: opts.message,
  });
}
