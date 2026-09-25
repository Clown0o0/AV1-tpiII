import type { Config } from 'jest';

// Sintaxe CommonJS de propósito: o Node 24 carrega este arquivo com "type stripping" nativo.
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
  coverageReporters: ['text', 'text-summary', 'lcov'],
};

module.exports = config;
