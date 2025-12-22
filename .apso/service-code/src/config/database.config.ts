import { DataSourceOptions } from 'typeorm';
import { config } from './env.config';

export const database: DataSourceOptions = {
  type: config.DATABASE_TYPE,
  host: config.DATABASE_HOST,
  port: config.DATABASE_PORT,
  username: config.DATABASE_USERNAME,
  password: config.DATABASE_PASSWORD,
  database: config.DATABASE_NAME,
  schema: config.DATABASE_SCHEMA,
  // Environment Variables store as a string but this prop expects a boolean value.
  synchronize: /^true$/i.test(config.DATABASE_SYNC),
  logging: config.DATABASE_LOGGING,
};
