import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { typeOrmAsyncConfig } from './orm.config';
import { HealthCheckController } from './healthCheck/HealthCheckController';
import moduleImports from './autogen';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync(typeOrmAsyncConfig),
    ...moduleImports,
  ],
  controllers: [HealthCheckController],
})
export class AppModule {}
