import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import designTokens from './eslint-rules/design-tokens.js'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'repro-tmp.mjs'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Underscore-prefixed bindings are the codebase's "deliberately unused"
      // convention — mostly destructured omissions like `const { x: _x, ...rest }`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],

      // `any` defeats the point of validating every backend response with Zod.
      '@typescript-eslint/no-explicit-any': 'error',

      // Empty catch blocks are load-bearing here: cache writes, best-effort
      // logouts and offline sends must never throw into the UI. The comment
      // inside each one explains why.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    // Only the renderer has a design system to drift from. The main process
    // draws nothing, and the scripts are tooling.
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/**/__tests__/**'],
    plugins: { design: designTokens },
    rules: { 'design/no-ad-hoc-values': 'error' },
  },

  {
    /**
     * The tier rule: dependencies point one way only.
     *
     *   features → patterns → brand → primitives → design
     *
     * Without something enforcing it, "we have a design system" degrades into
     * "we have a folder called components" within a couple of months — a
     * primitive grows a `useSkillsStore` call, and now the dropdown cannot be
     * used on a screen that has no skills.
     *
     * Read the arrays as "this tier may not reach upward or sideways into".
     */
    files: ['src/renderer/src/design/**/*.{ts,tsx}', 'src/renderer/src/components/primitives/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/components/brand*',
                '@/components/patterns*',
                '@/components/!(primitives)/**',
                '@/features/**',
                '@/routes/**',
                '@/shell/**',
                '@/stores/**',
                '@/services/**',
                '@/hooks*',
                '@/api*',
              ],
              message:
                'A primitive may only use design tokens. Knowing about a store, a route or a brand component makes it unusable anywhere else — move the logic to the call site.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/renderer/src/components/brand/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/components/patterns*',
                '@/components/!(brand|primitives)/**',
                '@/features/**',
                '@/routes/**',
                '@/shell/**',
                '@/stores/**',
                '@/services/**',
                '@/hooks*',
                '@/api*',
              ],
              message:
                'A brand component may use primitives and tokens, nothing above. It should render the same on any screen, including one that does not exist yet.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/renderer/src/components/patterns/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/**', '@/routes/**', '@/shell/**'],
              message:
                'A pattern knows about forms and layout, not about agents and sessions. If it needs a route or a feature, it belongs to that feature.',
            },
          ],
        },
      ],
    },
  },

  {
    // The main process is Node, not a browser.
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', '*.config.ts', '*.config.js'],
    languageOptions: { globals: { process: 'readonly', __dirname: 'readonly', console: 'readonly' } },
  },

  {
    // Build/test tooling runs on bare Node — including the globals Node ships
    // itself (fetch, WebSocket) that the smoke test drives CDP with.
    //
    // `resources/**` is here for the same reason and not by accident: the
    // bundled MCP servers are spawned by the gateway as plain `node` processes,
    // outside the app and outside the asar, so they are Node scripts rather
    // than main-process modules.
    files: ['scripts/**/*.mjs', 'resources/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
)
