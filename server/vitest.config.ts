import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setupTests.ts']
  }
})
