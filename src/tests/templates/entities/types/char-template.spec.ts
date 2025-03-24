import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Char Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-char';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic char field correctly',
      field: {
        name: 'charCode',
        dataType: 'string',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({ type: "char", length: 1' },
        { type: 'contains', text: 'charCode: string;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable char field correctly',
      field: {
        name: 'optionalChar',
        dataType: 'string',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ type: "char"' },
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'optionalChar: string;' }
      ]
    },
    {
      name: 'should render char field with custom length correctly',
      field: {
        name: 'fixedCode',
        dataType: 'string',
        nullable: false,
        length: 5
      },
      assertions: [
        { type: 'contains', text: '@Column({ type: "char", length: 5' },
        { type: 'contains', text: 'fixedCode: string;' }
      ]
    },
    {
      name: 'should render indexed char field correctly',
      field: {
        name: 'indexedChar',
        dataType: 'string',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ type: "char"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedChar: string;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 