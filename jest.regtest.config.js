/** Capa 2: mismos mocks nativos, pero contra un arkd real de regtest. */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/test/e2e/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 420_000,
};
