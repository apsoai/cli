import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Int4Range Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-int4range';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic int4range field correctly',
      field: {
        name: 'ageRange',
        dataType: '{lower: number, upper: number, lowerInclusive: boolean, upperInclusive: boolean}',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({' },
        { type: 'contains', text: '"type": "int4range"' },
        { type: 'contains', text: 'transformer: {' },
        { type: 'contains', text: 'to: (range: {lower: number, upper: number, lowerInclusive: boolean, upperInclusive: boolean}' },
        { type: 'contains', text: 'from: (pgRange: string | null)' },
        { type: 'contains', text: 'const lowerInclusive = pgRange.startsWith' },
        { type: 'contains', text: 'const upperInclusive = pgRange.endsWith' },
        { type: 'contains', text: 'ageRange: {lower: number, upper: number, lowerInclusive: boolean, upperInclusive: boolean};' },
        { type: 'notContains', text: 'nullable: true' }
      ]
    },
    {
      name: 'should render nullable int4range field correctly',
      field: {
        name: 'optionalRange',
        dataType: '{lower: number, upper: number, lowerInclusive: boolean, upperInclusive: boolean}',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({' },
        { type: 'contains', text: '"type": "int4range"' },
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'optionalRange: {lower: number, upper: number, lowerInclusive: boolean, upperInclusive: boolean};' }
      ]
    },
    {
      name: 'should render indexed int4range field correctly',
      field: {
        name: 'valueRange',
        dataType: '{lower: number, upper: number, lowerInclusive: boolean, upperInclusive: boolean}',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'valueRange: {lower: number, upper: number, lowerInclusive: boolean, upperInclusive: boolean};' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 