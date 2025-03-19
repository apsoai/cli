import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('JSONB Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-jsonb';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic jsonb field correctly',
      field: {
        name: 'jsonData',
        dataType: 'jsonb',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: "@Column('jsonb'" },
        { type: 'contains', text: 'nullable: false' },
        { type: 'contains', text: 'jsonData: any;' }
      ]
    },
    {
      name: 'should render nullable jsonb field correctly',
      field: {
        name: 'optionalJsonData',
        dataType: 'jsonb',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: "@Column('jsonb'" },
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'optionalJsonData: any;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 