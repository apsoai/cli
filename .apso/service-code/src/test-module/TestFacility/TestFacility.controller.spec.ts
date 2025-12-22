import { Test, TestingModule } from '@nestjs/testing';
import { TestFacility } from './dtos/TestFacility.dto';
import { TestFacilityController } from './TestFacility.controller';
import { TestFacilityService } from './TestFacility.service';
import { CrudRequest } from '@nestjsx/crud';

const baseRequest: CrudRequest = {
  parsed: {
    fields: [],
    paramsFilter: [],
    search: {},
    filter: [],
    or: [],
    join: [],
    sort: [],
    authPersist: undefined,
    limit: 10,
    offset: 0,
    page: 1,
    cache: undefined,
  },
  options: {},
};

describe('TestFacilityController', () => {
  let controller: TestFacilityController;
  let spyService: TestFacilityService;

  beforeEach(async () => {
    const ApiServiceProvider = {
      provide: TestFacilityService,
      useFactory: () => ({
        createOne: jest.fn(() => []),
        getOne: jest.fn(() => {}),
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestFacilityController],
      providers: [TestFacilityService, ApiServiceProvider],
    }).compile();

    controller = module.get<TestFacilityController>(TestFacilityController);
    spyService = module.get<TestFacilityService>(TestFacilityService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call FacilityController get method', () => {
    const req: CrudRequest = { ...baseRequest };
    expect(controller.get(req)).not.toEqual(null);
    expect(spyService.getOne).toHaveBeenCalled();
  });

  it('should call FacilityController create method', () => {
    const req: CrudRequest = { ...baseRequest };

    const dto = new TestFacility();
    controller.create(req, dto);
    expect(controller.create(req, dto)).not.toEqual(null);
    expect(spyService.createOne).toHaveBeenCalled();
  });

  // Add your tests here
});
