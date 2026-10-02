/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  testPathIgnorePatterns: ['<rootDir>/test/e2e/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // The docs UI component runs in a browser and is covered by the Playwright
  // suite (test/ui); its pure modules (scenarios, request bodies) are unit tested here.
  collectCoverageFrom: ['src/**/*.ts', '!src/examples/**', '!src/controllers/DemoController.ts', '!src/ui/lit/main.ts', '!src/ui/lit/*.d.ts'],
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 67,
      branches: 59,
      functions: 72,
      lines: 70,
    },
  },
};
