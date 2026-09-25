import { defineConfig } from 'vitest/config';

// Unit tests: pure TypeScript under src/test/domain (domain, shared, and the
// webview's format/sync modules). They need no VS Code; the integration suites
// in src/test/*.integration.test.ts run under @vscode/test-cli instead.
export default defineConfig({
  test: {
    include: ['src/test/domain/**/*.test.ts'],
    environment: 'node',
  },
});
