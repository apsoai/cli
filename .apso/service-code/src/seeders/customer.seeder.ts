import { Seeder } from 'typeorm-extension';
import { DataSource } from 'typeorm';
import { TestCustomer } from '../test-module/TestCustomer/TestCustomer.entity';
import { InternalServerErrorException } from '@nestjs/common';
import { CustomerData } from '../test-module/TestCustomer/seeds/seed-data';

export default class CustomerSeeder implements Seeder {
  public async run(dataSource: DataSource): Promise<void> {
    try {
      const customerRepository = dataSource.getRepository(TestCustomer);
      const allCustomers = await customerRepository.find();

      if (!allCustomers.length) {
        const customers = customerRepository.create(CustomerData);
        await customerRepository.save(customers);
      }

      console.log(
        '>>>>>>>>>>>>>>>>CUSTOMERS CREATED SUCCESSFULLY>>>>>>>>>>>>>>>>>>',
      );
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }
}
