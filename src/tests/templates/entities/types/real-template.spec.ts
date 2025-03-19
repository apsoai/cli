import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Real Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-real';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic real field correctly',
      field: {
        name: 'measurement',
        dataType: 'number',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "real"' },
        { type: 'contains', text: 'measurement: number;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable real field correctly',
      field: {
        name: 'optionalMeasure',
        dataType: 'number',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "real"' },
        { type: 'contains', text: 'optionalMeasure: number;' }
      ]
    },
    {
      name: 'should render real field with default value correctly',
      field: {
        name: 'defaultMeasure',
        dataType: 'number',
        nullable: false,
        default: 0
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "real", default:  0 })' },
        { type: 'contains', text: 'defaultMeasure: number;' }
      ]
    },
    {
      name: 'should render indexed real field correctly',
      field: {
        name: 'indexedMeasure',
        dataType: 'number',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "real"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedMeasure: number;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 