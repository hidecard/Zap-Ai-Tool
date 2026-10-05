# Zap Ai Tool

> A local-first Windows/Linux desktop coding assistant powered by GGUF models and llama.cpp.

## Overview

Zap Ai Tool is an Electron application for browsing a local project, asking questions about the selected file, and drafting changes with a local model. Build mode proposes whole-file replacements for up to eight existing or new files. The new Agent mode runs a bounded local-model loop: it can read a few relevant project files, optionally request permission to run a terminal command, use that command's result to continue, and prepare changes for human review. Neither mode writes files before the user reviews and approves the proposal. Approved patches are applied transactionally, backed up, and can be rolled back from Approved Changes.

A user-invoked terminal is available in the selected project. Commands run only after the user presses **Run**, in the selected workspace, as the current OS account. Review commands before running them.

## Current implementation

- Electron desktop shell with a React/Vite renderer and context-isolated preload bridge.
- Local `.gguf` discovery, model selection, `llama-server` lifecycle, health checks, and completion requests.
- Workspace folder picker and drag-and-drop, ignore-aware file indexing, context estimates, and automatic reopening of the last project.
- A real read-only editor view that loads the selected file from disk, plus filename/path filtering.
- Ask mode sends the selected file content to the local model; Build mode includes the selected file plus a few relevant files, then can draft a bounded multi-file change or new file.
- Agent mode uses a bounded task loop with structured model actions, up to four protected workspace-file reads, at most two terminal command proposals (each shown in a native approval dialog), up to eight reviewed file changes, three self-correction attempts, and a three-minute execution budget. A command is not run if the budget expires while its approval dialog is waiting.
- The Agent reports its tool actions and bounded terminal output in the Output panel. It never writes files itself; a proposal is checked against current disk contents and handed to the existing review/approval flow.
- Model context and change proposals share protected-path checks for environment files, package/cloud credentials, private keys, repository metadata, backups, dependencies, and build output.
- Reviewed changes are applied transactionally with stale-file checks, backups, and an Undo action.
- User settings for the model folder and indexed workspace entry limit.
- Manual terminal command entry with captured output, a 30-second timeout, output limits, common dangerous-pattern blocks, and native Windows `cmd.exe` / POSIX shell support.
- Output/activity view, typed core services, and cross-platform unit tests.

## Current limitations

- Build mode is bounded to eight whole-file changes per request and needs an existing file selected to start. It does not run tools; use Agent mode for bounded read/terminal/proposal steps.
- Agent mode uses the configured local `llama-server`/GGUF model only; cloud AI provider integrations are not implemented. Terminal commands still execute as the current OS user after explicit approval and are not sandboxed.
- Search filters indexed file paths; it is not full-text search.
- The code view is currently read-only; file changes are made through reviewed AI proposals.
- The terminal safety checks are defense-in-depth, not a sandbox. Commands execute with the user's account and can affect anything that account can access. The application is not code-signed yet, so Windows SmartScreen may show an unknown-publisher warning.

## Safety principles

- Never overwrite a project file without explicit review and approval.
- Manual terminal commands require the user to choose **Run**; an Agent-proposed command is shown with its exact text and selected project before a separate **Run once** approval. Blocked patterns are defense-in-depth, not a security boundary.
- The model cannot approve its own commands or write files directly; proposals are checked and shown in the human review dialog.
- Keep GGUF models and project context local by default.
- Restrict terminal execution to the selected workspace directory.
- Make approved AI file changes recoverable through backups and rollback.

## Development

```bash
npm install
npm test
npm run check
npm run build
npm run desktop
```

Put local GGUF files in `Models/` before launching the desktop app in development. In an installed app, Zap stores and scans models in its per-user application-data folder so a standard Windows account can use models without administrator access. The model folder can be changed in Settings.

Already downloaded a model elsewhere? Open **Settings → Add GGUF from Downloads / any folder** to choose a `.gguf` file directly. Zap remembers the absolute path locally and shows it in the same model selector without copying the potentially large model file.

The desktop runtime launches a compatible `llama-server` binary for the selected GGUF model, waits for `GET /health`, and sends completions to `POST /completion`. Install a compatible llama.cpp build and either put `llama-server` on `PATH` or set `LLAMA_SERVER_PATH` (and optionally `LLAMA_GPU_LAYERS`) before starting the app.

For a real model smoke test, run `LLAMA_SERVER_PATH=/path/to/llama-server GGUF_MODEL_PATH=/path/to/model.gguf npm test`. Without those variables, the real-model test is skipped while the fake-server adapter test still runs.

For Windows and Linux installer builds, see [`docs/release.md`](./docs/release.md). A version tag such as `vX.Y.Z` publishes raw `.exe` and `.deb` files directly to a GitHub Release; it does not publish ZIP release assets. Windows builds are not code-signed yet, so Microsoft SmartScreen may still show an unknown-publisher warning until a trusted signing certificate is configured.

The backend safety assumptions and residual risks are documented in [`docs/threat-model.md`](./docs/threat-model.md). For Windows installation troubleshooting, see [`docs/troubleshooting.md`](./docs/troubleshooting.md). See [`Todo.md`](./Todo.md) for the implementation roadmap.

## Contributing

Contributions are welcome. Please open an issue describing the proposed change before starting large architectural work.

## License

License to be selected before the first production release.
