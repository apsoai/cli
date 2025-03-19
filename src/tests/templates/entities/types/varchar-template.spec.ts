import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Varchar Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-varchar';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic varchar field correctly',
      field: {
        name: 'name',
        dataType: 'string',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@IsOptional({ groups: [UPDATE] })' },
        { type: 'contains', text: '@IsNotEmpty({ groups: [CREATE] })' },
        { type: 'contains', text: '@Column({ type: "varchar", length: 255' },
        { type: 'contains', text: 'nullable: false' },
        { type: 'contains', text: 'name: string;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@IsEmail' }
      ]
    },
    {
      name: 'should render nullable varchar field correctly',
      field: {
        name: 'description',
        dataType: 'string',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@IsOptional({ groups: [UPDATE] })' },
        { type: 'contains', text: '@Column({ type: "varchar"' },
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'description: string;' },
        { type: 'notContains', text: '@IsNotEmpty' }
      ]
    },
    {
      name: 'should render varchar field with custom length correctly',
      field: {
        name: 'code',
        dataType: 'string',
        nullable: false,
        length: 50
      },
      assertions: [
        { type: 'contains', text: '@Column({ type: "varchar", length: 50' },
        { type: 'contains', text: 'code: string;' }
      ]
    },
    {
      name: 'should render unique varchar field correctly',
      field: {
        name: 'username',
        dataType: 'string',
        nullable: false,
        unique: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ type: "varchar"' },
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
        { type: 'contains', text: '@IsEmail({ require_tld: false }, { always: true })' },
        { type: 'contains', text: '@Column({ type: "varchar"' },
        { type: 'contains', text: 'email: string;' }
      ]
    },
    {
      name: 'should render indexed varchar field correctly',
      field: {
        name: 'indexedField',
        dataType: 'string',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ type: "varchar"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedField: string;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 