# Backend threat model

Zap Ai Tool treats model output as **untrusted input**. A model can propose tool calls and diffs, but it cannot grant itself approval.

## Assets

- Files outside the selected workspace
- Secrets such as `.env`, SSH keys, and credentials
- User source files and unapproved changes
- Local process and machine integrity

## Controls

- File reads and patch paths are resolved against the selected workspace; symlink patch targets are rejected.
- Mutating and network-risk tool calls require `status: approved`.
- Destructive shell patterns, privilege escalation, download-to-shell pipelines, and protected `/etc` writes are blocked.
- Terminal output is bounded and commands have timeout/cancellation reporting.
- Patches are fully preflighted, backed up, written through temporary files, and rollbackable.
- Review metadata supports whole-file selection and hunk-level inspection before applying diffs.

## Residual risks

Shell commands still execute with the user's OS account. Pattern blocking is defense-in-depth, not a sandbox. Users should reject commands they do not understand and run the application with a least-privilege account. A future production runtime should execute terminal tools in an OS/container sandbox and add an allow-list for commands.

Prompt injection in project files is handled by treating workspace content as data, not instructions. The orchestrator must keep system/developer policy separate from file content and never auto-approve a tool call because a file requests it.
