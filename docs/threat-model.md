# Backend threat model

Zap Ai Tool treats model output as **untrusted input**. A model can propose tool calls and diffs, but it cannot grant itself approval.

## Assets

- Files outside the selected workspace
- Secrets such as `.env`, SSH keys, and credentials
- User source files and unapproved changes
- Local process and machine integrity

## Controls

- File reads and patch paths are resolved against the selected workspace; file reads reject symlinks that resolve outside it, and patches reject symlink targets or parent directories. Patch paths also reject repository metadata, build/dependency output, secrets, and backup paths.
- A shared path policy excludes `.env*`, cloud/package credentials, private-key material, `.ssh`/`.aws`/`.azure`, repository metadata, dependencies, build output, and patch backups from workspace context, Agent reads, and generated changes. Read checks also inspect the resolved symlink target.
- Build proposals are limited to eight unique whole-file changes. Existing-file before-content must match disk before review; explicit create-vs-update intent is checked for both new and empty existing files. Users can deselect files before approving the batch.
- Mutating and network-risk tool calls require `status: approved`.
- Agent mode uses the local model to return one structured action at a time. It is limited to ten model steps, three minutes, four file reads (8 KB each), two terminal proposals, eight file changes, and three correction attempts.
- Every Agent terminal command is shown in a native OS approval dialog with its exact text and project working directory. The main process verifies the selected workspace before and after approval and again before execution; rejection is recorded and the command is not run.
- The manual terminal also requires an explicit **Run** action. The main process requires the command's working directory to match the currently selected workspace.
- Destructive shell patterns, privilege escalation, download-to-shell pipelines, and protected `/etc` writes are blocked.
- Terminal output is bounded and fed back to the local model as untrusted data; commands have timeout/cancellation reporting.
- The Agent cannot directly write files. It returns a proposal checked against current disk contents, and the existing human review/approval flow controls all writes.
- Patches are fully preflighted, backed up under collision-resistant IDs without overwriting earlier backups, written through temporary files, and rollbackable.
- The UI supports whole-file selection for a proposed batch. A core hunk-review helper is tested, but line-level hunk selection is not yet connected to the review dialog.

## Residual risks

Shell commands still execute with the user's OS account. Pattern blocking is defense-in-depth, not a sandbox; native approval reduces accidental execution but does not make a malicious or misunderstood command safe. Users should reject commands they do not understand and run the application with a least-privilege account. Agent model output may be malformed or incorrect; strict parsing, hard bounds, and file review reduce but do not eliminate risk. A future production runtime should execute terminal tools in an OS/container sandbox and add an allow-list for commands.

Prompt injection in project files, project instructions, and terminal output is handled by treating them as untrusted data, not higher-priority instructions. The orchestrator keeps the action policy separate from file content and never auto-approves a tool call because a file or model requests it. Agent tasks currently use the local llama.cpp runtime; hosted-provider credential handling is not implemented.
