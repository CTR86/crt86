// Minimal lint: recommended JS + TS rules (no type-checked rules, keeps it fast).
// React-specific rules are intentionally absent — TS strict + tests + build
// are the correctness gates; this catches unused vars, undef globals, bad patterns.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'tmp-verify/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      'no-console': 'off',
      // The codebase carries intentional exhaustive-deps disables; surface
      // any new ones as warnings (exit 0) instead of failing the gate.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['api/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
)
