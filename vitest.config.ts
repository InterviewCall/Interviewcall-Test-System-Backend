import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    // Resolves the path aliases declared in tsconfig.json, including the ones
    // added by `nest g library`.
    tsconfigPaths(),
    // esbuild (Vite's default) drops decorator metadata, which breaks Nest's
    // constructor injection. SWC emits it.
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    globals: true,
    root: './',
    setupFiles: ['dotenv/config'],
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/generated/**'],
  },
});
