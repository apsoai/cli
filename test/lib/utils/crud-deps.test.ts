import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  APSO_CRUD_DEPS,
  ensureCrudDeps,
  ensureLoggingWiring,
  writeAccessManifest,
} from "../../../src/lib/utils/crud-deps";
import { zipProject } from "../../../src/lib/deploy/server-push";
import AdmZip from "adm-zip";
import { TypeScriptGenerator } from "../../../src/lib/generators/typescript";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";

function projectWith(pkg: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-crud-deps-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  return dir;
}
const readPkg = (dir: string) =>
  // eslint-disable-next-line unicorn/prefer-json-parse-buffer -- JSON.parse's TS type requires a string
  JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));

describe("ensureCrudDeps", () => {
  test("adds @apso/crud* to a v1 (@nestjsx/crud) project and keeps @nestjsx", () => {
    const dir = projectWith({
      dependencies: { "@nestjs/core": "^10.0.0", "@nestjsx/crud": "4.5.0" },
    });

    expect(ensureCrudDeps(dir)).toEqual(Object.keys(APSO_CRUD_DEPS));

    const deps = readPkg(dir).dependencies;
    for (const [name, version] of Object.entries(APSO_CRUD_DEPS)) {
      expect(deps[name]).toBe(version);
    }
    expect(deps["@nestjsx/crud"]).toBe("4.5.0");
    expect(fs.readFileSync(path.join(dir, "package.json"), "utf8").endsWith("\n")).toBe(true);
  });

  test("leaves a v2 project untouched", () => {
    const dir = projectWith({ dependencies: { ...APSO_CRUD_DEPS, "@apso/crud": "^1.2.0" } });
    const before = fs.readFileSync(path.join(dir, "package.json"), "utf8");

    expect(ensureCrudDeps(dir)).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "package.json"), "utf8")).toBe(before);
  });

  test("raises a range that starts below the release the generated code needs", () => {
    const dir = projectWith({
      dependencies: { "@apso/crud": "^1.0.1", "@apso/crud-core": "1.0.3", "@apso/crud-request": "^1.0.1", "@apso/crud-typeorm": "~1.0.2" },
    });

    expect(ensureCrudDeps(dir)).toEqual(["@apso/crud", "@apso/crud-core", "@apso/crud-typeorm", "@apso/postgrest-request"]);
    expect(readPkg(dir).dependencies).toEqual(APSO_CRUD_DEPS);
    expect(ensureCrudDeps(dir)).toEqual([]);
  });

  test("leaves a local build or a tag alone", () => {
    const deps = { ...APSO_CRUD_DEPS, "@apso/crud": "file:../apso-crud-1.0.3.tgz", "@apso/crud-core": "next" };
    const dir = projectWith({ dependencies: deps });

    expect(ensureCrudDeps(dir)).toEqual([]);
    expect(readPkg(dir).dependencies).toEqual(deps);
  });

  test("is a no-op without a package.json", () => {
    expect(ensureCrudDeps(fs.mkdtempSync(path.join(os.tmpdir(), "apso-crud-deps-")))).toEqual([]);
  });
});

// Drift guard: every @apso/* package the generated code imports must be one
// ensureCrudDeps declares. Uses the prod "Inventory Management" schema that
// failed the in-browser build (9 entities, 13 relationships, 5 FKs on one
// entity) so the import surface is broad.
describe("generated TypeScript imports", () => {
  test("only import @apso packages listed in APSO_CRUD_DEPS", async () => {
    const rc = JSON.parse(
      // eslint-disable-next-line unicorn/prefer-json-parse-buffer -- JSON.parse's TS type requires a string
      fs.readFileSync(path.join(__dirname, "../../fixtures/inventory-multi-fk.apsorc"), "utf8")
    );
    const { entities, relationshipMap } = parseApsorcV2(rc);
    const generator = new TypeScriptGenerator({
      rootFolder: "src",
      entities,
      relationshipMap,
      apiType: "rest",
      language: "typescript",
    });

    const files = [];
    /* eslint-disable no-await-in-loop -- generated in order, like generate.ts */
    for (const entity of entities) {
      const args = {
        entity,
        relationships: relationshipMap[entity.name] || [],
        allEntities: entities,
        apiType: "rest",
        relationshipMap,
      };
      files.push(
        ...(await generator.generateEntity(args)),
        ...(await generator.generateDto(args)),
        ...(await generator.generateService(args)),
        ...(await generator.generateController(args)),
        ...(await generator.generateModule({ ...args, includeController: true }))
      );
    }
    /* eslint-enable no-await-in-loop */
    files.push(...(await generator.generateGuards(entities)));

    const imported = new Set<string>();
    for (const f of files) {
      for (const m of f.content.matchAll(/from ["'](@apso\/[\w-]+)/g)) imported.add(m[1]);
    }
    expect(imported.size).toBeGreaterThan(0);
    for (const name of imported) expect(Object.keys(APSO_CRUD_DEPS)).toContain(name);
  });
});

// The entry points of the pinned service-template-ts tag.
const MAIN_TS = `// Must be the very first import.
import './tracing';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.rest';
import { configureNestApp } from './config/nest-app.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await configureNestApp(app);
  await app.listen(process.env.APP_PORT || 3000);
}

bootstrap();
`;
const LAMBDA_TS = `import { configure as serverlessExpress } from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.rest';

let cachedServer;

export const handler = async (event, context) => {
  if (!cachedServer) {
    const nestApp = await NestFactory.create(AppModule);
    await nestApp.init();
    cachedServer = serverlessExpress({ app: nestApp.getHttpAdapter().getInstance() });
  }

  return cachedServer(event, context);
}`;

const loggingProject = (files: Record<string, string>) => {
  const dir = projectWith({ dependencies: {} });
  fs.mkdirSync(path.join(dir, "src"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, "src", name), text);
  return dir;
};
const readSrc = (dir: string, name: string) => fs.readFileSync(path.join(dir, "src", name), "utf8");

describe("ensureLoggingWiring", () => {
  test("adds the package and the call to the server and the Lambda entry points, once", () => {
    const dir = loggingProject({ "main.ts": MAIN_TS, "lambda.ts": LAMBDA_TS });

    expect(ensureLoggingWiring(dir, "src")).toEqual({
      changed: ["package.json", "src/main.ts", "src/lambda.ts"],
      manual: [],
    });
    expect(readPkg(dir).dependencies["@apso/logging"]).toBeDefined();

    const main = readSrc(dir, "main.ts");
    expect(main).toContain(
      "  const app = await NestFactory.create(AppModule, { bufferLogs: true });\n  // One JSON line per request with who called, and a request id on every line.\n  useApsoLogging(app);\n  await configureNestApp(app);"
    );
    // ./tracing has to stay the first import.
    expect(main.indexOf("import './tracing'")).toBeLessThan(main.indexOf("@apso/logging"));
    expect(readSrc(dir, "lambda.ts")).toContain(
      "    const nestApp = await NestFactory.create(AppModule, { bufferLogs: true });\n    // One JSON line per request with who called, and a request id on every line.\n    useApsoLogging(nestApp);\n    await nestApp.init();"
    );

    expect(ensureLoggingWiring(dir, "src")).toEqual({ changed: [], manual: [] });
    expect(readSrc(dir, "main.ts")).toBe(main);
  });

  test("leaves a bootstrap it does not recognise alone and names it", () => {
    const custom = MAIN_TS.replace("NestFactory.create(AppModule)", "NestFactory.create(AppModule, { cors: true })");
    const dir = loggingProject({ "main.ts": custom });

    expect(ensureLoggingWiring(dir, "src")).toEqual({ changed: ["package.json"], manual: ["src/main.ts"] });
    expect(readSrc(dir, "main.ts")).toBe(custom);
  });
});

describe("writeAccessManifest", () => {
  test("writes .apso/manifest.json, keeps other fields, and the deploy zip carries it", () => {
    const dir = projectWith({});
    fs.mkdirSync(path.join(dir, ".apso", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".apso", "link.json"), "{}");
    fs.writeFileSync(path.join(dir, ".apso", "manifest.json"), '{"other":true,"cliVersion":"0.1.0"}');

    writeAccessManifest(dir, "9.9.9");

    const file = path.join(dir, ".apso", "manifest.json");
    expect(fs.readFileSync(file, "utf8")).toBe(
      '{\n  "other": true,\n  "cliVersion": "9.9.9",\n  "accessContract": 1\n}\n'
    );
    const zipped = new AdmZip(zipProject(dir)).getEntries().map((e) => e.entryName).filter((n) => !n.endsWith("/"));
    expect(zipped.sort()).toEqual([".apso/manifest.json", "package.json"]);
  });

  test("says when git ignores the file", () => {
    const dir = projectWith({});
    require("child_process").execFileSync("git", ["init", "-q", dir]);
    expect(writeAccessManifest(dir, "1.0.0")).toBe(false);
    fs.writeFileSync(path.join(dir, ".gitignore"), ".apso/\n");
    expect(writeAccessManifest(dir, "1.0.0")).toBe(true);
  });
});

describe("GraphQL", () => {
  test("TypeScript generation refuses apiType graphql: no guard runs on resolvers", () => {
    const config = { rootFolder: "src", entities: [{ name: "A", fields: [] }], relationshipMap: {}, apiType: "graphql", language: "typescript" as const };
    const result = new TypeScriptGenerator(config).validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain('"apiType": "Rest"');
  });
});
