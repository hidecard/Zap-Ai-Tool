# Zap Ai Tool

> A model-agnostic AI software engineer desktop app with project context, autonomous tool use, and human-in-the-loop code approval.

## Overview

**Zap Ai Tool** is planned as a privacy-first desktop development assistant. Users can connect a local GGUF model of their choice—such as Llama, DeepSeek, or Qwen—load a project folder, ask for changes, review generated diffs, and approve changes before they are written to disk.

The initial product flow is divided into four modules:

1. **Model Management** — discover `.gguf` files in the local `Models/` directory, select a model from Settings, and dynamically unload/load models.
2. **Workspace & Project Context** — accept a project folder, generate a safe file tree, and provide relevant context to the assistant.
3. **Autonomous Loop** — let the assistant plan, use approved tools such as Terminal and File Reader, draft changes, and run validation.
4. **Human-in-the-Loop** — show old/new code in a diff view; only apply changes after the user presses **Approve**. **Reject** sends feedback back to the assistant.

## Current implementation

The repository now contains a tested TypeScript core foundation in `src/`:

- Electron desktop shell with a React/Vite renderer and secure preload bridge.
- Model Management settings panel with `.gguf` discovery, selection, load state, and health/error status.
- Domain types for models, workspaces, tool calls, diffs, and agent tasks.
- `.gguf` model discovery with sorted descriptors.
- Model selection lifecycle with safe unload/load ordering and runtime health checks.
- Ignore-aware workspace tree/context generation that excludes common build folders and secret files.
- Read-only workspace File Reader and permissioned Terminal runner with output capture, timeout, and cancellation.
- Bounded autonomous task transitions with retry accounting.
- Tool permission checks that keep file access inside the workspace and block unsafe command patterns.
- Structured JSON logging and a local settings store.
- Node test runner coverage for the foundation modules.

The desktop shell choice remains an architecture spike item. The core is intentionally UI- and runtime-agnostic so it can be hosted in Tauri or Electron without changing the safety boundary.

## Planned architecture

```text
Desktop UI
  ├─ Model selector + settings
  ├─ Workspace tree + chat
  ├─ Diff viewer + approval controls
  └─ Activity / terminal log
        │
        ▼
Orchestrator
  ├─ Model adapter (GGUF / llama.cpp compatible)
  ├─ Context builder
  ├─ Tool permission layer
  ├─ Draft + diff engine
  ├─ Validation / self-correction state machine
        │
        ▼
Local project workspace
```

## Safety principles

- Never overwrite an original file without explicit user approval.
- Ask for permission before destructive or network-sensitive terminal commands.
- Keep model files and project context local by default.
- Restrict file and terminal tools to the selected workspace.
- Make every proposed change reviewable and reversible.
- Record tool activity and validation results for debugging.

## Development

```bash
npm install
npm test
npm run check
npm run build
npm run desktop
```

Put local GGUF files in `Models/` before launching the desktop shell. The settings dropdown scans this directory on startup. The current runtime adapter is a safe integration boundary; connecting llama.cpp is tracked separately in `Todo.md`.

See [`Todo.md`](./Todo.md) for the tracked implementation roadmap.

## Suggested technology direction

The implementation can use any suitable desktop stack. A practical first spike is:

- Desktop shell: Tauri or Electron
- UI: React + TypeScript
- Local model runtime: llama.cpp-compatible backend
- Diff engine: a standard unified diff library with a side-by-side viewer
- Tests: unit tests for orchestration and integration tests for a sandboxed workspace

Technology choices remain open until the first desktop shell spike is complete.

## Contributing

Contributions are welcome. Please open an issue describing the proposed change before starting large architectural work.

## License

License to be selected before the first production release.
