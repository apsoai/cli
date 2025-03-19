import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('SmallInt Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-smallint';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic smallint field correctly',
      field: {
        name: 'smallCounter',
        dataType: 'number',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "smallint"' },
        { type: 'contains', text: 'smallCounter: number;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable smallint field correctly',
      field: {
        name: 'optionalCounter',
        dataType: 'number',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "smallint"' },
        { type: 'contains', text: 'optionalCounter: number;' }
      ]
    },
    {
      name: 'should render smallint field with default value correctly',
      field: {
        name: 'defaultCounter',
        dataType: 'number',
        nullable: false,
        default: 0
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "smallint"' },
        { type: 'contains', text: 'default:  0' },
        { type: 'contains', text: 'defaultCounter: number;' }
      ]
    },
    {
      name: 'should render indexed smallint field correctly',
      field: {
        name: 'indexedCounter',
        dataType: 'number',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "smallint"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedCounter: number;' }
      ]
    },
    {
      name: 'should render primary key smallint field correctly',
      field: {
        name: 'id',
        dataType: 'number',
        nullable: false,
        primary: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "smallint"' },
        { type: 'contains', text: '@PrimaryColumn()' },
        { type: 'contains', text: 'id: number;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 