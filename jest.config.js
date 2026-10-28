/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // PGlite-backed suites (migration render, verify, generate) take seconds per test on CI runners.
  testTimeout: 30000,
  testMatch: [
    "**/src/**/*.spec.ts",
    "**/src/**/*.test.ts",
    "**/test/**/*.spec.ts",
    "**/test/**/*.test.ts"
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