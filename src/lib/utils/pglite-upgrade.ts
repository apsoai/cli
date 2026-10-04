import * as fs from "fs";
import * as path from "path";
import { addMissingDeps } from "./crud-deps";

/**
 * PGlite packages the upgraded orm.config.ts loads. Versions match the pinned
 * service-template-ts tag (see TEMPLATE_REFS in ./template.ts).
 */
export const PGLITE_DEPS: Record<string, string> = {
  "@electric-sql/pglite": "^0.5.2",
  "typeorm-pglite": "^0.3.2",
};

/** src/orm.config.ts as the v1 template shipped it (no PGlite support). */
export const ORM_CONFIG_V1 = `import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  TypeOrmModuleAsyncOptions,
  TypeOrmModuleOptions,
} from '@nestjs/typeorm';
import { join } from 'path';
import AppConfig from './config';

const sslConfig = process.env.DB_SSL
  ? {
      ssl: true,
      extra: {
        ssl: {
          rejectUnauthorized: false,
        },
      },
    }
  : {};

const ormConfig = {
  type: AppConfig.database.type as any,
  host: AppConfig.database.host,
  port: parseInt(AppConfig.database.port, 10),
  username: AppConfig.database.username,
  database: AppConfig.database.database,
  password: AppConfig.database.password,
  schema: AppConfig.database.schema,
  entities: [join(__dirname, '**', '*.entity.js')],
  migrations: [join(__dirname, '**', 'migrations/*-migration.js')],
  synchronize: AppConfig.database.synchronize,
  logging: AppConfig.database.logging,
  ...sslConfig,
};

export const typeOrmAsyncConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (): Promise<TypeOrmModuleOptions> => {
    console.log('ORM CONFIG', ormConfig);
    return ormConfig;
  },
};

export default new DataSource(ormConfig);
`;

/**
 * The v1 orm.config.ts with a PGlite branch for DATABASE_TYPE=pglite. Same
 * exports and same behavior for every other database type.
 */
export const ORM_CONFIG_V1_PGLITE = `import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  TypeOrmModuleAsyncOptions,
  TypeOrmModuleOptions,
} from '@nestjs/typeorm';
import { join } from 'path';
import AppConfig from './config';

// DATABASE_TYPE=pglite runs on an in-process Postgres (PGlite) for local
// checks: apso migrate verify, apso test smoke, and the in-browser editor.
// PGLITE_DATA_DIR keeps the database on disk between commands.
const usePGlite = process.env.DATABASE_TYPE === 'pglite';

const sslConfig = process.env.DB_SSL
  ? {
      ssl: true,
      extra: {
        ssl: {
          rejectUnauthorized: false,
        },
      },
    }
  : {};

const ormConfig = {
  ...(usePGlite
    ? {
        type: 'postgres' as const,
        // Loaded only for PGlite so production installs never need it.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        driver: new (require('typeorm-pglite').PGliteDriver)({
          dataDir: process.env.PGLITE_DATA_DIR,
        }).driver,
      }
    : {
        type: AppConfig.database.type as any,
        host: AppConfig.database.host,
        port: parseInt(AppConfig.database.port, 10),
        username: AppConfig.database.username,
        database: AppConfig.database.database,
        password: AppConfig.database.password,
        schema: AppConfig.database.schema,
        ...sslConfig,
      }),
  entities: [join(__dirname, '**', '*.entity.js')],
  migrations: [join(__dirname, '**', 'migrations/*-migration.js')],
  synchronize: AppConfig.database.synchronize,
  logging: AppConfig.database.logging,
};

export const typeOrmAsyncConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (): Promise<TypeOrmModuleOptions> => {
    console.log('ORM CONFIG', { ...ormConfig, driver: usePGlite ? '[PGliteDriver]' : undefined });
    return ormConfig;
  },
};

export default new DataSource(ormConfig);
`;

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * Give a v1-template project PGlite support so the pre-deploy checks (apso
 * migrate verify, apso test smoke) can run. Replaces src/orm.config.ts only
 * when it is still the stock v1 file, so a customized config is never
 * overwritten, and declares the PGlite packages.
 *
 * @param {string} projectDir - The service project root.
 * @returns {boolean} True when orm.config.ts was upgraded.
 */
export function upgradeOrmConfigForPglite(projectDir: string): boolean {
  const file = path.join(projectDir, "src", "orm.config.ts");
  if (!fs.existsSync(file)) return false;
  const current = fs.readFileSync(file, "utf8");
  if (squash(current) === squash(ORM_CONFIG_V1)) {
    fs.writeFileSync(file, ORM_CONFIG_V1_PGLITE);
    addMissingDeps(projectDir, PGLITE_DEPS);
    return true;
  }
  // typeorm-pglite 0.3.4 takes an options object; given the data dir as a
  // string it runs in memory, so each command starts from an empty database.
  // { dataDir } works with 0.3.2 too.
  const fixed = current.replace(
    /new PGliteDriver\(\s*process\.env\.PGLITE_DATA_DIR(?:\s*\|\|\s*undefined)?\s*\)/g,
    "new PGliteDriver({ dataDir: process.env.PGLITE_DATA_DIR })"
  );
  if (fixed === current) return false;
  fs.writeFileSync(file, fixed);
  return true;
}
