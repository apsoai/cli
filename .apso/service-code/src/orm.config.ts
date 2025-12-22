import { ConfigModule, ConfigService } from '@nestjs/config';
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
