import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('String Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-string';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic string field correctly',
      field: {
        name: 'fullName',
        dataType: 'string',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@IsOptional({ groups: [UPDATE] })' },
        { type: 'contains', text: '@IsNotEmpty({ groups: [CREATE] })' },
        { type: 'contains', text: '@Column({ type: "text", nullable: false' },
        { type: 'contains', text: 'fullName: string;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' },
        { type: 'notContains', text: '@IsEmail' },
      ]
    },
    {
      name: 'should render nullable string field correctly',
      field: {
        name: 'description',
        dataType: 'string',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@IsOptional({ groups: [UPDATE] })' },
        { type: 'notContains', text: '@IsNotEmpty({ groups: [CREATE] })' },
        { type: 'contains', text: '@Column({ type: "text", nullable: true' },
        { type: 'contains', text: 'description: string;' }
      ]
    },
    {
      name: 'should render string field with default value correctly',
      field: {
        name: 'status',
        dataType: 'string',
        nullable: false,
        default: 'active'
      },
      assertions: [
        { type: 'contains', text: 'default:  \'active\'' },
        { type: 'contains', text: 'status: string;' }
      ]
    },
    {
      name: 'should render indexed string field correctly',
      field: {
        name: 'email',
        dataType: 'string',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'email: string;' }
      ]
    },
    {
      name: 'should render primary key string field correctly',
      field: {
        name: 'id',
        dataType: 'string',
        nullable: false,
        primary: true
      },
      assertions: [
        { type: 'contains', text: '@PrimaryColumn()' },
        { type: 'contains', text: 'id: string;' }
      ]
    },
    {
      name: 'should render unique string field correctly',
      field: {
        name: 'username',
        dataType: 'string',
        nullable: false,
        unique: true
      },
      assertions: [
        { type: 'contains', text: 'unique: true' },
        { type: 'contains', text: 'username: string;' }
      ]
    },
    {
      name: 'should render email field correctly',
      field: {
        name: 'email',
        dataType: 'string',
        nullable: false,
        // eslint-disable-next-line camelcase
        is_email: true
      },
      assertions: [
        { type: 'contains', text: '@IsEmail(' },
        { type: 'contains', text: 'email: string;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 