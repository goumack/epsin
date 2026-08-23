import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Les tests touchent la meme base : les executer en serie evite qu ils
    // se marchent dessus (un test qui cree une note pendant qu un autre
    // calcule une moyenne).
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});
