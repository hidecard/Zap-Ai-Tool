/**
 * Reports GGUF metadata and family compatibility for model files without
 * loading them. Run with `npm run models:check -- <file.gguf> [more files…]`.
 *
 * With no arguments, every model in Settings is inspected: pass
 * --settings <settings.json> to inspect another install's settings file.
 */
import { readFile } from 'node:fs/promises';
import { formatGgufReport, inspectGguf } from '../src/gguf.js';
import type { AppSettings } from '../src/settings.js';

function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function pathsFromSettings(path: string): Promise<string[]> {
  const settings = JSON.parse(await readFile(path, 'utf8')) as Partial<AppSettings>;
  return settings.modelPaths ?? [];
}

const args = process.argv.slice(2).filter((argument) => argument !== '--settings');
const settingsIndex = process.argv.indexOf('--settings');
const settingsPath = settingsIndex >= 0 ? process.argv[settingsIndex + 1] : undefined;
const targets = args.length > 0 ? args : settingsPath ? await pathsFromSettings(settingsPath) : [];

if (targets.length === 0) {
  console.log('Usage: npm run models:check -- <file.gguf> [...]');
  console.log('   or: npm run models:check -- --settings <settings.json>');
  process.exitCode = 1;
} else {
  let failed = 0;
  for (const target of targets) {
    const inspection = await inspectGguf(target);
    if (!inspection.valid) failed += 1;
    console.log(formatGgufReport(inspection));
    if (inspection.valid && inspection.sizeBytes > 0)
      console.log(`  size=${formatBytes(inspection.sizeBytes)}`);
  }
  if (failed > 0) process.exitCode = 1;
}
