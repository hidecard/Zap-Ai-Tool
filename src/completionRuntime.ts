import type { CompletionOptions, CompletionResult } from './llamaRuntime.js';
import { LlamaServerRuntime } from './llamaRuntime.js';
import { HostedChatRuntime } from './hostedRuntime.js';
import type { ModelRuntime } from './modelManager.js';
import type { AppSettings, ProviderSettings } from './settings.js';

export type CompletionRuntime = ModelRuntime & {
  complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
  readonly kind: ProviderSettings['kind'];
};

export class LlamaCompletionRuntime implements CompletionRuntime {
  readonly kind = 'llama-server' as const;
  private readonly runtime: LlamaServerRuntime;

  constructor(options: ConstructorParameters<typeof LlamaServerRuntime>[0] = {}) {
    this.runtime = new LlamaServerRuntime(options);
  }

  load(model: Parameters<ModelRuntime['load']>[0]): Promise<void> {
    return this.runtime.load(model);
  }

  unload(): Promise<void> {
    return this.runtime.unload();
  }

  healthCheck(): ReturnType<ModelRuntime['healthCheck']> {
    return this.runtime.healthCheck();
  }

  complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    return this.runtime.complete(prompt, options);
  }
}

export class HostedCompletionRuntime implements CompletionRuntime {
  readonly kind = 'openai-compatible' as const;
  private readonly runtime: HostedChatRuntime;

  constructor(provider: ProviderSettings, requestTimeoutMs?: number) {
    this.runtime = new HostedChatRuntime({
      baseUrl: provider.baseUrl ?? '',
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    });
  }

  load(model: Parameters<ModelRuntime['load']>[0]): Promise<void> {
    return this.runtime.load(model);
  }

  unload(): Promise<void> {
    return this.runtime.unload();
  }

  healthCheck(): ReturnType<ModelRuntime['healthCheck']> {
    return this.runtime.healthCheck();
  }

  complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    return this.runtime.complete(prompt, options);
  }
}

/** Chooses the runtime for the configured provider without changing call sites. */
export function createCompletionRuntime(
  settings: AppSettings,
  llamaOptions: ConstructorParameters<typeof LlamaServerRuntime>[0] = {},
): CompletionRuntime {
  if (settings.provider?.kind === 'openai-compatible')
    return new HostedCompletionRuntime(settings.provider);
  return new LlamaCompletionRuntime(llamaOptions);
}
