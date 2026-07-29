#!/usr/bin/env node
/**
 * Passive Apso usage stats (issue #96, part A).
 *
 * Pulls public download counts — no account, no key, no auth:
 *   - npm  : https://api.npmjs.org/downloads  (@apso/cli, @apso/domain-events)
 *   - PyPI : https://pypistats.org/api        (apso-domain-events)
 *
 * These are coarse trend signals only: downloads are not active users, CI and
 * mirrors inflate them, and unpublished packages return zero. The Go module
 * proxy exposes no easy public per-module count, so Go is omitted.
 *
 * Usage: node scripts/usage-stats.mjs [period]
 *   period = last-day | last-week | last-month (default: last-month)
 */

const PERIOD = process.argv[2] || "last-month";
const NPM_PACKAGES = ["@apso/cli", "@apso/domain-events"];
const PYPI_PACKAGES = ["apso-domain-events"];

async function npmDownloads(pkg) {
  const url = `https://api.npmjs.org/downloads/point/${PERIOD}/${pkg}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { pkg, downloads: null, note: `HTTP ${res.status}` };
    const json = await res.json();
    return { pkg, downloads: json.downloads ?? null };
  } catch (err) {
    return { pkg, downloads: null, note: String(err.message || err) };
  }
}

async function pypiDownloads(pkg) {
  const url = `https://pypistats.org/api/packages/${pkg}/recent`;
  const map = { "last-day": "last_day", "last-week": "last_week", "last-month": "last_month" };
  try {
    const res = await fetch(url);
    if (!res.ok) return { pkg, downloads: null, note: `HTTP ${res.status}` };
    const json = await res.json();
    return { pkg, downloads: json?.data?.[map[PERIOD]] ?? null };
  } catch (err) {
    return { pkg, downloads: null, note: String(err.message || err) };
  }
}

function fmt(row) {
  const count = row.downloads === null ? "n/a" : String(row.downloads);
  const note = row.note ? `  (${row.note})` : "";
  return `  ${row.pkg.padEnd(24)} ${count.padStart(10)}${note}`;
}

async function main() {
  console.log(`Apso download stats (${PERIOD}) — coarse trend only, not active users\n`);
  console.log("npm:");
  for (const pkg of NPM_PACKAGES) console.log(fmt(await npmDownloads(pkg)));
  console.log("\nPyPI:");
  for (const pkg of PYPI_PACKAGES) console.log(fmt(await pypiDownloads(pkg)));
  console.log("\nGo: no public per-module count from the module proxy (omitted).");
}

main();
