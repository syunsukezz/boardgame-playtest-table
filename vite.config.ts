import { defineConfig } from 'vitest/config';

// GitHub Pages ではリポジトリ名のパスに置くため、BASE_PATH で base を切り替える。
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
