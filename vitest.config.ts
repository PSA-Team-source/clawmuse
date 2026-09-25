import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'jsdom',
    // `.tsx` too: hook tests that render components live alongside the rest,
    // and a pattern that silently skips them is worse than no test.
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
