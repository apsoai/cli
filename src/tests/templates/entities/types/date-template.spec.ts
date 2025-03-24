import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Date Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-date';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic date field correctly',
      field: {
        name: 'birthDate',
        dataType: 'Date',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: "@Column({ type: 'date'" },
        { type: 'contains', text: 'nullable: false' },
        { type: 'contains', text: 'birthDate: string;' },
        { type: 'notContains', text: '@Index()' }
      ]
    },
    {
      name: 'should render nullable date field correctly',
      field: {
        name: 'optionalDate',
        dataType: 'Date',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: "@Column({ type: 'date'" },
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'optionalDate: string;' }
      ]
    },
    {
      name: 'should render indexed date field correctly',
      field: {
        name: 'indexedDate',
        dataType: 'Date',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: "@Column({ type: 'date'" },
        { type: 'contains', text: 'nullable: false' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedDate: string;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 