import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/*.d.ts'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      /**
       * Rules of Hooks is an error, not a warning. A conditional hook does not
       * fail loudly — it corrupts React's internal hook order and surfaces later
       * as unrelated state appearing in the wrong component. There is no case
       * where violating it is intentional.
       */
      'react-hooks/rules-of-hooks': 'error',

      /**
       * exhaustive-deps is a warning by design. It has genuine false positives
       * (notably around intentionally-once effects), and a rule people routinely
       * disable inline is worse than one they read. Every suppression must carry
       * a comment explaining why.
       */
      'react-hooks/exhaustive-deps': 'warn',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /** Type-only imports are erased at compile time; mixing them with value
       *  imports defeats `verbatimModuleSyntax` and bloats the bundle graph. */
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      /**
       * `any` is banned outright. The brief asks for strong typing, and the
       * prototype's central data structure was `Record<string, any>` — which is
       * how a "strongly typed" project ends up with none. Use `unknown` and
       * narrow.
       */
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      // Tests deliberately construct malformed values to prove guards work.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  /**
   * Build/tooling scripts. Plain Node ESM: no DOM, no TypeScript, and `console`
   * is the intended output channel rather than a stray debug statement.
   */
  {
    files: ['tools/**/*.mjs', '*.config.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
);
