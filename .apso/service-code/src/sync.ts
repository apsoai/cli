import { DataSource } from 'typeorm';
import { join } from 'path';
import AppConfig from './config';

(async () => {
  console.log('Database config: \n');
  const db: any = {
    type: AppConfig.database.type as any,
    host: AppConfig.database.host,
    port: parseInt(AppConfig.database.port, 10),
    username: AppConfig.database.username,
    database: AppConfig.database.database,
    password: AppConfig.database.password,
    schema: AppConfig.database.schema,
    synchronize: AppConfig.database.synchronize,
    logging: AppConfig.database.logging,
    entities: [join(__dirname, '**', '*.entity.ts')],
  };
  console.log(db);
  const PostgresDataSource = new DataSource(db);
  try {
    await PostgresDataSource.initialize();
    console.log('Data Source has been initialized!');
    await PostgresDataSource.synchronize();
    console.log('Data Source has been synchronized!');
  } catch (err) {
    console.error('Error during Data Source synchronization');
    console.error(err);
  }
})();
