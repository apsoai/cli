import { Controller } from '@nestjs/common';
import {
  Crud,
  CrudController,
  Override,
  ParsedRequest,
  CrudRequest,
  ParsedBody,
  CreateManyDto,
} from '@nestjsx/crud';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { TestCustomer, TestCustomerCreate } from './dtos/TestCustomer.dto';
import { TestCustomerService } from './TestCustomer.service';
import { DataSource } from 'typeorm';

@Crud({
  model: {
    type: TestCustomer,
  },
  dto: {
    create: TestCustomerCreate,
    update: TestCustomer,
    replace: TestCustomer,
  },
  query: {
    /**
     * commenting out limit and pagination because of an issue with Crud lib: https://github.com/nestjsx/crud/issues/777
     */
    // TODO: make limit env driven?
    limit: 5,
    alwaysPaginate: true,
    join: {
      facilities: { eager: false },
      'facilities.customer': { eager: false },
    },
  },
})
@Controller('TestCustomers')
@ApiTags('Test Customers')
export class TestCustomerController implements CrudController<TestCustomer> {
  constructor(
    public service: TestCustomerService,
    private dataSource: DataSource,
  ) {}

  get base(): CrudController<TestCustomer> {
    return this;
  }

  @Override('getManyBase')
  @ApiOperation({ summary: 'Retrieve multiple Customers' })
  getMany(@ParsedRequest() req: CrudRequest) {
    return this.base.getManyBase(req);
  }

  @Override('getOneBase')
  @ApiOperation({ summary: 'Retrieve a single Customer' })
  get(@ParsedRequest() req: CrudRequest) {
    return this.base.getOneBase(req);
  }

  @Override('createOneBase')
  @ApiOperation({ summary: 'Create a single Customer' })
  @ApiBody({
    type: TestCustomerCreate,
    description:
      'The Description for the Post Body. Please look into the DTO. You will see the @ApiOptionalProperty used to define the Schema.',
  })
  create(@ParsedRequest() req: CrudRequest, @ParsedBody() dto: TestCustomer) {
    return this.base.createOneBase(req, dto);
  }

  @Override('createManyBase')
  @ApiOperation({ summary: 'Create multipleCustomers' })
  createMany(
    @ParsedRequest() req: CrudRequest,
    @ParsedBody() dto: CreateManyDto<TestCustomer>,
  ) {
    return this.base.createManyBase(req, dto);
  }

  @Override('updateOneBase')
  @ApiOperation({ summary: 'Update a single Customer' })
  update(@ParsedRequest() req: CrudRequest, @ParsedBody() dto: TestCustomer) {
    return this.base.updateOneBase(req, dto);
  }

  @Override('replaceOneBase')
  @ApiOperation({ summary: 'Replace a single Customer' })
  replace(@ParsedRequest() req: CrudRequest, @ParsedBody() dto: TestCustomer) {
    return this.base.replaceOneBase(req, dto);
  }

  @Override('deleteOneBase')
  @ApiOperation({ summary: 'Delete a single Customer' })
  delete(@ParsedRequest() req: CrudRequest) {
    return this.base.deleteOneBase(req);
  }
}
