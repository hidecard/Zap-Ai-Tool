# Backend threat model

Zap Ai Tool treats model output as **untrusted input**. A model can propose tool calls and diffs, but it cannot grant itself approval.

## Assets

- Files outside the selected workspace
- Secrets such as `.env`, SSH keys, and credentials
- User source files and unapproved changes
- Local process and machine integrity

## Controls

- File reads and patch paths are resolved against the selected workspace; file reads reject symlinks that resolve outside it, and patches reject symlink targets or parent directories. Patch paths also reject repository metadata, build/dependency output, secrets, and backup paths.
- Build proposals are limited to eight unique whole-file changes. Existing-file before-content must match disk before review; explicit create-vs-update intent is checked for both new and empty existing files. Users can deselect files before approving the batch.
- Mutating and network-risk tool calls require `status: approved`.
- The renderer exposes only a manual terminal command box: the user must enter a command and explicitly press **Run**. The main process additionally requires the command's working directory to match the currently selected workspace.
- Destructive shell patterns, privilege escalation, download-to-shell pipelines, and protected `/etc` writes are blocked.
- Terminal output is bounded and commands have timeout/cancellation reporting.
- Patches are fully preflighted, backed up under collision-resistant IDs without overwriting earlier backups, written through temporary files, and rollbackable.
- The UI supports whole-file selection for a proposed batch. A core hunk-review helper is tested, but line-level hunk selection is not yet connected to the review dialog.

## Residual risks

Shell commands still execute with the user's OS account. Pattern blocking is defense-in-depth, not a sandbox. Users should reject commands they do not understand and run the application with a least-privilege account. Build mode does not invoke terminal commands autonomously. A future production runtime should execute terminal tools in an OS/container sandbox and add an allow-list for commands.

Prompt injection in project files is handled by treating workspace content as data, not instructions. The orchestrator must keep system/developer policy separate from file content and never auto-approve a tool call because a file requests it.
