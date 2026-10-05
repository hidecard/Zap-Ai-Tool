# Zap Ai Tool — Todo

## Project setup

- [x] Set the app name to **Zap Ai Tool**.
- [x] Document the four-module product flow.
- [x] Add safety principles for local files and terminal tools.
- [x] Create a public GitHub repository with description and topics.
- [ ] Select and record the final open-source license.
- [x] Choose Electron for the desktop shell after the architecture spike.

## Phase 1 — Foundation

- [x] Create the Electron desktop app shell with React/Vite renderer and secure preload bridge.
- [x] Add TypeScript formatting, type-check, build, and test scripts.
- [x] Define domain types for models, workspaces, tool calls, diffs, and tasks.
- [x] Add structured application logging and error reporting boundary.
- [x] Add a local settings store for model directory and workspace preferences.
- [x] Add the initial core test suite.

## Phase 2 — Model Management

- [x] Create the `Models/` directory convention and discovery boundary.
- [x] Scan for `.gguf` model files and expose metadata.
- [x] Implement model selection service boundary for the settings UI.
- [x] Implement the model settings dropdown in the desktop renderer.
- [x] Implement safe unload/load lifecycle for switching models.
- [x] Add model runtime health checks and actionable error state.
- [ ] Test with Llama, DeepSeek, and Qwen-compatible GGUF models.

> The llama.cpp `llama-server` adapter and an opt-in real-GGUF smoke test are implemented. A tiny Llama3-compatible GGUF has been validated locally; the three-family compatibility matrix remains open.

## Phase 3 — Workspace & Context

- [x] Add the ignore-aware workspace tree/context builder.
- [x] Exclude secrets, build output, dependency folders, and oversized files by default.
- [x] Add folder picker and drag-and-drop workspace loading.
- [x] Build initial context preview and token-budget estimate UI.
- [x] Add project instructions and configurable ignore patterns.
- [x] Load selected file content in the editor and filter the indexed file paths.
- [x] Persist and restore the last opened workspace and indexed-entry limit.

## Phase 4 — Autonomous Loop

- [x] Define the task state machine types: plan → inspect → draft → validate → revise → complete.
- [x] Implement a read-only File Reader tool.
- [x] Implement a permissioned Terminal tool with command execution boundary.
- [x] Add tool-call approval policies and cancellation support.
- [x] Capture stdout, stderr, exit codes, and duration for each command.
- [x] Add bounded self-correction retry accounting to the task state machine.

> The new Agent mode connects model-generated structured actions to bounded file reads, exact-command native approval, terminal result feedback, stale-proposal validation, and bounded correction. Build mode remains a single completion request and does not invoke tools.

## Phase 5 — Human-in-the-Loop

- [x] Build a whole-file review dialog with per-file selection and batch approval.
- [ ] Build a line-level side-by-side diff and hunk selection UI.
- [x] Implement Approve, Reject, and feedback flows.
- [x] Apply approved patches atomically with backup/rollback support.
- [x] Show the current session's approved changes and provide an Undo action.
- [x] Show recent agent, approval, and terminal activity in the Output panel.

## Phase 6 — Quality & Release

- [x] Add unit tests for model discovery, context building, and permissions.
- [x] Add end-to-end tests in a disposable fixture project.
- [x] Threat-model local command execution and prompt/tool injection.
- [ ] Benchmark model loading and context performance.
- [x] Add Windows NSIS installer configuration and `npm run package:win` script.
- [x] Add Linux x64 DEB configuration and `npm run package:deb` script.
- [x] Write user documentation and troubleshooting guides.
- [x] Add GitHub Actions Windows EXE artifact workflow for version tags and manual runs.
- [x] Publish raw `.exe` and `.deb` files directly to versioned GitHub Releases.

## Phase 7 — Renderer integration

- [x] Replace the sample editor source with the selected workspace file.
- [x] Connect search to indexed file paths, Source Control to reviewed changes, and Settings to persistent preferences.
- [x] Connect a user-invoked terminal to the selected workspace, including Windows shell support.
- [x] Display real command output and session activity instead of placeholder terminal text.
- [x] Support up to eight existing/new-file proposals in a transaction with rollback.
- [x] Connect model-generated Agent actions to local GGUF completions, protected file reads, and the task state machine.
- [x] Require explicit per-command native approval and feed bounded terminal results back to the local model.
- [x] Validate generated proposals against current disk state and return them to the human review flow without writing files.
- [x] Bound Agent reads, command attempts, model steps, retry count, context size, and execution budget; expired command approvals do not run.
- [ ] Add read/write manual editor mode.
- [ ] Add user cancellation/progress events during an in-flight Agent task.
- [ ] Add sandboxed terminal execution and configurable command allow-list.
- [ ] Add hosted AI provider integrations (currently the Agent uses the local llama.cpp runtime).
- [ ] Add full-text project search and an actual Git status/diff integration.
