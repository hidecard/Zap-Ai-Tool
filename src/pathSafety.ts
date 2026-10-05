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
