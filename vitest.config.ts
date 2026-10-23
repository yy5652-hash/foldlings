import { defineConfig } from 'vitest/config';

// Unit tests cover pure game logic only; keep the IWSDK dev plugin out.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
