# Windows EXE release workflow

Zap Ai Tool uses Electron Builder to create a Windows NSIS installer.

## Local packaging

On Windows, run:

```bash
npm ci
npm run check
npm run package:win
```

The installer is written to `release/` as:

```text
Zap-Ai-Tool-0.3.0-win-x64.exe
```

The installer is configured to create a Start Menu entry and a desktop shortcut. It allows the user to choose the installation directory.

## GitHub Actions packaging

The workflow at `.github/workflows/build-windows.yml` runs when:

- You manually start **Build Windows Installer** from the Actions tab; or
- You push a semantic version tag such as `v0.3.0`.

The workflow runs type-checking, builds the renderer and Electron main process, packages the NSIS installer, and uploads the `.exe` as the `zap-ai-tool-windows-installer` artifact.

To trigger a build from the command line:

```bash
git tag v0.3.0
git push origin v0.3.0
```

The current workflow creates an unsigned installer. For public distribution, configure a Windows code-signing certificate in GitHub Actions secrets and add signing configuration before publishing releases.
