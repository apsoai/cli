import * as fs from "fs";
import { z } from "zod";
import { formatLintReport, lintSchema, runSchemaTool, Schema, schemaTools } from "@apso/schema-tools";
import { findConfigPath } from "./apsorc-parser";

export interface SchemaToolFileResult {
  ok: boolean;
  message: string;
  data?: unknown;
  configPath: string;
  /** True when the operation changed the schema and .apsorc was rewritten. */
  saved: boolean;
  lint: { errorCount: number; warningCount: number; report: string };
}

/**
 * Run one @apso/schema-tools operation on an .apsorc file: read it, apply the
 * operation, write it back when the operation changed the schema, and return
 * the lint result. An operation that would add a lint error is rejected by
 * the tool and the file is left untouched.
 */
export function applySchemaToolToFile(configPath: string, name: string, input: unknown): SchemaToolFileResult {
  // eslint-disable-next-line unicorn/prefer-json-parse-buffer -- JSON.parse's TS type requires a string
  const apsorc = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Schema & { version?: number };
  if (apsorc.version !== 2) {
    throw new Error("The schema tools support version 2 .apsorc files only.");
  }
  const result = runSchemaTool(apsorc, name, input);
  const saved = result.ok && result.schema !== apsorc;
  if (saved) fs.writeFileSync(configPath, `${JSON.stringify(result.schema, null, 2)}\n`, "utf-8");
  const lint = lintSchema(result.schema);
  return {
    ok: result.ok,
    message: result.message,
    ...(result.data === undefined ? {} : { data: result.data }),
    configPath,
    saved,
    lint: { errorCount: lint.errorCount, warningCount: lint.warningCount, report: formatLintReport(lint) },
  };
}

type ToolServer = {
  tool: (...args: any[]) => unknown;
};

/**
 * Register every @apso/schema-tools operation as a granular MCP tool on the
 * project's .apsorc (found from the current directory up), next to the coarse
 * design/validate/scaffold tools. The JSON Schema inputs from the package are
 * converted to zod for the MCP SDK.
 */
export function registerSchemaTools(server: ToolServer): void {
  for (const t of schemaTools) {
    const shape = (z.fromJSONSchema(t.inputSchema as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodObject).shape;
    server.tool(
      t.name,
      `${t.description} Operates on the .apsorc in the current project.${t.readOnly ? "" : " Writes the file only when the change lints clean of new errors."}`,
      shape,
      { readOnlyHint: t.readOnly },
      async (input: unknown) => {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            content: [{ type: "text" as const, text: "No .apsorc found in this directory or its parents. Run `apso init` first." }],
            isError: true,
          };
        }
        try {
          const result = applySchemaToolToFile(configPath, t.name, input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            isError: !result.ok,
          };
        } catch (error: unknown) {
          return {
            content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
          };
        }
      }
    );
  }
}
