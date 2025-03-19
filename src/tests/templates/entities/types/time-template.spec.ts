import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Time Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-time';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic time field correctly',
      field: {
        name: 'startTime',
        dataType: 'string',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "time"' },
        { type: 'contains', text: 'startTime: string;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable time field correctly',
      field: {
        name: 'optionalTime',
        dataType: 'string',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "time"' },
        { type: 'contains', text: 'optionalTime: string;' }
      ]
    },
    {
      name: 'should render time field with default value correctly',
      field: {
        name: 'defaultTime',
        dataType: 'string',
        nullable: false,
        default: '12:00:00'
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "time"' },
        { type: 'contains', text: 'default:  12:00:00' },
        { type: 'contains', text: 'defaultTime: string;' }
      ]
    },
    {
      name: 'should render indexed time field correctly',
      field: {
        name: 'indexedTime',
        dataType: 'string',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "time"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedTime: string;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 