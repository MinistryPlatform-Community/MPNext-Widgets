import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'packages/*/src/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next', 'e2e', 'playwright-report', 'test-results'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportOnFailure: true,
      // Measure the whole codebase, not just the files the tests happen to
      // import. Vitest 3+ dropped `coverage.all`, so without an explicit
      // `include` an untested file is absent from the report rather than
      // counted as 0% -- which inflates the headline number.
      include: [
        'src/**/*.{ts,tsx}',
        'packages/*/src/**/*.{ts,tsx}',
      ],
      exclude: [
        'node_modules/',
        '.next/',
        'e2e/',
        'playwright-report/',
        'test-results/',
        'scripts/',
        'src/test-setup.ts',
        '**/*.{test,spec}.{ts,tsx}',
        '**/*.d.ts',
        '**/*.config.{ts,js,mjs}',
        'packages/embed-sdk/demo-*.html',
        'src/lib/providers/ministry-platform/models/', // Auto-generated files
        'src/lib/providers/ministry-platform/scripts/', // Generator scripts
        // Type-only modules and re-export barrels: no runtime code to cover.
        'packages/types/src/index.ts',
        'src/lib/embed/types.ts',
        'src/lib/providers/ministry-platform/index.ts',
        'src/lib/providers/ministry-platform/*/index.ts',
        'src/lib/providers/ministry-platform/types/**',
        'src/lib/providers/ministry-platform/auth/types.ts',
        'src/components/token-bridge/index.ts',
        // Next.js RSC shells -- JSX wiring only, covered by e2e instead.
        'src/app/**/layout.tsx',
        'src/app/providers.tsx',
      ],
      // Enable once the missing unit tests land, to ratchet instead of drift:
      // thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@mpnext/types': path.resolve(__dirname, './packages/types/src'),
    },
  },
});
