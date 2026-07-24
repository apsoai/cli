/**
 * Upload the local project (the `apso generate` scaffold) to the service's S3
 * code bucket, mirroring the browser's "save code" flow: zip the files, PUT the
 * zip to a presigned S3 URL, then finalize. The GitHub push (S3 -> repo) and
 * the deploy both read from this S3 code.
 */

import JSZip from "jszip";
import * as fs from "fs";
import * as path from "path";
import { api } from "./api/client";

/** Directories never uploaded (build output, deps, VCS, local CLI state). */
const EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".apso",
  ".turbo",
]);

/** Files never uploaded (secrets are supplied by the deploy env, not the zip). */
const EXCLUDE_FILES = new Set([".DS_Store"]);
const EXCLUDE_FILE_PREFIXES = [".env"];

function addDirToZip(zip: JSZip, rootDir: string, currentDir: string): void {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      addDirToZip(zip, rootDir, abs);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      if (EXCLUDE_FILE_PREFIXES.some((p) => entry.name.startsWith(p))) continue;
      const rel = path.relative(rootDir, abs).split(path.sep).join("/");
      zip.file(rel, fs.readFileSync(abs));
    }
  }
}

export interface CodeUploadResult {
  version: string;
  size: number;
  fileCount: number;
}

/**
 * Zip `projectDir` and upload it as the service's code. Returns the recorded
 * S3 version + size.
 */
export async function uploadServiceCode(
  serviceId: string,
  projectDir: string
): Promise<CodeUploadResult> {
  if (!fs.existsSync(path.join(projectDir, ".apsorc"))) {
    throw new Error(
      `No .apsorc found in ${projectDir}. Run this from your service directory.`
    );
  }

  const zip = new JSZip();
  addDirToZip(zip, projectDir, projectDir);
  const fileCount = Object.values(zip.files).filter((f) => !f.dir).length;
  if (fileCount === 0) {
    throw new Error(`No files to upload in ${projectDir}`);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  // 1. Presigned S3 PUT URL (small request; safe through the SSR Lambda).
  const { url } = await api.get<{ url: string; bucket: string; key: string }>(
    `/api/services/${serviceId}/code/upload-url`
  );

  // 2. PUT the zip directly to S3. The presigned URL carries its own auth, so
  // this is a raw fetch (no Apso Authorization header). Content-Type must be
  // application/zip to match how the URL was signed.
  const putRes = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: buffer,
  });
  if (!putRes.ok) {
    throw new Error(`Failed to upload code to storage (${putRes.status})`);
  }

  // 3. Finalize: record S3 metadata in the platform.
  const result = await api.post<{ version: string; size: number }>(
    `/api/services/${serviceId}/code/finalize`,
    {}
  );

  return { version: result.version, size: result.size, fileCount };
}
