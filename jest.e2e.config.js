/**
 * Separate config for end-to-end tests, which boot a real NestJS HTTP server.
 * Kept out of `npm test` so the unit suite stays fast, and run in CI against
 * NestJS 10, 11 and 12.
 *
 * NestJS 12 ships ESM only. Real apps load it fine (Node's require(esm)), but
 * Jest's own module system cannot import it in-process, so on 12 the
 * in-process suites are skipped and nest-runtime.e2e.test.ts — which boots
 * the app in a real Node process — covers it on both adapters.
 *
 * @type {import('jest').Config}
 */
const fs = require('fs');
const path = require('path');

function nestIsEsmOnly() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', '@nestjs', 'core', 'package.json'), 'utf8'));
    return pkg.type === 'module';
  } catch {
    return false;
  }
}

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/e2e/**/*.test.ts'],
  testPathIgnorePatterns: nestIsEsmOnly()
    ? ['/node_modules/', '<rootDir>/test/e2e/module.e2e.test.ts', '<rootDir>/test/e2e/fastify.e2e.test.ts']
    : ['/node_modules/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // The scanner walks the filesystem and boots Nest per suite; serial execution
  // avoids port and ts-morph contention.
  maxWorkers: 1,
  testTimeout: 120000,
};
