import { useEffect, useState, type ReactElement } from 'react';
import type { AppSettings, ProviderKind, TerminalPolicyMode } from '../../settings.js';
import type { WorkspaceContext } from '../../domain.js';
import type { WorkspaceConfig } from '../../workspace.js';

export interface SettingsPanelProps {
  settings: AppSettings | null;
  workspace: WorkspaceContext | null;
  previewMode: boolean;
  busy: boolean;
  error?: string | undefined;
  healthMessage?: string | undefined;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onChooseModelsDirectory: () => Promise<void>;
  onChooseModelFile: () => Promise<void>;
  onCheckHealth: () => Promise<void>;
  onSaveProjectConfig: (config: WorkspaceConfig) => Promise<void>;
}

/** Persistent preferences: local models, provider, terminal policy, project rules. */
export function SettingsPanel({
  settings,
  workspace,
  previewMode,
  busy,
  error,
  healthMessage,
  onUpdateSettings,
  onChooseModelsDirectory,
  onChooseModelFile,
  onCheckHealth,
  onSaveProjectConfig,
}: SettingsPanelProps): ReactElement {
  const [limit, setLimit] = useState('2000');
  const [providerKind, setProviderKind] = useState<ProviderKind>('llama-server');
  const [baseUrl, setBaseUrl] = useState('');
  const [remoteModel, setRemoteModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [policyMode, setPolicyMode] = useState<TerminalPolicyMode>('ask-every-time');
  const [allowList, setAllowList] = useState('');
  const [allowAgentCommands, setAllowAgentCommands] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [ignorePatterns, setIgnorePatterns] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectNote, setProjectNote] = useState('');
  const disabled = busy || previewMode;

  useEffect(() => {
    if (!settings) return;
    setLimit(String(settings.maxContextFiles));
    setProviderKind(settings.provider?.kind ?? 'llama-server');
    setBaseUrl(settings.provider?.baseUrl ?? '');
    setRemoteModel(settings.provider?.model ?? '');
    setApiKey(settings.provider?.apiKey ?? '');
    setPolicyMode(settings.terminalPolicy?.mode ?? 'ask-every-time');
    setAllowList((settings.terminalPolicy?.allowList ?? []).join('\n'));
    setAllowAgentCommands(settings.terminalPolicy?.allowAgentCommands === true);
  }, [settings]);

  useEffect(() => {
    if (previewMode || !workspace) return;
    let cancelled = false;
    void window.zap
      .readWorkspaceConfig(workspace.rootPath)
      .then((config) => {
        if (cancelled) return;
        setInstructions(config.instructions);
        setIgnorePatterns(config.ignorePatterns.join('\n'));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [previewMode, workspace?.rootPath]);

  const saveProjectConfig = async (): Promise<void> => {
    if (previewMode || projectBusy) return;
    setProjectBusy(true);
    setProjectNote('');
    try {
      await onSaveProjectConfig({
        instructions,
        ignorePatterns: ignorePatterns.split(/\r?\n/),
      });
      setProjectNote('Saved to ZAP.md and .zapignore in this project.');
    } finally {
      setProjectBusy(false);
    }
  };

  return (
    <div className="utility-panel settings-panel">
      <label>SETTINGS</label>
      <div className="setting-row">
        <span>Model directory</span>
        <b>{settings ? 'LOCAL' : '…'}</b>
      </div>
      <small className="path-setting">{settings?.modelsDirectory ?? 'Loading settings…'}</small>
      <button
        className="settings-action"
        type="button"
        onClick={() => void onChooseModelsDirectory()}
        disabled={disabled}
      >
        Choose model folder
      </button>
      <button
        className="settings-action primary"
        type="button"
        onClick={() => void onChooseModelFile()}
        disabled={disabled}
      >
        Add GGUF from Downloads / any folder
      </button>
      {settings?.modelPaths && settings.modelPaths.length > 0 && (
        <small>{settings.modelPaths.length} external GGUF model(s) remembered.</small>
      )}

      <div className="setting-row">
        <span>Model provider</span>
        <b>{providerKind === 'llama-server' ? 'LOCAL GGUF' : 'HOSTED'}</b>
      </div>
      <select
        value={providerKind}
        onChange={(event) => setProviderKind(event.target.value as ProviderKind)}
        disabled={disabled}
      >
        <option value="llama-server">Local llama.cpp server (GGUF)</option>
        <option value="openai-compatible">Hosted / OpenAI-compatible endpoint</option>
      </select>
      {providerKind === 'openai-compatible' && (
        <>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
            disabled={disabled}
            aria-label="Hosted endpoint URL"
          />
          <input
            value={remoteModel}
            onChange={(event) => setRemoteModel(event.target.value)}
            placeholder="Model id, e.g. gpt-4o-mini"
            disabled={disabled}
            aria-label="Hosted model id"
          />
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="API key (stored locally, sent only to that endpoint)"
            disabled={disabled}
            aria-label="Hosted API key"
          />
          <button
            className="settings-action primary"
            type="button"
            disabled={disabled}
            onClick={() =>
              void onUpdateSettings({
                provider: {
                  kind: providerKind,
                  baseUrl: baseUrl.trim(),
                  model: remoteModel.trim(),
                  apiKey: apiKey.trim(),
                },
              })
            }
          >
            Save provider
          </button>
        </>
      )}
      <button
        className="settings-action"
        type="button"
        disabled={disabled}
        onClick={() => void onCheckHealth()}
      >
        Check runtime health
      </button>
      {healthMessage && <small>{healthMessage}</small>}

      <div className="setting-row">
        <span>Workspace entry limit</span>
        <b>100–10,000</b>
      </div>
      <input
        type="number"
        min={100}
        max={10_000}
        step={100}
        value={limit}
        onChange={(event) => setLimit(event.target.value)}
        disabled={disabled}
        aria-label="Workspace entry limit"
      />
      <button
        className="settings-action primary"
        type="button"
        disabled={disabled}
        onClick={() => void onUpdateSettings({ maxContextFiles: Number(limit) })}
      >
        {busy ? 'Saving…' : 'Save and refresh project'}
      </button>
      <small>The most recently opened project is restored next time.</small>

      <div className="setting-row">
        <span>Terminal policy</span>
        <b>{policyMode === 'allow-list' ? 'ALLOW-LIST' : 'ASK EVERY TIME'}</b>
      </div>
      <select
        value={policyMode}
        onChange={(event) => setPolicyMode(event.target.value as TerminalPolicyMode)}
        disabled={disabled}
        aria-label="Terminal policy mode"
      >
        <option value="ask-every-time">Ask before every command</option>
        <option value="allow-list">Only allow listed commands</option>
      </select>
      <textarea
        value={allowList}
        onChange={(event) => setAllowList(event.target.value)}
        placeholder={'npm test\ngit status\ngit diff'}
        disabled={disabled}
        aria-label="Terminal allow-list"
      />
      <small>One command prefix per line, for example npm test or git.</small>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={allowAgentCommands}
          onChange={(event) => setAllowAgentCommands(event.target.checked)}
          disabled={disabled}
        />
        <span>Agent may run allow-listed commands without asking</span>
      </label>
      <button
        className="settings-action primary"
        type="button"
        disabled={disabled}
        onClick={() =>
          void onUpdateSettings({
            terminalPolicy: {
              mode: policyMode,
              allowList: allowList.split(/\r?\n/),
              allowAgentCommands,
            },
          })
        }
      >
        Save terminal policy
      </button>

      <div className="setting-row">
        <span>Project instructions</span>
        <b>ZAP.md</b>
      </div>
      <textarea
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        placeholder="House rules the agent must follow in this project…"
        disabled={previewMode || !workspace || projectBusy}
        aria-label="Project instructions"
      />
      <div className="setting-row">
        <span>Ignored paths</span>
        <b>.zapignore</b>
      </div>
      <textarea
        value={ignorePatterns}
        onChange={(event) => setIgnorePatterns(event.target.value)}
        placeholder={'docs\n*.snap'}
        disabled={previewMode || !workspace || projectBusy}
        aria-label="Ignored paths"
      />
      <button
        className="settings-action primary"
        type="button"
        disabled={previewMode || !workspace || projectBusy}
        onClick={() => void saveProjectConfig()}
      >
        {projectBusy ? 'Saving…' : 'Save project rules'}
      </button>
      {projectNote && <small>{projectNote}</small>}
      {!workspace && <small>Open a project to edit its instructions.</small>}
      {error && <small className="inline-error">{error}</small>}
    </div>
  );
}
