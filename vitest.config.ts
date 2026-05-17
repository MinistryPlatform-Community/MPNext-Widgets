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
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.next/',
        'e2e/',
        'playwright-report/',
        'test-results/',
        'scripts/',
        'src/test-setup.ts',
        '**/*.d.ts',
        '**/*.config.{ts,js,mjs}',
        'packages/embed-sdk/demo-*.html',
        'src/lib/providers/ministry-platform/models/', // Auto-generated files
        'src/lib/providers/ministry-platform/scripts/', // Generator scripts
        'packages/types/src/index.ts', // Re-exports only
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@mpnext/types': path.resolve(__dirname, './packages/types/src'),
    },
  },
});
