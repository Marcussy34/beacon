import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve('src/renderer/src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Per-directory setup: renderer tests need @testing-library/react cleanup after each test.
    setupFiles: ['tests/renderer/setup.ts'],
  },
});
