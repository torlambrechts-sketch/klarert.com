import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import prettier from 'eslint-config-prettier';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'reference/**',
      'next-env.d.ts',
      'src/lib/database.types.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // CLAUDE.md rule 3: the engine is pure.
    files: ['src/engine/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'next', 'next/*'],
              message: 'src/engine must not import React or Next.js.',
            },
            { group: ['@supabase/*'], message: 'src/engine must not import Supabase.' },
            {
              group: ['@/server/*', '@/components/*', '@/app/*', '@/lib/*'],
              message: 'src/engine must stay independent of app code.',
            },
          ],
        },
      ],
    },
  },
  prettier,
];

export default eslintConfig;
