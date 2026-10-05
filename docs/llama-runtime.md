# llama.cpp runtime

Zap starts one local `llama-server` process for the selected GGUF model. The adapter passes the model path as an argument (never through a shell), waits for `GET /health` to return HTTP 200, sends generation requests to `POST /completion`, and terminates the process during unload or model switching.

## Configuration

Install a compatible llama.cpp build and set `LLAMA_SERVER_PATH` when `llama-server` is not on `PATH`. `LLAMA_GPU_LAYERS` is optional; omit it for CPU inference. The default server is bound to `127.0.0.1:8090` and uses a 4096-token context. The adapter also supports custom settings through its TypeScript API.

Example:

```bash
export LLAMA_SERVER_PATH=/opt/llama.cpp/bin/llama-server
export LLAMA_GPU_LAYERS=0
npm run desktop
```

## Real GGUF smoke test

The opt-in integration test uses `LLAMA_SERVER_PATH` and `GGUF_MODEL_PATH` and is skipped when either variable is absent:

```bash
LLAMA_SERVER_PATH=/opt/llama.cpp/bin/llama-server \
GGUF_MODEL_PATH=/path/to/model.gguf \
npm test
```

The adapter was validated in this workspace with the public `tensorblock/tiny-llama3-test-GGUF` `tiny-llama3-test-Q2_K.gguf` fixture and a CPU `llama-server`: model loading succeeded, `/health` returned ready, and `/completion` returned a non-empty response. This is an adapter smoke test, not a quality benchmark.

## Checking a downloaded model before loading it

`npm run models:check -- <file.gguf> [...]` reads the GGUF header only (no weights are loaded) and reports the architecture, model family, quantization type, context length, layer count, and parameter count. It also exits non-zero for a file that is not GGUF or uses an unsupported GGUF version, so it works as a pre-flight check in a script.

```bash
npm run models:check -- ~/Downloads/qwen2.5-coder-7b-instruct-q4_k_m.gguf
# .../qwen2.5-coder-7b-instruct-q4_k_m.gguf: architecture=qwen2 family=Qwen \
#   name=Qwen2.5 Coder 7B Instruct quant=type 15 context=32768 layers=28 tensors=291 ggufVersion=3
```

`npm run models:check -- --settings <settings.json>` inspects every external model path Zap has remembered for that install.

## Model family compatibility matrix

The roadmap asks for Llama, DeepSeek, and Qwen models to be exercised before release. `src/gguf.ts` maps a file's architecture to the family Zap expects to support, so the matrix can be filled in for any models you have locally:

| Family   | GGUF architectures Zap recognizes                                          | Status in this repository                                                                                         |
| -------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Llama    | `llama`, `gptneox`, `falcon`, `starcoder`, `starcoder2`, `baichuan`, `mpt` | Adapter smoke-tested with a tiny Llama3-compatible GGUF. Larger Llama3/3.1 Instruct models are not verified here. |
| DeepSeek | `llama`, `deepseek2`                                                       | Not verified in this repository; `deepseek2` metadata is recognized and reported.                                 |
| Qwen     | `llama`, `qwen2`, `qwen3`, `qwen2moe`                                      | Not verified in this repository; `qwen2` metadata is recognized and reported.                                     |

Verifying a row means: run `npm run models:check` on the file, load it through the model selector, and run the opt-in real-GGUF test with `LLAMA_SERVER_PATH` and `GGUF_MODEL_PATH`. A row can only be marked verified once a real file of that family has produced a completion on this machine.

## Hosted OpenAI-compatible providers

The local runtime is the default, but **Settings → Model provider → Hosted / OpenAI-compatible endpoint** swaps in `POST {baseUrl}/chat/completions` instead of `POST /completion`. The same completion options map onto `max_tokens`, `temperature`, `top_p`, and `stop`, and the prompt is sent as a single user message. Health is checked with `GET {baseUrl}/models`. Switching providers unloads the local `llama-server` process first.

Use it for a hosted provider or a local gateway (Ollama's OpenAI-compatible shim, LM Studio, vLLM). Because requests leave the machine, read the endpoint's retention policy before pointing it at private project code; see `docs/threat-model.md`.

## Choose a model from any folder

The desktop Settings panel has two model options:

- **Choose model folder** scans `.gguf` files in a directory such as `Models/`.
- **Add GGUF from Downloads / any folder** opens a file picker restricted to `.gguf` files. This is useful for models already downloaded elsewhere. Zap stores the selected absolute path in the local settings file, lists it alongside the model-folder entries, and sends the path directly to `llama-server` when selected.

If the original file is moved or deleted, it is ignored during the next scan and can be selected again from its new location.
