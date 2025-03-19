import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('TimeWithTimeZone Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-timetz';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic timetz field correctly',
      field: {
        name: 'globalTime',
        dataType: 'string',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "timetz"' },
        { type: 'contains', text: 'globalTime: string;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable timetz field correctly',
      field: {
        name: 'optionalGlobalTime',
        dataType: 'string',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "timetz"' },
        { type: 'contains', text: 'optionalGlobalTime: string;' }
      ]
    },
    {
      name: 'should render timetz field with default value correctly',
      field: {
        name: 'defaultGlobalTime',
        dataType: 'string',
        nullable: false,
        default: '12:00:00+00'
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "timetz"' },
        { type: 'contains', text: 'default:  12:00:00+00' },
        { type: 'contains', text: 'defaultGlobalTime: string;' }
      ]
    },
    {
      name: 'should render indexed timetz field correctly',
      field: {
        name: 'indexedGlobalTime',
        dataType: 'string',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "timetz"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedGlobalTime: string;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 