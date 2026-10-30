import { defineConfig, mergeConfig } from 'vitest/config';
import appConfig from './vite.config';

export default mergeConfig(
  appConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      environmentOptions: {
        jsdom: { url: 'http://localhost/' },
      },
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'packages/domain/test/**/*.test.ts'],
      clearMocks: true,
      restoreMocks: true,
    },
  }),
);
