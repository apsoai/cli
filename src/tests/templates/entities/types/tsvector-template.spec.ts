import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('TSVector Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-tsvector';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic tsvector field correctly',
      field: {
        name: 'searchVector',
        dataType: 'string',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "tsvector"' },
        { type: 'contains', text: 'searchVector: string;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable tsvector field correctly',
      field: {
        name: 'optionalVector',
        dataType: 'string',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "tsvector"' },
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'optionalVector: string;' }
      ]
    },
    {
      name: 'should render indexed tsvector field correctly',
      field: {
        name: 'indexedVector',
        dataType: 'string',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "tsvector"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedVector: string;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 