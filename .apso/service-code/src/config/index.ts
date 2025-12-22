import { DataSourceOptions } from 'typeorm';
import { token, TokenConfig } from './api.config';
import { app, AppConfig, log, LogConfig } from './app.config';
import { database } from './database.config';
import { cookie, CookieConfig, session, SessionConfig } from './http.config';

export interface Config {
  cookie: CookieConfig;
  database: DataSourceOptions;
  session: SessionConfig;
  app: AppConfig;
  log: LogConfig;
  token: TokenConfig;
}

export default {
  app,
  cookie,
  database,
  log,
  session,
  token,
} as any;
