import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/data/*.generated.ts'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        test: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
  },
);
