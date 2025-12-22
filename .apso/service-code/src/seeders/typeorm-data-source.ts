import { DataSource, DataSourceOptions } from 'typeorm';
import { SeederOptions } from 'typeorm-extension';
import 'dotenv/config';

const devPGOptions = {
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT) || 5432,
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
};

const prodPGOptions = { url: process.env.DATABASE_URL };

let options: DataSourceOptions & SeederOptions = {
  type: 'postgres',
  database: process.env.DATABASE_NAME || 'test',
  entities: ['src/**/**/*.entity.{ts,js}'],
  migrations: ['src/migrations/*{.ts,.js}'],
  seeds: ['src/seeders/*.seeder{.ts,.js}'],
  schema: process.env.DATABASE_SCHEMA,
};

if (process.env.NODE_ENV !== 'production') {
  options = { ...options, ...devPGOptions };
} else {
  options = { ...options, ...prodPGOptions };
}

const dataSource = new DataSource(options);
export default dataSource;
