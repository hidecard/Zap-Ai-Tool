import { spawn, type ChildProcess } from 'node:child_process';
import type { ModelDescriptor } from './domain.js';
import type { ModelRuntime } from './modelManager.js';

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  timeoutMs?: number;
  /** User cancellation, for example the Stop button during an agent task. */
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string;
  tokensPredicted?: number;
  timings?: Record<string, unknown>;
}

export interface LlamaRuntimeOptions {
  executablePath?: string;
  host?: string;
  port?: number;
  contextSize?: number;
  gpuLayers?: number;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  extraArgs?: string[];
  spawnProcess?: (command: string, args: string[]) => ChildProcess;
}

/** Combines cancellation with the request timeout so either one stops the call. */
export function combineSignals(signal: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!signal) return timeout;
  if (signal.aborted) return signal;
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  timeout.addEventListener('abort', () => controller.abort(timeout.reason), { once: true });
  return controller.signal;
}

/**
 * Adapter for the official llama.cpp `llama-server` binary.
 *
 * The binary is intentionally external: users can install a CPU, CUDA, Metal,
 * Vulkan, or other build without changing Zap's TypeScript core. Set
 * LLAMA_SERVER_PATH to the executable when it is not on PATH.
 */
export class LlamaServerRuntime implements ModelRuntime {
  private process: ChildProcess | undefined;
  private model: ModelDescriptor | undefined;
  private baseUrl: string;
  private stderr = '';
  private readonly spawnProcess: (command: string, args: string[]) => ChildProcess;
  private readonly options: Required<
    Pick<
      LlamaRuntimeOptions,
      'host' | 'port' | 'contextSize' | 'startupTimeoutMs' | 'requestTimeoutMs'
    >
  > &
    LlamaRuntimeOptions;

  constructor(options: LlamaRuntimeOptions = {}) {
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args) =>
        spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
    this.options = {
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 8090,
      contextSize: options.contextSize ?? 4096,
      startupTimeoutMs: options.startupTimeoutMs ?? 120_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
      ...options,
    };
    this.baseUrl = `http://${this.options.host}:${this.options.port}`;
  }

  async load(model: ModelDescriptor): Promise<void> {
    await this.unload();
    this.stderr = '';
    const executable =
      this.options.executablePath ?? process.env.LLAMA_SERVER_PATH ?? 'llama-server';
    const args = [
      '--model',
      model.path,
      '--host',
      this.options.host,
      '--port',
      String(this.options.port),
      '--ctx-size',
      String(this.options.contextSize),
      ...(this.options.gpuLayers === undefined
        ? []
        : ['--n-gpu-layers', String(this.options.gpuLayers)]),
      ...(this.options.extraArgs ?? []),
    ];
    const child = this.spawnProcess(executable, args);
    this.process = child;
    this.model = model;
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-16_000);
    });
    child.stdout?.on('data', () => undefined);
    const startupError = new Promise<never>((_resolve, reject) => {
      child.once('error', (error) =>
        reject(new Error(`Unable to start llama-server: ${error.message}`)),
      );
      child.once('exit', (code, signal) => {
        if (this.process === child && code !== 0) {
          reject(
            new Error(
              `llama-server exited during startup (code=${code ?? 'null'}, signal=${signal ?? 'none'}): ${this.stderr.trim()}`,
            ),
          );
        }
      });
    });
    try {
      await this.waitUntilHealthy(this.options.startupTimeoutMs, startupError);
    } catch (error) {
      await this.unload();
      throw error;
    }
  }

  async unload(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    this.model = undefined;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    if (!this.process || this.process.exitCode !== null) {
      return { healthy: false, message: 'llama-server is not running.' };
    }
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return { healthy: true, message: 'llama-server is ready.' };
      return { healthy: false, message: `llama-server is not ready (HTTP ${response.status}).` };
    } catch (error) {
      return {
        healthy: false,
        message: `llama-server health check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async complete(prompt: string, options: CompletionOptions = {}): Promise<CompletionResult> {
    if (!this.process || !this.model) throw new Error('No GGUF model is loaded.');
    const response = await fetch(`${this.baseUrl}/completion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: combineSignals(
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? this.options.requestTimeoutMs),
      ),
      body: JSON.stringify({
        prompt,
        n_predict: options.maxTokens ?? 256,
        temperature: options.temperature ?? 0.2,
        top_p: options.topP ?? 0.95,
        ...(options.stop === undefined ? {} : { stop: options.stop }),
        stream: false,
      }),
    });
    const raw = await response.text();
    if (!response.ok)
      throw new Error(
        `llama-server completion failed (HTTP ${response.status}): ${raw.slice(0, 2_000)}`,
      );
    let payload: { content?: unknown; tokens_predicted?: unknown; timings?: unknown };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      throw new Error(`llama-server returned invalid JSON: ${raw.slice(0, 2_000)}`);
    }
    if (typeof payload.content !== 'string')
      throw new Error('llama-server response did not contain completion content.');
    return {
      content: payload.content,
      ...(typeof payload.tokens_predicted === 'number'
        ? { tokensPredicted: payload.tokens_predicted }
        : {}),
      ...(payload.timings !== null && typeof payload.timings === 'object'
        ? { timings: payload.timings as Record<string, unknown> }
        : {}),
    };
  }

  private async waitUntilHealthy(timeoutMs: number, startupError: Promise<never>): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const health = await Promise.race([this.healthCheck(), startupError]);
      if (health.healthy) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for llama-server after ${timeoutMs}ms.`);
  }
}
