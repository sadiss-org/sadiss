import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `@` is the app's source folder, as in the app itself, so the virtual phones
// import the app's own clock and socket code.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../app/src', import.meta.url)) }
  },
  test: {
    include: ['tests/**/*.spec.ts']
  }
})
