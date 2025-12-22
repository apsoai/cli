import { config } from './env.config';

export interface AppConfig {
  defaultAction: string;
  name: string;
  port: number;
  site: string;
  allowedOrigins: string;
  env: 'local' | 'dev' | 'staging' | 'production';
}

export const app: AppConfig = {
  defaultAction: 'handle',
  name: config.APP_NAME,
  port: config.APP_PORT,
  site: config.APP_SITE,
  allowedOrigins: config.ALLOWED_ORIGINS,
  env: config.ENV,
};

export interface LogConfig {
  colorize: boolean;
  level: string;
  timestamps: string;
}
export const log: LogConfig = {
  colorize: true,
  level: config.LOG_LEVEL,
  timestamps: 'quiet',
};
