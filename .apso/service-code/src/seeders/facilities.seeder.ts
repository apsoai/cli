import { Seeder } from 'typeorm-extension';
import { DataSource } from 'typeorm';
import { TestCustomer } from '../test-module/TestCustomer/TestCustomer.entity';
import { InternalServerErrorException } from '@nestjs/common';
import { FacilityData } from '../test-module//TestFacility/seeds/seed-data';
import { TestFacility } from '../test-module/TestFacility/TestFacility.entity';

export default class FacilitiesSeeder implements Seeder {
  public async run(dataSource: DataSource): Promise<void> {
    try {
      const allCustomers = await dataSource.getRepository(TestCustomer).find();
      const facilityRepository = dataSource.getRepository(TestFacility);
      const facilities = await facilityRepository.find();

      if (allCustomers.length && !facilities.length) {
        const createdFacilities = facilityRepository.create(FacilityData);
        const updatedFacilities = [];
        for (let index = 0; index < createdFacilities.length; index++) {
          const facility = createdFacilities[index];
          facility.customerId = allCustomers[index].id;
          updatedFacilities.push(facility);
        }

        await facilityRepository.save(updatedFacilities);
      }

      console.log(
        '>>>>>>>>>>>>>>>>Facilities CREATED SUCCESSFULLY>>>>>>>>>>>>>>>>>>',
      );
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }
}
