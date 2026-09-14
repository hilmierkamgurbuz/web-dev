import { readJson } from './io.mjs';
import { layout } from './paths.mjs';

export const DEFAULT_CONFIG = {
  schema: 1,
  userLanguage: 'en',
  defaultBranch: 'main',
  git: { remote: 'origin', pullRequest: true },
  packageManager: 'npm',
  frameworks: [],
  commands: { typecheck: '', lint: '', test: '', build: '', dev: '' },
  devUrl: 'http://localhost:3000',
  responsive: {
    viewports: [
      [360, 800],
      [768, 1024],
      [1440, 900],
    ],
    paths: ['/'],
    minTapTargetPx: 44,
    minFontPx: 12,
  },
  generated: ['**/generated/**', '**/__generated__/**', '**/*.gen.*', '**/*.generated.*'],
  authMarkers: [
    'requireAuth', 'requireUser', 'isAuthenticated', 'ensureAuthenticated', 'authenticate',
    'getServerSession', 'auth', 'currentUser', 'getUser', 'verifyToken', 'withAuth',
    'clerkMiddleware', 'authMiddleware', 'UseGuards', 'AuthGuard', 'protectedProcedure', 'passport.authenticate',
    'requireUserSession', 'getUserSession', 'requireSession', 'getSession', 'protect', 'isAuthed', 'withAuthGuard',
    'constructEvent', 'constructEventAsync', 'verifyWebhook', 'verifySignature', 'verifyRequestSignature', 'validateSignature',
  ],
  validationMarkers: [
    'parse', 'safeParse', 'parseAsync', 'validate', 'validateSync', 'zValidator', 'valibot',
    'ValidationPipe', 'celebrate', 'Joi', 'yup', 'superstruct', 'typebox', 'input',
  ],
  approval: { labels: ['Approve', 'Onayla'], tokens: ['APPROVE', 'ONAY'] },
  comments: {
    licenseHeader: '',
    allowedPragmas: [
      '@ts-expect-error', 'eslint-disable-next-line', 'prettier-ignore',
      'webpackChunkName', 'webpackPrefetch', 'webpackPreload', '@vite-ignore',
      '@jsx', '@jsxImportSource', '@jsxRuntime', 'istanbul ignore', 'c8 ignore', 'v8 ignore', '#__PURE__', '@__PURE__',
    ],
  },
  security: { gitleaks: 'auto', opengrep: 'auto', osvScanner: 'auto' },
  externalApiPrefixes: [],
  baseline: '',
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key.startsWith('_')) continue;
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

export function loadConfig(root) {
  return deepMerge(DEFAULT_CONFIG, readJson(layout(root).config, {}) || {});
}
