import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `@` is the app's source folder, as in the app itself, so the virtual phones
// import the app's own clock and socket code. `@server` is the server, for the
// wire format's types.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../app/src', import.meta.url)),
      '@server': fileURLToPath(new URL('../server', import.meta.url))
    }
  },
  test: {
    include: ['tests/**/*.spec.ts']
  }
})
