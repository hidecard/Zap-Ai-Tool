# Zap Ai Tool — Todo

## Project setup

- [x] Set the app name to **Zap Ai Tool**.
- [x] Document the four-module product flow.
- [x] Add safety principles for local files and terminal tools.
- [x] Create a public GitHub repository with description and topics.
- [ ] Select and record the final open-source license.
- [ ] Decide between Tauri and Electron after the desktop spike.

## Phase 1 — Foundation

- [ ] Create the desktop app shell.
- [ ] Add TypeScript/React linting, formatting, and test scripts.
- [ ] Define the domain types for models, workspaces, tool calls, diffs, and tasks.
- [ ] Add structured application logging and error reporting.
- [ ] Add a settings store for model directory and workspace preferences.

## Phase 2 — Model Management

- [ ] Create the `Models/` directory convention and onboarding screen.
- [ ] Scan for `.gguf` model files and display metadata where available.
- [ ] Implement model selection in the settings dropdown.
- [ ] Implement safe unload/load lifecycle for switching models.
- [ ] Add model runtime health checks and actionable error messages.
- [ ] Test with Llama, DeepSeek, and Qwen-compatible GGUF models.

## Phase 3 — Workspace & Context

- [ ] Add folder picker and drag-and-drop workspace loading.
- [ ] Generate an ignore-aware project tree.
- [ ] Exclude secrets, build output, dependency folders, and oversized files by default.
- [ ] Build context selection and token-budget management.
- [ ] Add project instructions and configurable ignore patterns.

## Phase 4 — Autonomous Loop

- [ ] Define the task state machine: plan → inspect → draft → validate → revise → complete.
- [ ] Implement a read-only File Reader tool.
- [ ] Implement a permissioned Terminal tool with command preview.
- [ ] Add tool-call approval policies and cancellation.
- [ ] Capture stdout, stderr, exit codes, and duration for each command.
- [ ] Add bounded self-correction retries for validation failures.

## Phase 5 — Human-in-the-Loop

- [ ] Build side-by-side old/new diff view.
- [ ] Support file-by-file and hunk-by-hunk review.
- [ ] Implement Approve, Reject, and feedback flows.
- [ ] Apply approved patches atomically with backup/rollback support.
- [ ] Show an activity timeline and task completion summary.

## Phase 6 — Quality & Release

- [ ] Add unit tests for model discovery, context building, patch application, and permissions.
- [ ] Add end-to-end tests in a disposable fixture project.
- [ ] Threat-model local command execution and prompt/tool injection.
- [ ] Benchmark model loading and context performance.
- [ ] Package installers for supported desktop platforms.
- [ ] Write user documentation and troubleshooting guides.
- [ ] Add release CI and version tags.
