import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * Three source trees with three different runtimes, so each gets its own globals
 * and its own tsconfig. `projectService` resolves each file to the project that
 * already includes it (app / worker / test), which is what makes the
 * type-checked rules see the real types instead of `any`.
 *
 * Type-checked linting is the reason this project is pinned to TypeScript 6:
 * typescript-eslint hard-refuses to run on TypeScript 7.
 */
export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'android', 'assets', 'node_modules', '.wrangler'] },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A dropped await on a D1 batch or a fetch is a silent data bug, not a
      // style issue.
      '@typescript-eslint/no-floating-promises': 'error',
      // Underscore-prefixed names are the existing convention for deliberately
      // unused bindings (the `_event` in the scheduled handler, for one).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Two rules new in react-hooks 7 flag three pre-existing spots (the
      // mount-time reload effects in the settings sections, and EditorScreen's
      // render-time ref write). They are worth addressing, but as their own
      // change: as errors they would block every lint run until then.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },

  {
    files: ['worker/**/*.ts', 'shared/**/*.ts', 'test/**/*.ts'],
    languageOptions: { globals: globals.es2022 },
    rules: {
      // The Workers, Hono and miniflare APIs used here are generic with a
      // default type parameter that infers *from the assertion itself*
      // (`res.json() as T`, `c.req.param() as T`). The rule then declares the
      // assertion redundant, when it is the only thing giving the value a type.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // The stubs and handlers here are async because the interface they
      // implement is async (D1PreparedStatement, Fetcher, ExportedHandler),
      // not because their body awaits anything.
      '@typescript-eslint/require-await': 'off',
    },
  },

  {
    files: ['test/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },

  // Loose scripts and this config itself are outside every tsconfig project, so
  // the type-aware rules have no program to consult and would only report a
  // parsing error. They still get the syntax-level recommended set.
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
