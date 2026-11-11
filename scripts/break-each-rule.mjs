#!/usr/bin/env node
/**
 * Proves the access suite can fail (apsoai/cli#210): a rule is only covered
 * if removing its protection turns a case for that rule red.
 *
 * Runs scripts/auth-smoke.mjs once unchanged, then once per entry in
 * scripts/access-mutations.mjs with that protection removed from the generated
 * service. A removal is caught when, for every rule it names, a case for that
 * rule passes unchanged and fails with the removal. The check fails when a
 * removal is not caught, no longer applies, or a rule marked enforced in
 * src/lib/access/rules.json has no removal and no stated reason.
 *
 * Slow (one build per removal): run it before a CLI release, not per commit.
 *
 * Usage: node scripts/break-each-rule.mjs <typescript|python|go> [mutation id...]
 * Needs the same setup as scripts/auth-smoke.mjs.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import access from "../dist/lib/access/index.js";
import { MUTATIONS, NOT_BREAKABLE } from "./access-mutations.mjs";

const language = process.argv[2];
const only = process.argv.slice(3);
if (!["typescript", "python", "go"].includes(language)) {
  console.error("usage: node scripts/break-each-rule.mjs <typescript|python|go> [mutation id...]");
  process.exit(2);
}
const SMOKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "auth-smoke.mjs");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "apso-break-rule-"));
const mutations = MUTATIONS.filter((m) => m[language] && (only.length === 0 || only.includes(m.id)));
const problems = [];

function run(legs, mutation) {
  const out = path.join(work, `${mutation ?? "unchanged"}.json`);
  const r = spawnSync(process.execPath, [SMOKE, language, ...legs], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, AUTH_SMOKE_PROJECT: path.join(work, "project"), AUTH_SMOKE_RESULTS: out, AUTH_SMOKE_MUTATION: mutation ?? "" },
  });
  fs.writeFileSync(path.join(work, `${mutation ?? "unchanged"}.log`), `${r.stdout}\n${r.stderr}`);
  const results = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : undefined;
  return { results, output: `${r.stdout}\n${r.stderr}` };
}

const caseKey = (c) => `${c.leg}|${c.label.replace(/ \(\d+\)$/, "")}`;

try {
  const legs = [...new Set(mutations.flatMap((m) => m.legs))];
  console.log(`==> ${language}: unchanged service (${legs.join(", ")})`);
  const base = run(legs).results;
  if (!base) throw new Error(`the unchanged run did not finish; see ${work}/unchanged.log`);
  // A leg that stopped part way ran only some of its cases, so removals would look uncaught.
  const stopped = base.failures.filter((f) => /did not start| failed:/.test(f));
  if (stopped.length > 0) throw new Error(`a leg of the unchanged run stopped part way:\n${stopped.join("\n").slice(0, 2000)}`);
  const passing = new Set(base.results.filter((c) => c.pass).map(caseKey));
  const already = base.results.filter((c) => !c.pass);
  if (already.length > 0) console.log(`    ${already.length} case(s) already fail unchanged; they do not count as catching a removal`);

  const lines = [];
  for (const m of mutations) {
    console.log(`==> ${language}: remove ${m.removes} (${m.id})`);
    const { results, output } = run(m.legs, m.id);
    let outcome;
    if (output.includes("MUTATION DID NOT APPLY")) outcome = "DID NOT APPLY";
    else if (!results) outcome = "DID NOT RUN";
    else {
      const caught = results.results.filter((c) => !c.pass && passing.has(caseKey(c)));
      const missed = m.rules.filter((rule) => !caught.some((c) => c.rules.includes(rule)));
      const total = caught.filter((c) => c.rules.some((rule) => m.rules.includes(rule))).length;
      // A removal that stops the service from building or starting fails no case by name.
      const broke = results.failures.some((f) => /did not start| failed:/.test(f));
      if (missed.length === 0) outcome = `caught (${total} cases)`;
      else if (broke && total === 0) outcome = "DID NOT RUN (the service did not build or start)";
      else outcome = `NOT CAUGHT for ${missed.join(", ")}`;
    }
    console.log(`    ${outcome}`);
    lines.push(`${m.rules.join(",").padEnd(8)} ${m.id.padEnd(26)} ${outcome}`);
    if (!outcome.startsWith("caught")) problems.push(`${m.rules.join(",")}: removing ${m.removes} (${m.id}): ${outcome}`);
  }

  console.log(`\nBreak each rule, ${language}\nrules    removal                    result`);
  for (const line of lines) console.log(line);
  const covered = new Set(mutations.flatMap((m) => m.rules));
  console.log("\nRules with no removal:");
  for (const rule of access.RULES) {
    if (rule.status[language] !== "enforced" || covered.has(rule.id)) continue;
    if (NOT_BREAKABLE[rule.id]) console.log(`${rule.id.padEnd(8)} ${NOT_BREAKABLE[rule.id]}`);
    else if (only.length === 0) {
      console.log(`${rule.id.padEnd(8)} NONE`);
      problems.push(`${rule.id} is marked enforced for ${language} and has no removal in scripts/access-mutations.mjs`);
    }
  }
} catch (error) {
  problems.push(error.message);
} finally {
  if (!process.env.AUTH_SMOKE_KEEP) fs.rmSync(work, { recursive: true, force: true });
  else console.log(`\nLogs and results kept in ${work}`);
}

if (problems.length > 0) {
  console.log(`\nFAIL (${language}): the suite did not catch every removal`);
  for (const p of problems) console.log(`- ${p}`);
  process.exit(1);
}
console.log(`\nPASS (${language}): every removal failed a case for its rule`);
