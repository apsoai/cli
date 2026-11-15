/**
 * Run the access rule cases on a project: start its service locally the way
 * `apso test smoke` does, point its token check at a local issuer, and report
 * rule by rule. Nothing is regenerated: the service's own AUTH_JWT_ISSUER and
 * AUTH_JWKS_URI settings are what make the test tokens acceptable.
 */

// eslint-disable-next-line node/no-missing-import
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// eslint-disable-next-line node/no-missing-import
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AuthConfig, authProviders, resolveJwtAuth } from "../types/auth";
import { Entity } from "../types/entity";
import { TargetLanguage } from "../types/generator";
import { RelationshipMap } from "../types/relationship";
import { SMOKE_KEY, Step, smokeTest } from "../verify";
import { McpClient, buildModel, runAccessCases } from "./cases";
import { CaseResult, Language, RULES, createReport } from "./report";
import { Issuer, startIssuer } from "./tokens";

/** An MCP client for the cases, over the service's /mcp endpoint. */
export async function connectMcp(base: string, headers: Record<string, string>): Promise<McpClient> {
  const client = new Client({ name: "apso-access", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return {
    listTools: async () => {
      const { tools } = await client.listTools();
      return tools.map((tool) => tool.name);
    },
    callTool: async (name, args) => {
      const result: any = await client.callTool({ name, arguments: args });
      const text: string = result.content?.[0]?.text ?? "";
      if (result.isError) return { error: text || "refused" };
      try {
        return { json: JSON.parse(text) };
      } catch {
        return { json: undefined };
      }
    },
  };
}

export interface AccessLine {
  id: string;
  rule: string;
  /** pass, FAIL, or why the rule has no result here. */
  result: string;
  cases: number;
  detail: string;
}

export interface AccessResult {
  ok: boolean;
  /** Build and start steps; a failure here means no case ran. */
  steps: Step[];
  lines: AccessLine[];
  failures: CaseResult[];
  notes: string[];
}

export interface AccessOptions {
  skipBuild?: boolean;
  language?: TargetLanguage;
  auth?: AuthConfig;
  log?: (line: string) => void;
}

const BUILD_TIME = new Set(["R26", "R27"]);

export async function accessTest(
  projectDir: string,
  entities: Entity[],
  relationships: RelationshipMap,
  { skipBuild = false, language = "typescript", auth, log }: AccessOptions = {}
): Promise<AccessResult> {
  const lang = language as Language;
  const report = createReport(lang, log ?? (() => null));
  const notes: string[] = [];
  let issuer: Issuer | undefined;
  // Every provider is a JWT provider. AUTH_JWT_ISSUER and AUTH_JWKS_URI point
  // the first listed one at the local issuer, so test users sign in through it.
  const providers = authProviders(auth);
  if (providers.length > 0) issuer = await startIssuer(resolveJwtAuth(providers[0]));
  else notes.push("This project has no auth block, so there are no user callers. Only the rules for API keys ran.");
  if (providers.length > 1)
    notes.push(`auth lists ${providers.length} providers. Test users sign in through the first ("${providers[0].provider}").`);

  const model = buildModel(entities, relationships, lang, providers.find((p) => p.permissionEntity) ?? providers[0]);
  const key = { "x-api-key": SMOKE_KEY };
  let result;
  try {
    result = await smokeTest(projectDir, entities, relationships, {
      skipBuild,
      language,
      env: issuer?.env,
      check: async (base) => {
        await runAccessCases({
          base,
          model,
          t: report.checker(language),
          key,
          user: issuer?.user,
          roles: issuer?.roles,
          badTokens: issuer?.badTokens(),
          mcp: (headers) => connectMcp(base, headers),
          log,
          warn: (line) => notes.push(`Warning (not a rule failure): ${line}`),
        });
      },
    });
  } finally {
    issuer?.close();
  }
  const ran = result.steps[0]?.name !== "skipped" && result.steps.every((s) => s.ok);
  if (!ran) return { ok: result.ok && result.steps[0]?.name === "skipped", steps: result.steps, lines: [], failures: [], notes };

  const lines = report.rows().map((row): AccessLine => {
    const rule = RULES.find((r) => r.id === row.id)!;
    const cases = row.passed + row.failed;
    let [outcome, detail] = [row.result, ""];
    if (cases === 0) {
      if (rule.platform) [outcome, detail] = ["n/a", `Platform only. ${rule.platform}`];
      else if (row.status === "pending") [outcome, detail] = ["pending", `Not built yet (${rule.issue}).`];
      else if (row.status === "refused") [outcome, detail] = ["n/a", `apso generate refuses this feature for ${language}.`];
      else if (BUILD_TIME.has(row.id) || row.status === "na") [outcome, detail] = ["n/a", "Checked by apso generate, not at run time."];
      else [outcome, detail] = ["not run", "Nothing in this schema calls for it, or it needs user sign-in."];
    }
    return { id: row.id, rule: row.rule, result: outcome, cases, detail };
  });
  const failures = report.results.filter((c) => !c.pass);
  return { ok: failures.length === 0, steps: result.steps, lines, failures, notes };
}
