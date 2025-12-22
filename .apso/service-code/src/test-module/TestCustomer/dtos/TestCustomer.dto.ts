import { ApiProperty } from '@nestjs/swagger';
import * as enums from '../../enums';

export class TestCustomerCreate {
  @ApiProperty()
  name: string;
  @ApiProperty()
  country: string;
  @ApiProperty()
  streetAddress1: string;
  @ApiProperty()
  streetAddress2: string;
  @ApiProperty()
  city: string;
  @ApiProperty()
  state: string;
  @ApiProperty()
  zipCode: string;
  @ApiProperty()
  phoneNumber: string;
  @ApiProperty()
  createdBy: string;
  @ApiProperty()
  status: enums.CustomerStatusEnum;
}

export class TestCustomer {
  @ApiProperty()
  id: number;
  @ApiProperty()
  name: string;
  @ApiProperty()
  country: string;
  @ApiProperty()
  streetAddress1: string;
  @ApiProperty()
  streetAddress2: string;
  @ApiProperty()
  city: string;
  @ApiProperty()
  state: string;
  @ApiProperty()
  zipCode: string;
  @ApiProperty()
  phoneNumber: string;
  @ApiProperty()
  createdBy: string;
  @ApiProperty()
  status: enums.CustomerStatusEnum;
  @ApiProperty()
  created_at: Date;
  @ApiProperty()
  updated_at: Date;
}
