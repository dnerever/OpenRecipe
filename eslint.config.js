import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Correctness, not style — Prettier owns formatting. Type-aware rules run
 * against each package's own tsconfig, so lint sees the same types `tsc` does.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/api/src/db/migrations/**',
      '.claude/**',
      '.local/**',
      'import-data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Explicit rather than `projectService`: test files belong to each
        // package's `tsconfig.test.json`, which a service would never find.
        project: [
          'packages/core/tsconfig.json',
          'packages/core/tsconfig.test.json',
          'apps/api/tsconfig.json',
          'apps/api/tsconfig.test.json',
          'apps/web/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/core/**/*.ts', 'apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // node:test's `describe` and `it` return promises the runner itself
    // awaits; awaiting them by hand is not how the API is meant to be used.
    // And the API suites read response bodies as `any` on purpose: they
    // assert on the wire shape, which is exactly what a type would paper over.
    files: ['**/*.test.ts', '**/*.test.tsx', 'apps/api/src/test-support.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // A mock standing in for an async API is async whether or not it awaits.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Config files sit outside every tsconfig.
    files: ['**/*.config.{js,ts}', 'e2e/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);
