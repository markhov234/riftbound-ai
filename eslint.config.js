import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * The reason this config exists is `react-hooks/rules-of-hooks`.
 *
 * A hook called below an early return runs on some renders and not others, and
 * React kills the whole tree: "rendered more hooks than during the previous
 * render" — a white screen. It has happened twice in this project, and neither
 * `tsc`, `vite build` nor the ~500 node tests can see it, because none of them
 * render a component. That rule is the only thing that catches it.
 *
 * Everything else here is kept deliberately quiet: this is a working game, not
 * a greenfield repo, and a lint run that prints hundreds of style complaints is
 * a lint run nobody reads.
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // The whole point. Not negotiable, not a warning.
      'react-hooks/rules-of-hooks': 'error',
      // Missing deps are a real bug class but the existing code has several
      // deliberate omissions; surface them without failing the run.
      'react-hooks/exhaustive-deps': 'warn',

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // `tsc --noEmit` already reports unused code, and it understands the
      // project's types better than the lint rule does. Don't duplicate it.
      '@typescript-eslint/no-unused-vars': 'off',
      // The engine crosses a typed boundary in a few places (card data from the
      // API, test fixtures). Those are reviewed casts, not accidents.
      '@typescript-eslint/no-explicit-any': 'warn',
      // `let { s, id } = …` where only one half is reassigned is idiomatic in
      // these tests; only require const when the whole pattern is stable.
      'prefer-const': ['error', { destructuring: 'all' }],
      // The irregular whitespace in the codebase is inside comments quoting
      // card text (zero-width joiners in ellipses), not in code.
      'no-irregular-whitespace': ['error', { skipComments: true }],
      // Empty catch blocks are used on purpose around storage access.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
