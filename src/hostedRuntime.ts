import type { ModelDescriptor } from './domain.js';
import type { ModelRuntime } from './modelManager.js';
import { combineSignals, type CompletionOptions, type CompletionResult } from './llamaRuntime.js';
import type { ProviderSettings } from './settings.js';

export interface HostedRuntimeOptions {
  baseUrl: string;
  apiKey?: string;
  /** Remote model id; defaults to the model descriptor handed to `load`. */
  model?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function describeHostedModel(settings: ProviderSettings): ModelDescriptor {
  const baseUrl = settings.baseUrl?.trim() ?? '';
  const model = settings.model?.trim() ?? '';
  return {
    id: `remote:${model || 'hosted'}`,
    name: model || 'Hosted model',
    path: baseUrl,
    format: 'remote',
    sizeBytes: 0,
    modifiedAt: new Date(0).toISOString(),
  };
}

/**
 * Talks to any OpenAI-compatible `/chat/completions` endpoint, which covers
 * hosted providers and local gateways such as Ollama's OpenAI shim, LM Studio,
 * or a self-hosted vLLM. The API key never leaves the local app except for the
 * request to the configured endpoint.
 */
export class HostedChatRuntime implements ModelRuntime {
  private model: ModelDescriptor | undefined;
  private readonly requestImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: HostedRuntimeOptions) {
    this.requestImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  }

  private baseUrl(): string {
    const value = normalizeBaseUrl(this.options.baseUrl);
    if (!value) throw new Error('Set a hosted provider endpoint URL in Settings first.');
    return value;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    return headers;
  }

  async load(model: ModelDescriptor): Promise<void> {
    const baseUrl = this.baseUrl();
    if (!/^https?:\/\//i.test(baseUrl))
      throw new Error('The hosted endpoint must start with http:// or https://');
    this.model = model;
  }

  async unload(): Promise<void> {
    this.model = undefined;
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      const response = await this.requestImpl(`${this.baseUrl()}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return { healthy: true, message: 'Hosted endpoint reachable.' };
      return {
        healthy: false,
        message: `Hosted endpoint answered HTTP ${response.status}. ${(await response.text()).slice(0, 200)}`,
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Hosted endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async complete(prompt: string, options: CompletionOptions = {}): Promise<CompletionResult> {
    if (!this.model) throw new Error('Select a hosted model first.');
    const body = {
      model: this.options.model?.trim() || this.model.name,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.maxTokens ?? 1_024,
      temperature: options.temperature ?? 0.2,
      ...(options.topP === undefined ? {} : { top_p: options.topP }),
      ...(options.stop === undefined ? {} : { stop: options.stop }),
      stream: false,
    };
    const response = await this.requestImpl(`${this.baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      signal: combineSignals(
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? this.requestTimeoutMs),
      ),
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    if (!response.ok)
      throw new Error(`Hosted completion failed (HTTP ${response.status}): ${raw.slice(0, 2_000)}`);
    let payload: {
      choices?: { message?: { content?: unknown }; text?: unknown }[];
      usage?: { completion_tokens?: unknown };
    };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      throw new Error(`Hosted endpoint returned invalid JSON: ${raw.slice(0, 2_000)}`);
    }
    const choice = payload.choices?.[0];
    const content = choice?.message?.content ?? choice?.text;
    if (typeof content !== 'string')
      throw new Error('Hosted endpoint response did not contain completion content.');
    return {
      content,
      ...(typeof payload.usage?.completion_tokens === 'number'
        ? { tokensPredicted: payload.usage.completion_tokens }
        : {}),
    };
  }
}
