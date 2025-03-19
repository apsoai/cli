import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Plain JSON Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-json-plain';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic plain JSON field correctly',
      field: {
        name: 'metadata',
        dataType: 'Record<string, any>',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: "@Column('json'" },
        { type: 'contains', text: 'metadata: JSON;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable plain JSON field correctly',
      field: {
        name: 'optionalMeta',
        dataType: 'Record<string, any>',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: "@Column('json'" },
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'optionalMeta: JSON;' }
      ]
    },
    {
      name: 'should render plain JSON field with default value correctly',
      field: {
        name: 'defaultMeta',
        dataType: 'Record<string, any>',
        nullable: false,
        default: '{}'
      },
      assertions: [
        { type: 'contains', text: "@Column('json'" },
        { type: 'contains', text: 'defaultMeta: JSON;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 