import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TypeOrmCrudService } from '@nestjsx/crud-typeorm';
import { QueryOptions } from '@nestjsx/crud';
import { ParsedRequestParams } from '@nestjsx/crud-request';

import { TestCustomer } from './TestCustomer.entity';

@Injectable()
export class TestCustomerService extends TypeOrmCrudService<TestCustomer> {
  constructor(@InjectRepository(TestCustomer) repo) {
    super(repo);
  }

  /**
   *
   * Solves https://github.com/nestjsx/crud/issues/777
   */
  getSelect(query: ParsedRequestParams, options: QueryOptions) {
    return [...new Set(super.getSelect(query, options))];
  }
}
