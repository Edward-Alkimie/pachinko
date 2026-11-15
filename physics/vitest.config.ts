import { defineConfig } from 'vitest/config'

// Physics rounds take ~1 s each; the first run also compiles Rapier's WASM.
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
})
