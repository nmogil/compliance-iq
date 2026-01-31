import baseConfig from '@compliance-iq/eslint-config';

/**
 * ESLint configuration for ComplianceIQ monorepo
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '.claude/**',
      '.planning/**',
      'doc_planning/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
  ...baseConfig,
];
