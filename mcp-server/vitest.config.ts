import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@memoclaw/sdk': resolve(__dirname, '../typescript/src/index.ts'),
    },
  },
});
