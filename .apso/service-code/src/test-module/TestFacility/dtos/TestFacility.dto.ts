import { ApiProperty } from '@nestjs/swagger';
import * as enums from '../../enums';

export class TestFacilityCreate {
  @ApiProperty()
  name: string;
  @ApiProperty()
  contactName: string;
  @ApiProperty()
  streetAddress1: string;
  @ApiProperty()
  streetAddress2: string;
  @ApiProperty()
  city: string;
  @ApiProperty()
  state: string;
  @ApiProperty()
  country: string;
  @ApiProperty()
  zipCode: string;
  @ApiProperty()
  status: enums.FacilityStatusEnum;
  @ApiProperty()
  weight: string;
  @ApiProperty()
  customerId: number;
}

export class TestFacility {
  @ApiProperty()
  id: number;
  @ApiProperty()
  name: string;
  @ApiProperty()
  contactName: string;
  @ApiProperty()
  streetAddress1: string;
  @ApiProperty()
  streetAddress2: string;
  @ApiProperty()
  city: string;
  @ApiProperty()
  state: string;
  @ApiProperty()
  country: string;
  @ApiProperty()
  zipCode: string;
  @ApiProperty()
  status: enums.FacilityStatusEnum;
  @ApiProperty()
  weight: string;
  @ApiProperty()
  customerId: number;
  @ApiProperty()
  created_at: Date;
  @ApiProperty()
  updated_at: Date;
}
