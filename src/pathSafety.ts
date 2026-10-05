const PROTECTED_DIRECTORY_NAMES = new Set([
  '.git',
  '.zap-backups',
  '.ssh',
  '.aws',
  '.azure',
  'node_modules',
  'dist',
  'build',
  'target',
]);

const PROTECTED_FILE_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  'credentials',
  'credentials.json',
  'secrets.json',
  'service-account.json',
  'id_rsa',
  'id_ed25519',
]);

/**
 * Project configuration owned by the human, never by a model. These files steer
 * the agent, so a generated patch must not be able to rewrite them.
 */
const PROJECT_CONFIG_FILES = new Set(['zap.md', '.zapignore']);

/** Returns true for files that only the human may write through Settings. */
export function isProjectConfigPath(path: string): boolean {
  const basename = path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
  return basename !== undefined && PROJECT_CONFIG_FILES.has(basename.toLowerCase());
}

const PROTECTED_EXTENSIONS = ['.pem', '.p12', '.pfx', '.key', '.jks', '.keystore'];

/** Returns true for paths that must not enter model context or generated file patches. */
export function isProtectedWorkspacePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const segments = normalized
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  const basename = segments.at(-1) ?? '';
  return (
    segments.some(
      (segment) =>
        PROTECTED_DIRECTORY_NAMES.has(segment) || segment === '.env' || segment.startsWith('.env.'),
    ) ||
    PROTECTED_FILE_NAMES.has(basename) ||
    PROTECTED_EXTENSIONS.some((extension) => basename.endsWith(extension))
  );
}
