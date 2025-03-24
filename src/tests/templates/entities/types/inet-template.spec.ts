import { configureEta, runTemplateTests, TemplateTestCase } from '../utils/template-test-utils';
import { describe, beforeAll } from '@jest/globals';

describe('Inet Entity Template Tests', () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = './entities/entity-col-inet';
  
  const testCases: TemplateTestCase[] = [
    {
      name: 'should render basic inet field correctly',
      field: {
        name: 'ipAddress',
        dataType: 'string',
        nullable: false
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "inet"' },
        { type: 'contains', text: 'ipAddress: string;' },
        { type: 'notContains', text: '@Index()' },
        { type: 'notContains', text: '@PrimaryColumn()' }
      ]
    },
    {
      name: 'should render nullable inet field correctly',
      field: {
        name: 'optionalIp',
        dataType: 'string',
        nullable: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "inet"' },
        { type: 'contains', text: 'nullable: true' },
        { type: 'contains', text: 'optionalIp: string;' }
      ]
    },
    {
      name: 'should render inet field with default value correctly',
      field: {
        name: 'defaultIp',
        dataType: 'string',
        nullable: false,
        default: '127.0.0.1'
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "inet"' },
        { type: 'contains', text: 'default:  127.0.0.1' },
        { type: 'contains', text: 'defaultIp: string;' }
      ]
    },
    {
      name: 'should render indexed inet field correctly',
      field: {
        name: 'indexedIp',
        dataType: 'string',
        nullable: false,
        index: true
      },
      assertions: [
        { type: 'contains', text: '@Column({ "type": "inet"' },
        { type: 'contains', text: '@Index()' },
        { type: 'contains', text: 'indexedIp: string;' }
      ]
    }
  ];

  runTemplateTests(templatePath, testCases);
}); 