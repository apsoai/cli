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
import { TestFacility, TestFacilityCreate } from './dtos/TestFacility.dto';
import { TestFacilityService } from './TestFacility.service';

@Crud({
  model: {
    type: TestFacility,
  },
  dto: {
    create: TestFacilityCreate,
    update: TestFacility,
    replace: TestFacility,
  },
  query: {
    /**
     * commenting out limit and pagination because of an issue with Crud lib: https://github.com/nestjsx/crud/issues/777
     */
    // TODO: make limit env driven?
    limit: 5,
    alwaysPaginate: true,
    join: {
      customer: { eager: false },
      'customer.facilities': { eager: false },
    },
  },
})
@Controller('TestFacilitys')
@ApiTags('Test Facilitys')
export class TestFacilityController implements CrudController<TestFacility> {
  constructor(public service: TestFacilityService) {}

  get base(): CrudController<TestFacility> {
    return this;
  }

  @Override('getManyBase')
  @ApiOperation({ summary: 'Retrieve multiple Facilitys' })
  getMany(@ParsedRequest() req: CrudRequest) {
    return this.base.getManyBase(req);
  }

  @Override('getOneBase')
  @ApiOperation({ summary: 'Retrieve a single Facility' })
  get(@ParsedRequest() req: CrudRequest) {
    return this.base.getOneBase(req);
  }

  @Override('createOneBase')
  @ApiOperation({ summary: 'Create a single Facility' })
  @ApiBody({
    type: TestFacilityCreate,
    description:
      'The Description for the Post Body. Please look into the DTO. You will see the @ApiOptionalProperty used to define the Schema.',
  })
  create(@ParsedRequest() req: CrudRequest, @ParsedBody() dto: TestFacility) {
    return this.base.createOneBase(req, dto);
  }

  @Override('createManyBase')
  @ApiOperation({ summary: 'Create multipleFacilitys' })
  createMany(
    @ParsedRequest() req: CrudRequest,
    @ParsedBody() dto: CreateManyDto<TestFacility>,
  ) {
    return this.base.createManyBase(req, dto);
  }

  @Override('updateOneBase')
  @ApiOperation({ summary: 'Update a single Facility' })
  update(@ParsedRequest() req: CrudRequest, @ParsedBody() dto: TestFacility) {
    return this.base.updateOneBase(req, dto);
  }

  @Override('replaceOneBase')
  @ApiOperation({ summary: 'Replace a single Facility' })
  replace(@ParsedRequest() req: CrudRequest, @ParsedBody() dto: TestFacility) {
    return this.base.replaceOneBase(req, dto);
  }

  @Override('deleteOneBase')
  @ApiOperation({ summary: 'Delete a single Facility' })
  delete(@ParsedRequest() req: CrudRequest) {
    return this.base.deleteOneBase(req);
  }
}
