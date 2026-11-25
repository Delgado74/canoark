/**
 * Tests de integración herméticos: usan los paquetes reales de Arkade.
 * Solo se sustituyen las fronteras nativas (SQLite, SecureStore, crypto).
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // La capa regtest se ejecuta aparte: necesita el stack levantado en CI.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/e2e/'],
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
  // Los paquetes @arkade-os publican ESM; lnurl-client no tiene export CJS.
  transformIgnorePatterns: [
    '/node_modules/(?!(?:\\.pnpm/)?(?:@arkade-os|@scure|@noble|@marcbachmann|micro-packed|nostr-tools|light-bolt11-decoder|expo|@expo)/)',
  ],
  setupFiles: ['<rootDir>/test/setup.ts'],
  clearMocks: true,
  maxWorkers: 2,
};
