# Backend threat model

Zap Ai Tool treats model output as **untrusted input**. A model can propose tool calls and diffs, but it cannot grant itself approval.

## Assets

- Files outside the selected workspace
- Secrets such as `.env`, SSH keys, and credentials
- User source files and unapproved changes
- User project instructions (`ZAP.md`, `.zapignore`)
- Local process and machine integrity
- Hosted provider credentials, when a hosted model is configured

## Controls

- File reads and patch paths are resolved against the selected workspace; file reads reject symlinks that resolve outside it, and patches reject symlink targets or parent directories. Patch paths also reject repository metadata, build/dependency output, secrets, and backup paths.
- A shared path policy excludes `.env*`, cloud/package credentials, private-key material, `.ssh`/`.aws`/`.azure`, repository metadata, dependencies, build output, and patch backups from workspace context, Agent reads, and generated changes. Read checks also inspect the resolved symlink target.
- Project instruction files are human-owned. `ZAP.md` and `.zapignore` can only be written through the Settings flow: proposal parsing and the patch boundary both reject them, so a model cannot rewrite the instructions that steer it.
- Build proposals are limited to eight unique whole-file changes. Existing-file before-content must match disk before review; explicit create-vs-update intent is checked for both new and empty existing files. Users can deselect files and individual hunks before approving the batch, and only the kept hunks are narrowed into the patch that is applied.
- Mutating and network-risk tool calls require `status: approved`.
- Agent mode uses the configured model to return one structured action at a time. It is limited to ten model steps, three minutes, four file reads (8 KB each), two terminal proposals, eight file changes, and three correction attempts.
- Every Agent terminal command is shown in a native OS approval dialog with its exact text and project working directory. The main process verifies the selected workspace before and after approval and again before execution; rejection is recorded and the command is not run. If the Agent execution budget expires while the dialog is waiting, a later approval does not execute the stale command.
- A terminal allow-list is available in Settings. In `allow-list` mode only commands whose prefix matches a configured entry run, for both manual and Agent commands; prefixes are matched on command words so `npm test` cannot authorize `sudo npm test`. Allow-listed Agent commands can additionally skip the prompt, which is an explicit user opt-in.
- The manual terminal also requires an explicit **Run** action. The main process requires the command's working directory to match the currently selected workspace.
- Destructive shell patterns, privilege escalation, download-to-shell pipelines, and protected `/etc` writes are blocked.
- Terminal children receive a scrubbed environment: only platform-locating variables (`PATH`, `HOME`, `TEMP`, `SystemRoot`, and similar) are inherited, so tokens such as `OPENAI_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `NPM_TOKEN`, or `GITHUB_TOKEN` are not exposed to commands Zap starts.
- Terminal output is bounded and fed back to the model as untrusted data; commands have timeout/cancellation reporting.
- The Agent cannot directly write files. It returns a proposal checked against current disk contents, and the human review/approval flow controls all writes. Manual editor saves use the same preflight, backup, and rollback boundary, so an edit is recoverable like an AI change.
- Patches are fully preflighted, backed up under collision-resistant IDs without overwriting earlier backups, written through temporary files, and rollbackable.
- Long-running work is cancellable. The Stop control aborts an Agent task, its model request, any running terminal child process, and project search; cancellation never writes a partially applied change.
- Git integration is read-only. Zap runs `git status --porcelain` and `git show` with `GIT_OPTIONAL_LOCKS=0`, drops paths outside the selected workspace, and never stages, commits, or pushes.

## Hosted providers

A hosted provider is opt-in and configured by the user in Settings (base URL, model id, optional API key). The key is stored in the local `settings.json` in the app's user-data directory, is never logged, and is sent only as an `Authorization: Bearer` header to the configured endpoint. Switching providers unloads the local runtime first, so a hosted endpoint never receives local-model state unless the user selects it.

## Residual risks

Shell commands still execute with the user's OS account. Pattern blocking and the allow-list are defense-in-depth, not a sandbox; native approval reduces accidental execution but does not make a malicious or misunderstood command safe. Users should reject commands they do not understand and run the application with a least-privilege account. Agent model output may be malformed or incorrect; strict parsing, hard bounds, and file review reduce but do not eliminate risk. A future production runtime should execute terminal tools in an OS/container sandbox.

Prompt injection in project files, project instructions, and terminal output is handled by treating them as untrusted data, not higher-priority instructions. The orchestrator keeps the action policy separate from file content and never auto-approves a tool call because a file or model requests it.

A hosted provider moves prompts and project context to the endpoint the user configured. That endpoint's data handling is outside Zap's control; users who must keep project data on-device should keep the default local `llama-server` runtime. Reviewing an endpoint's retention and training policy is the user's responsibility.
