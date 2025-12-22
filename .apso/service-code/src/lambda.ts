import { configure as serverlessExpress } from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.rest';
import { configureNestApp } from './config/nest-app.config';

let cachedServer;

export const handler = async (event, context) => {

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Max-Age': '86400',
      },
      body: '',
    };
  }

  if (!cachedServer) {
    const nestApp = await NestFactory.create(AppModule);

    nestApp.enableCors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      allowedHeaders: 'Content-Type,Authorization',
    });

    await configureNestApp(nestApp);
    await nestApp.init();
    cachedServer = serverlessExpress({
      app: nestApp.getHttpAdapter().getInstance(),
    });
  }

  return cachedServer(event, context);
};
