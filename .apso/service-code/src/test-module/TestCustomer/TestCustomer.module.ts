import { Module } from '@nestjs/common';
import { TestCustomer } from './TestCustomer.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestCustomerService } from './TestCustomer.service';
import { TestCustomerController } from './TestCustomer.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TestCustomer])],
  providers: [TestCustomerService],
  exports: [TestCustomerService],
  controllers: [TestCustomerController],
})
export class TestCustomerModule {}
