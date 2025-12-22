import * as request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestCustomer } from './TestCustomer.entity';
import { TestFacility } from '../TestFacility/TestFacility.entity';
import { TestCustomerController } from './TestCustomer.controller';
import { TestCustomerService } from './TestCustomer.service';
import { TypeORMMySqlTestingModule } from '../test-utils/TypeormTestingModule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

describe('TestCustomerController', () => {
  let app: INestApplication;
  let controller: TestCustomerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeORMMySqlTestingModule([TestCustomer, TestFacility]),
        TypeOrmModule.forFeature([TestCustomer, TestFacility]),
      ],
      controllers: [TestCustomerController],
      providers: [TestCustomerService],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    controller = module.get<TestCustomerController>(TestCustomerController);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call CustomerController get method with fields and join', async () => {
    const response = await request(app.getHttpServer()).get(
      '/TestCustomers?fields=status&join=facilities',
    );
    const { body: { data } = {} } = response;
    expect(response.status).toBe(200);
    expect(data).toBeDefined();
    expect(data.length).toBe(5);
    expect(data[0].facilities).toBeDefined();
    expect(data[0].facilities[0].id).toBeTruthy();
  });

  it('should call CustomerController get method with join and filter', async () => {
    const response = await request(app.getHttpServer()).get(
      '/TestCustomers?join[]=facilities||id,status&filter[0]=id||$eq||4',
    );
    const { body: { data } = {} } = response;
    expect(data[0]?.id).toBe(4);
  });

  it('should call CustomerController get method with search containing "D"', async () => {
    const response = await request(app.getHttpServer()).get(
      '/TestCustomers?s={"name": {"$contL": "David"}}',
    );
    const { body: { data } = {} } = response;
    expect(response.status).toBe(200);
    expect(data).toBeDefined();
    expect(data[0].name).toBe('David Lee');
  });

  it('should call CustomerController get method with complex search and condition', async () => {
    const response = await request(app.getHttpServer()).get(
      '/TestCustomers?s={"$and": [{"status": {"$eq":"Active"}},{"name": {"$ends": "Smith"}}]}',
    );
    const { body: { data } = {} } = response;
    expect(response.status).toBe(200);
    expect(data).toBeDefined();
    expect(data[0].name).toBe('Jane Smith');
  });

  it('should call CustomerController get method with filter in condition', async () => {
    const response = await request(app.getHttpServer()).get(
      '/TestCustomers?filter=state||$in||CA,NY',
    );
    const { body: { data } = {} } = response;
    expect(response.status).toBe(200);
    expect(data).toBeDefined();
    expect(data.length).toBe(2);
  });

  it('should call CustomerController get method with given filter, fields and sort', async () => {
    const response = await request(app.getHttpServer()).get(
      '/TestCustomers?fields=name,status&filter=city||$eq||New York&sort=name,ASC&page=1&limit=5',
    );
    const { body: { data } = {} } = response;
    expect(response.status).toBe(200);
    expect(data).toBeDefined();
    expect(data[0].name).toBe('John Doe');
  });

  it('should call CustomerController get method with fields, join and on condition', async () => {
    const response = await request(app.getHttpServer()).get(
      '/TestCustomers?fields=name&join[]=facilities||status||on[0]=facilities.status||$eq||Archived',
    );
    const { body: { data } = {} } = response;
    expect(response.status).toBe(200);
    expect(data).toBeDefined();
  });

  it('should call CustomerController get method with fields, aggregate function and group by', async () => {
    const response = await request(app.getHttpServer()).get(
      '/TestCustomers?fields=COUNT(id)&join[]=facilities||COUNT(id),status||on[0]=facilities.status||$eq||Archived&groupBy=1',
    );
    const { body: { data } = {} } = response;
    expect(response.status).toBe(200);
    expect(data).toBeDefined();
  });
});
