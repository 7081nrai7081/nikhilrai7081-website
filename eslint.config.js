import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'assets/js/**/*.min.js'],
  },
  js.configs.recommended,
  {
    files: ['assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Third-party globals injected at runtime (GTM, GA).
        dataLayer: 'writable',
        gtag: 'readonly',
      },
    },
    rules: {
      // localStorage access is wrapped in try/catch with intentionally empty
      // handlers (private-mode / disabled-storage fallback).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Caught errors are often unused in these defensive handlers.
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
    },
  },
  {
    // Cloudflare Pages Functions run on the Workers runtime, not the browser
    // or Node -- ES modules, and globals like fetch/URL/HTMLRewriter are
    // provided by that runtime, not by any of the globals.* presets.
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        HTMLRewriter: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
    },
  },
];
