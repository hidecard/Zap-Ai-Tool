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

## Phase 3 — Workspace & Context

- [x] Add the ignore-aware workspace tree/context builder.
- [x] Exclude secrets, build output, dependency folders, and oversized files by default.
- [x] Add folder picker and drag-and-drop workspace loading.
- [x] Build initial context preview and token-budget estimate UI.
- [ ] Add project instructions and configurable ignore patterns.

## Phase 4 — Autonomous Loop

- [x] Define the task state machine types: plan → inspect → draft → validate → revise → complete.
- [x] Implement a read-only File Reader tool.
- [x] Implement a permissioned Terminal tool with command execution boundary.
- [x] Add tool-call approval policies and cancellation support.
- [x] Capture stdout, stderr, exit codes, and duration for each command.
- [x] Add bounded self-correction retry accounting to the task state machine.

## Phase 5 — Human-in-the-Loop

- [ ] Build side-by-side old/new diff view.
- [ ] Support file-by-file and hunk-by-hunk review.
- [ ] Implement Approve, Reject, and feedback flows.
- [ ] Apply approved patches atomically with backup/rollback support.
- [ ] Show an activity timeline and task completion summary.

## Phase 6 — Quality & Release

- [x] Add unit tests for model discovery, context building, and permissions.
- [ ] Add end-to-end tests in a disposable fixture project.
- [ ] Threat-model local command execution and prompt/tool injection.
- [ ] Benchmark model loading and context performance.
- [x] Add Windows NSIS installer configuration and `npm run package:win` script.
- [x] Add Linux x64 DEB configuration and `npm run package:deb` script.
- [x] Write user documentation and troubleshooting guides.
- [x] Add GitHub Actions Windows EXE artifact workflow for version tags and manual runs.
- [x] Publish raw `.exe` and `.deb` files directly to versioned GitHub Releases.
