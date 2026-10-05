# Zap Ai Tool

> A local-first Windows/Linux desktop coding assistant powered by GGUF models and llama.cpp.

## Overview

Zap Ai Tool is an Electron application for browsing a local project, asking questions about the selected file, and drafting changes with a local model. Build mode proposes whole-file replacements for up to eight existing or new files. The new Agent mode runs a bounded local-model loop: it can read a few relevant project files, optionally request permission to run a terminal command, use that command's result to continue, and prepare changes for human review. Neither mode writes files before the user reviews and approves the proposal. Approved patches are applied transactionally, backed up, and can be rolled back from Approved Changes.

A user-invoked terminal is available in the selected project. Commands run only after the user presses **Run**, in the selected workspace, as the current OS account. Review commands before running them.

## Current implementation

- Electron desktop shell with a React/Vite renderer and context-isolated preload bridge.
- Local `.gguf` discovery, model selection, `llama-server` lifecycle, health checks, and completion requests.
- Optional hosted provider: any OpenAI-compatible `/chat/completions` endpoint can replace the local runtime from **Settings → Model provider**.
- Workspace folder picker and drag-and-drop, ignore-aware file indexing, context estimates, and automatic reopening of the last project.
- Explorer can create a new project file by relative path; it opens straight into edit mode and is written through the same backup/rollback boundary as every other change.
- Project instructions (`ZAP.md`) and ignore patterns (`.zapignore`) are editable in Settings and rebuilt into context on save.
- A real editor view that loads the selected file from disk, with a manual edit mode (Ctrl+S to save, Esc to cancel) written through the same backup/rollback boundary as AI changes.
- Full-text project search with match-case and regex options, grouped results, and click-to-jump line navigation.
- Git integration in Source Control: working-tree status from `git status --porcelain` plus a read-only HEAD-versus-disk diff per file.
- Ask mode sends the selected file content to the local model; Build mode includes the selected file plus a few relevant files, then can draft a bounded multi-file change or new file.
- Agent mode uses a bounded task loop with structured model actions, up to four protected workspace-file reads, at most two terminal command proposals (each shown in a native approval dialog), up to eight reviewed file changes, three self-correction attempts, and a three-minute execution budget. A command is not run if the budget expires while its approval dialog is waiting.
- The Agent streams typed progress events (step, tool call, approval prompt, revision, cancellation) to the panel and Output log, and the user can **Stop** an in-flight task; cancellation aborts the model request, any running command, and the task loop.
- Review dialog shows a side-by-side line diff with selectable hunks. Only the files and hunks you keep are narrowed into the patch that is applied.
- Model context and change proposals share protected-path checks for environment files, package/cloud credentials, private keys, repository metadata, backups, dependencies, and build output. Project instruction files (`ZAP.md`, `.zapignore`) are human-owned and cannot be patched by a model proposal.
- Reviewed changes and manual saves are applied transactionally with stale-file checks, backups, and an Undo action.
- User settings for the model folder, indexed workspace entry limit, terminal policy, and provider.
- Manual terminal command entry with captured output, a 30-second timeout, output limits, common dangerous-pattern blocks, Stop control, Arrow-key command history, and native Windows `cmd.exe` / POSIX shell support. Terminal child processes receive a scrubbed environment (no `OPENAI_API_KEY`, `AWS_*`, `NPM_TOKEN`, `GITHUB_TOKEN`, and similar parent secrets).
- Optional terminal allow-list: `ask-every-time` (default) or `allow-list` mode where only configured command prefixes run, optionally without a prompt for allow-listed Agent commands.
- Output/activity view, typed core services, and cross-platform unit tests.
- Text handling is encoding-aware: file reads honour a UTF-8/UTF-16 byte-order mark and manual saves keep the file's existing encoding, and captured command output is decoded as strict UTF-8 with a Windows code-page fallback instead of becoming mojibake.

## Current limitations

- Build mode is bounded to eight whole-file changes per request and needs an existing file selected to start. It does not run tools; use Agent mode for bounded read/terminal/proposal steps.
- Review and patch application still replace whole files. Hunk selection narrows _what_ is written, but writing uses a single atomic file replacement per file rather than partial line patching.
- Git integration is read-only: Zap shows status and diffs but does not stage, commit, or push.
- The terminal safety checks are defense-in-depth, not a real sandbox. Commands execute with the user's account and can affect anything that account can access; the allow-list restricts _which_ commands may run, not what a command can do.
- The model compatibility matrix (Llama, DeepSeek, Qwen) is still unverified beyond one small Llama3-compatible GGUF.
- The application is not code-signed yet, so Windows SmartScreen may show an unknown-publisher warning.

## Safety principles

- Never overwrite a project file without explicit review and approval.
- Manual terminal commands require the user to choose **Run**; an Agent-proposed command is shown with its exact text and selected project before a separate **Run once** approval. Blocked patterns and the optional allow-list are defense-in-depth, not a security boundary.
- The model cannot approve its own commands or write files directly; proposals are checked and shown in the human review dialog, and only reviewed hunks are applied.
- Project instruction files are human-owned: a generated patch cannot rewrite `ZAP.md` or `.zapignore`.
- Keep GGUF models and project context local by default. A hosted provider is opt-in, and its request goes only to the endpoint you configure.
- Restrict terminal execution to the selected workspace directory and withhold parent-process credentials from terminal children.
- Make approved AI file changes and manual saves recoverable through backups and rollback.
- Let the user stop long-running work: Agent tasks, terminal commands, and project search are cancellable.

## Development

```bash
npm install
npm test
npm run check
npm run benchmark
npm run build
npm run desktop
```

`npm run desktop` builds and starts the app through `scripts/launch.mjs`, which removes `ELECTRON_RUN_AS_NODE` from the environment. Editors and agent shells often export that variable, which otherwise makes Electron run as a plain Node process and never open a window.

Put local GGUF files in `Models/` before launching the desktop app in development. In an installed app, Zap stores and scans models in its per-user application-data folder so a standard Windows account can use models without administrator access. The model folder can be changed in Settings.

Already downloaded a model elsewhere? Open **Settings → Add GGUF from Downloads / any folder** to choose a `.gguf` file directly. Zap remembers the absolute path locally and shows it in the same model selector without copying the potentially large model file.

Want a hosted or remote model instead? Open **Settings → Model provider → Hosted / OpenAI-compatible endpoint**, fill in the base URL, model id, and optional API key, save, then pick the model in the model selector. Zap sends `POST {baseUrl}/chat/completions` and nothing else. The key is stored in the app's local `settings.json` and is only attached to requests for that endpoint.

Tighten the terminal with **Settings → Terminal policy**: keep `Ask before every command`, or switch to `Only allow listed commands` and list prefixes such as `npm test` or `git`. Allow-listed Agent commands can run without a prompt if you also tick that box.

`npm run benchmark` reports model discovery, workspace indexing, line-diff, and patch round-trip timings on a generated fixture project. Add `LLAMA_SERVER_PATH` and `GGUF_MODEL_PATH` to also measure `llama-server` load time and a real completion.

The desktop runtime launches a compatible `llama-server` binary for the selected GGUF model, waits for `GET /health`, and sends completions to `POST /completion`. Install a compatible llama.cpp build and either put `llama-server` on `PATH` or set `LLAMA_SERVER_PATH` (and optionally `LLAMA_GPU_LAYERS`) before starting the app.

For a real model smoke test, run `LLAMA_SERVER_PATH=/path/to/llama-server GGUF_MODEL_PATH=/path/to/model.gguf npm test`. Without those variables, the real-model test is skipped while the fake-server adapter test still runs.

For Windows and Linux installer builds, see [`docs/release.md`](./docs/release.md). A version tag such as `vX.Y.Z` publishes raw `.exe` and `.deb` files directly to a GitHub Release; it does not publish ZIP release assets. Windows builds are not code-signed yet, so Microsoft SmartScreen may still show an unknown-publisher warning until a trusted signing certificate is configured.

The backend safety assumptions and residual risks are documented in [`docs/threat-model.md`](./docs/threat-model.md). For Windows installation troubleshooting, see [`docs/troubleshooting.md`](./docs/troubleshooting.md). See [`Todo.md`](./Todo.md) for the implementation roadmap.

## Contributing

Contributions are welcome. Please open an issue describing the proposed change before starting large architectural work.

## License

[MIT](./LICENSE) © 2026 Zap Ai Tool contributors
