import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Point Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-point';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic point field correctly',
      field: {
        name: 'location',
        dataType: '{ x: number, y: number }',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({' },
        { type: 'contains', text: '"type": "point"' },
        { type: 'contains', text: 'transformer: {' },
        { type: 'contains', text: 'to: (point: {x: number, y: number} | null) => {' },
        { type: 'contains', text: 'from: (pgPoint: string | null) => {' },
        { type: 'contains', text: 'location: { x: number, y: number };' },
        { type: 'notContains', text: 'nullable: true' }
      ]
    },
    {
      name: 'should render nullable point field correctly',
      field: {
        name: 'optionalLocation',
        dataType: '{ x: number, y: number }',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({' },
        { type: 'contains', text: '"type": "point"' },
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'optionalLocation: { x: number, y: number };' }
      ]
    },
    {
      name: 'should render indexed point field correctly',
      field: {
        name: 'coordinates',
        dataType: '{ x: number, y: number }',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'coordinates: { x: number, y: number };' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 