import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";
import { buildBaseline } from "../../../src/lib/verify";
import { schemaDdl } from "../../../src/lib/ddl";
import { catalogDiff, readCatalog } from "../../../src/lib/ddl/catalog";

// The real reference: TypeORM schema:sync on the entities `apso generate`
// writes into a TypeScript service. Needs a scaffolded project with
// node_modules, so it runs only when APSO_PARITY_PROJECT points at one:
//   APSO_PARITY_PROJECT=/path/to/service npm test -- project-parity
const project = process.env.APSO_PARITY_PROJECT;
// Under NODE_ENV=test oclif loads src/*.ts; the scaffold step must run dist/.
process.env.NODE_ENV = "production";
const cliBin = path.join(__dirname, "../../../bin/run");
const fixtures = path.join(__dirname, "../../fixtures");
const cases: [string, string][] = [
  ...fs
    .readdirSync(path.join(fixtures, "plan"))
    .flatMap((c) =>
      (["before", "after"] as const).map((w): [string, string] => [
        `${c}/${w}`,
        path.join(fixtures, "plan", c, `${w}.apsorc`),
      ])
    ),
  ["inventory-multi-fk", path.join(fixtures, "inventory-multi-fk.apsorc")],
  [
    "decimal-example",
    path.join(__dirname, "../../apsorc-json/apsorc-decimal-example.json"),
  ],
  ["coverage", path.join(fixtures, "ddl", "coverage.apsorc")],
];

const catalogOf = async (
  dataDir: string | undefined,
  statements: string[] = []
) => {
  // The service's own PGlite wrote dataDir; the CLI's older one can't read it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PGlite } = require(require.resolve("@electric-sql/pglite", {
    paths: [project!],
  }));
  const db = new PGlite(dataDir);
  await db.exec(statements.join(";\n"));
  const catalog = await readCatalog(db);
  await db.close();
  return catalog;
};

(project ? describe : describe.skip)(
  "schemaDdl matches a generated service",
  () => {
    test.each(cases)(
      "%s",
      async (_name, file) => {
        const dataDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "apso-ddl-project-")
        );
        const step = await buildBaseline(project!, file, dataDir, cliBin);
        expect(step.output).toBeUndefined();
        const input = parseApsorcV2(
          JSON.parse(fs.readFileSync(file).toString())
        );
        const diff = catalogDiff(
          await catalogOf(dataDir),
          await catalogOf(undefined, schemaDdl(input))
        );
        expect(diff).toEqual([]);
      },
      300_000
    );
  }
);
