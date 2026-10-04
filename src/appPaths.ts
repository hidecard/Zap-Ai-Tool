import { join } from 'node:path';

export interface ModelsDirectoryOptions {
  isPackaged: boolean;
  projectDirectory: string;
  userDataDirectory: string;
}

/**
 * Packaged Windows apps may live under Program Files, which is not writable by
 * a standard user. Keep downloaded/local models in the per-user data folder.
 */
export function resolveModelsDirectory(options: ModelsDirectoryOptions): string {
  return options.isPackaged
    ? join(options.userDataDirectory, 'Models')
    : join(options.projectDirectory, 'Models');
}
