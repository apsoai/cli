import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Float Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-float';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic float field correctly',
      field: {
        name: 'floatValue',
        dataType: 'number',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "decimal"' },
        { type: 'contains', text: 'floatValue: number;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable float field correctly',
      field: {
        name: 'optionalFloat',
        dataType: 'number',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "decimal"' },
        { type: 'contains', text: 'optionalFloat: number;' }
      ]
    },
    {
      name: 'should render float field with default value correctly',
      field: {
        name: 'defaultFloat',
        dataType: 'number',
        nullable: false,
        default: 0
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "decimal", default:  0 })' },
        { type: 'contains', text: 'defaultFloat: number;' }
      ]
    },
    {
      name: 'should render indexed float field correctly',
      field: {
        name: 'indexedFloat',
        dataType: 'number',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "decimal"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedFloat: number;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 