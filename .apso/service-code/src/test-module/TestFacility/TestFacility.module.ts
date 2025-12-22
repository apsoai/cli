import { Module } from '@nestjs/common';
import { TestFacility } from './TestFacility.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestFacilityService } from './TestFacility.service';
import { TestFacilityController } from './TestFacility.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TestFacility])],
  providers: [TestFacilityService],
  exports: [TestFacilityService],
  controllers: [TestFacilityController],
})
export class TestFacilityModule {}
