import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Array Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-array';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic text array field correctly',
      field: {
        name: 'tags',
        dataType: 'string[]',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({' },
        { type: 'contains', text: 'type: "text"' },
        { type: 'contains', text: 'array: true' },
        { type: 'contains', text: 'tags: string[];' },
        { type: 'notContains', text: 'nullable: true' }
      ]
    },
    {
      name: 'should render nullable array field correctly',
      field: {
        name: 'optionalTags',
        dataType: 'string[]',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'optionalTags: string[];' }
      ]
    },
    {
      name: 'should render indexed array field correctly',
      field: {
        name: 'categories',
        dataType: 'string[]',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'categories: string[];' }
      ]
    },
    {
      name: 'should render integer array field correctly',
      field: {
        name: 'scores',
        dataType: 'number[]',
        elementType: 'int',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: 'type: "int"' },
        { type: 'contains', text: 'array: true' },
        { type: 'contains', text: 'scores: number[];' }
      ]
    },
    {
      name: 'should render decimal array field correctly',
      field: {
        name: 'amounts',
        dataType: 'number[]',
        elementType: 'decimal',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: 'type: "decimal"' },
        { type: 'contains', text: 'array: true' },
        { type: 'contains', text: 'amounts: number[];' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 