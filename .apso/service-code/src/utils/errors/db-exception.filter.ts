import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError, TypeORMError } from 'typeorm';
import { GlobalResponseError } from './global.response.error';
import { getTypeOrmErrorCode } from './error.type';

@Catch(TypeORMError)
export class TypeORMErrorFilter implements ExceptionFilter {
  catch(exception: TypeORMError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    let message = (exception as any).message;
    let code = 'HttpException';

    Logger.error(
      message,
      (exception as any).stack,
      `${request.method} ${request.url}`,
    );

    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    switch (exception.constructor) {
      case QueryFailedError:
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        message = (exception as QueryFailedError).message;
        code = getTypeOrmErrorCode((exception as any).code);
        break;
      default:
        status = HttpStatus.INTERNAL_SERVER_ERROR;
    }

    response
      .status(status)
      .json(GlobalResponseError(status, message, code, request));
  }
}
