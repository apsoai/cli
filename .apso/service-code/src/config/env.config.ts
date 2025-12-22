import * as env from 'dotenv';

export interface EnvConfigOptions {
  APP_PORT: number;
  APP_SITE: string;
  APP_NAME: string;
  ALLOWED_ORIGINS: string;
  COOKIE_HTTP_ONLY: boolean;
  COOKIE_PATH: string;
  COOKIE_DOMAIN: string;
  COOKIE_SAME_SITE: boolean | 'lax' | 'strict' | 'none';
  COOKIE_SECURE: boolean;
  LOG_LEVEL: string;
  SESSION_KEY: string;
  SESSION_SECRET: string;
  ACCESS_SECRET_TOKEN: string;
  REFRESH_SECRET_TOKEN: string;
  DATABASE_TYPE: 'postgres' | 'mysql';
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_USERNAME: string;
  DATABASE_PASSWORD: string;
  DATABASE_NAME: string;
  DATABASE_SCHEMA: string;
  DATABASE_SYNC: string;
  DATABASE_LOGGING:
    | boolean
    | 'all'
    | ('query' | 'schema' | 'error' | 'warn' | 'info' | 'log' | 'migration')[];
  ENV: 'local' | 'dev' | 'staging' | 'production';
  STRIPE_CHECKOUT_CANCEL_URL: string;
  STRIPE_CHECKOUT_SUCCESS_URL: string;
}

const defaultConfig: EnvConfigOptions = {
  APP_PORT: 3200,
  APP_SITE: 'http://localhost',
  APP_NAME: 'Apso Template',
  ALLOWED_ORIGINS: 'locahost',
  COOKIE_HTTP_ONLY: true,
  COOKIE_PATH: '/auth/refresh_token',
  COOKIE_DOMAIN: 'http://localhost:3001',
  COOKIE_SAME_SITE: false,
  COOKIE_SECURE: false,
  LOG_LEVEL: 'debug',
  SESSION_KEY: 'aid',
  SESSION_SECRET: 'wine is fine, whiskey is swell, but beer is better',
  ACCESS_SECRET_TOKEN: 'spidey sense is dense',
  REFRESH_SECRET_TOKEN: 'but ironman is not ironic',
  DATABASE_TYPE: 'postgres',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: 54322,
  DATABASE_USERNAME: 'apso',
  DATABASE_PASSWORD: 'password',
  DATABASE_NAME: 'apso',
  DATABASE_SCHEMA: 'apso_test',
  DATABASE_SYNC: 'false',
  DATABASE_LOGGING: 'all',
  ENV: 'local',
  STRIPE_CHECKOUT_CANCEL_URL: '',
  STRIPE_CHECKOUT_SUCCESS_URL: '',
};

export const config: EnvConfigOptions = {
  ...defaultConfig,
  ...process.env,
  ...env.config().parsed,
};
