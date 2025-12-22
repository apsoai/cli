import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.rest';
import { configureNestApp } from './config/nest-app.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await configureNestApp(app);
  await app.listen(process.env.APP_PORT || 3000);
}

bootstrap();
