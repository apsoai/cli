import {
  Column,
  Entity,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { IsOptional, IsNotEmpty } from 'class-validator';
import { CrudValidationGroups } from '@nestjsx/crud';
import * as enums from '../enums';
import { TestFacility } from '../TestFacility/TestFacility.entity';

const { CREATE, UPDATE } = CrudValidationGroups;

@Entity('test-customer')
export class TestCustomer {
  // Fields
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @IsOptional({ groups: [UPDATE] })
  @IsNotEmpty({ groups: [CREATE] })
  @Column({ type: 'text', nullable: false })
  name: string;

  @IsOptional({ groups: [UPDATE] })
  @IsNotEmpty({ groups: [CREATE] })
  @Column({ type: 'text', nullable: false })
  country: string;

  @IsOptional({ groups: [UPDATE] })
  @IsNotEmpty({ groups: [CREATE] })
  @Column({ type: 'text', nullable: false })
  streetAddress1: string;

  @IsOptional({ groups: [UPDATE] })
  @IsNotEmpty({ groups: [CREATE] })
  @Column({ type: 'text', nullable: false })
  streetAddress2: string;

  @IsOptional({ groups: [UPDATE] })
  @IsNotEmpty({ groups: [CREATE] })
  @Column({ type: 'text', nullable: false })
  city: string;

  @IsOptional({ groups: [UPDATE] })
  @IsNotEmpty({ groups: [CREATE] })
  @Column({ type: 'text', nullable: false })
  state: string;

  @IsOptional({ groups: [UPDATE] })
  @IsNotEmpty({ groups: [CREATE] })
  @Column({ type: 'text', nullable: false })
  zipCode: string;

  @IsOptional({ groups: [UPDATE] })
  @Column({ type: 'text', nullable: true })
  phoneNumber: string;

  @IsOptional({ groups: [UPDATE] })
  @Column({ type: 'text', nullable: true })
  createdBy: string;

  @Column({
    type: 'enum',
    enum: enums.CustomerStatusEnum,
    default: enums.CustomerStatusEnum.Active,
  })
  status!: enums.CustomerStatusEnum;

  // Associations

  @OneToMany(() => TestFacility, (facility) => facility.customer)
  facilities: TestFacility[];
}
