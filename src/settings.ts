import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type TerminalPolicyMode = 'ask-every-time' | 'allow-list';
export type ProviderKind = 'llama-server' | 'openai-compatible';

export interface TerminalPolicy {
  /** `ask-every-time` keeps the native confirmation for every command. */
  mode: TerminalPolicyMode;
  /** Allowed command prefixes, for example `npm test` or `git status`. */
  allowList: string[];
  /** When true, agent commands inside the allow-list skip the native prompt. */
  allowAgentCommands: boolean;
}

export interface ProviderSettings {
  kind: ProviderKind;
  /** Base URL for hosted or remote OpenAI-compatible endpoints. */
  baseUrl?: string;
  /** Remote model identifier, for example `gpt-4o-mini`. */
  model?: string;
  /** Stored locally in userData/settings.json only; never logged or sent anywhere else. */
  apiKey?: string;
}

export interface AppSettings {
  modelsDirectory: string;
  modelPaths?: string[];
  workspaceDirectory?: string;
  maxContextFiles: number;
  terminalPolicy?: TerminalPolicy;
  provider?: ProviderSettings;
}

export const DEFAULT_TERMINAL_POLICY: TerminalPolicy = {
  mode: 'ask-every-time',
  allowList: [],
  allowAgentCommands: false,
};

export const DEFAULT_PROVIDER: ProviderSettings = { kind: 'llama-server' };

const DEFAULT_SETTINGS: AppSettings = { modelsDirectory: 'Models', maxContextFiles: 2000 };

function normalizeStringList(value: unknown, limit = 200, itemLimit = 200): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= itemLimit)
    .slice(0, limit);
  return [...new Set(items)];
}

export function normalizeTerminalPolicy(value: unknown): TerminalPolicy | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const mode: TerminalPolicyMode = record.mode === 'allow-list' ? 'allow-list' : 'ask-every-time';
  return {
    mode,
    allowList: normalizeStringList(record.allowList, 100, 120) ?? [],
    allowAgentCommands: record.allowAgentCommands === true,
  };
}

export function normalizeProvider(value: unknown): ProviderSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const kind: ProviderKind =
    record.kind === 'openai-compatible' ? 'openai-compatible' : 'llama-server';
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : '';
  return {
    kind,
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Validates a settings patch before it is merged into persisted settings. */
export function sanitizeSettingsPatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (patch.maxContextFiles !== undefined) {
    const limit = Number(patch.maxContextFiles);
    if (!Number.isFinite(limit)) throw new Error('Context file limit must be a number.');
    result.maxContextFiles = Math.max(100, Math.min(10_000, Math.floor(limit)));
  }
  if (patch.terminalPolicy !== undefined) {
    const policy = normalizeTerminalPolicy(patch.terminalPolicy);
    if (policy) result.terminalPolicy = policy;
  }
  if (patch.provider !== undefined) {
    const provider = normalizeProvider(patch.provider);
    if (provider) result.provider = provider;
  }
  if (patch.workspaceDirectory !== undefined) {
    const directory = String(patch.workspaceDirectory ?? '').trim();
    if (directory === '') delete result.workspaceDirectory;
    else result.workspaceDirectory = directory;
  }
  return result;
}

export async function loadSettings(
  path: string,
  defaults: AppSettings = DEFAULT_SETTINGS,
): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<AppSettings>;
    const settings: AppSettings = {
      ...defaults,
      modelsDirectory:
        typeof raw.modelsDirectory === 'string' && raw.modelsDirectory.trim()
          ? raw.modelsDirectory
          : defaults.modelsDirectory,
      maxContextFiles:
        typeof raw.maxContextFiles === 'number' && Number.isFinite(raw.maxContextFiles)
          ? Math.max(100, Math.min(10_000, Math.floor(raw.maxContextFiles)))
          : defaults.maxContextFiles,
    };
    const modelPaths = Array.isArray(raw.modelPaths)
      ? normalizeStringList(raw.modelPaths, 50, 1_024)
      : defaults.modelPaths;
    if (modelPaths && modelPaths.length > 0) settings.modelPaths = modelPaths;
    const workspaceDirectory =
      typeof raw.workspaceDirectory === 'string' && raw.workspaceDirectory.trim()
        ? raw.workspaceDirectory
        : defaults.workspaceDirectory;
    if (workspaceDirectory !== undefined) settings.workspaceDirectory = workspaceDirectory;
    const terminalPolicy = normalizeTerminalPolicy(raw.terminalPolicy);
    if (terminalPolicy) settings.terminalPolicy = terminalPolicy;
    const provider = normalizeProvider(raw.provider);
    if (provider) settings.provider = provider;
    return settings;
  } catch {
    return { ...defaults };
  }
}

export async function saveSettings(path: string, settings: AppSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
