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

The adapter was validated in this workspace with the public `tensorblock/tiny-llama3-test-GGUF` `tiny-llama3-test-Q2_K.gguf` fixture and a CPU `llama-server`: model loading succeeded, `/health` returned ready, and `/completion` returned a non-empty response. This is an adapter smoke test, not a quality benchmark. Llama, DeepSeek, and Qwen family model compatibility should still be checked separately before release.

## Choose a model from any folder

The desktop Settings panel has two model options:

- **Choose model folder** scans `.gguf` files in a directory such as `Models/`.
- **Add GGUF from Downloads / any folder** opens a file picker restricted to `.gguf` files. This is useful for models already downloaded elsewhere. Zap stores the selected absolute path in the local settings file, lists it alongside the model-folder entries, and sends the path directly to `llama-server` when selected.

If the original file is moved or deleted, it is ignored during the next scan and can be selected again from its new location.
