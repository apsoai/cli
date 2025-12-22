import {
  Column,
  Entity,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { IsOptional, IsNotEmpty } from 'class-validator';
import { CrudValidationGroups } from '@nestjsx/crud';
import * as enums from '../enums';
import { TestCustomer } from '../TestCustomer/TestCustomer.entity';

const { CREATE, UPDATE } = CrudValidationGroups;

@Entity('test-facility')
export class TestFacility {
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
  @Column({ type: 'text', nullable: true })
  contactName: string;

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
  country: string;

  @IsOptional({ groups: [UPDATE] })
  @IsNotEmpty({ groups: [CREATE] })
  @Column({ type: 'text', nullable: false })
  zipCode: string;

  @Column({
    type: 'enum',
    enum: enums.FacilityStatusEnum,
    default: enums.FacilityStatusEnum.Active,
  })
  status!: enums.FacilityStatusEnum;

  @IsOptional({ groups: [UPDATE] })
  @IsNotEmpty({ groups: [CREATE] })
  @Column({ type: 'text', nullable: false })
  weight: string;

  // Associations
  @ManyToOne(() => TestCustomer, (customer) => customer.facilities)
  @JoinColumn({ name: 'customerId' })
  customer: TestCustomer;
  @Column({ type: 'integer', nullable: true })
  customerId: number;
}
