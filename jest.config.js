/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    "**/src/**/*.spec.ts",
    "**/src/**/*.test.ts",
    "**/src/**/*.spec.tsx",
    "**/src/**/*.test.tsx",
    "**/test/**/*.spec.ts",
    "**/test/**/*.test.ts",
    "**/test/**/*.spec.tsx",
    "**/test/**/*.test.tsx"
  ],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*/index.ts',
    '!src/tests/**/*.ts',
  ],
};