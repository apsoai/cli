import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Interval Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-interval';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic interval field correctly',
      field: {
        name: 'duration',
        dataType: 'string',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "interval"' },
        { type: 'contains', text: 'duration: string;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable interval field correctly',
      field: {
        name: 'optionalDuration',
        dataType: 'string',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "interval"' },
        { type: 'contains', text: 'optionalDuration: string;' }
      ]
    },
    {
      name: 'should render interval field with default value correctly',
      field: {
        name: 'defaultDuration',
        dataType: 'string',
        nullable: false,
        default: '1 day'
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "interval"' },
        { type: 'contains', text: 'default:  1 day' },
        { type: 'contains', text: 'defaultDuration: string;' }
      ]
    },
    {
      name: 'should render indexed interval field correctly',
      field: {
        name: 'indexedDuration',
        dataType: 'string',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "interval"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedDuration: string;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 