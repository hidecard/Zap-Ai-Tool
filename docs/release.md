# Zap Ai Tool release workflow

The workflow at `.github/workflows/build-windows.yml` builds raw installer files and publishes them directly to a versioned GitHub Release. It does not publish ZIP files as release assets.

## Release outputs

For a tag such as `vX.Y.Z`, the release contains:

- `Zap-Ai-Tool-X.Y.Z-win-x64.exe` — Windows x64 per-user NSIS installer (no administrator elevation required)
- `Zap-Ai-Tool-X.Y.Z-linux-amd64.deb` — Linux x64 Debian package

The Windows installer is not code-signed. SmartScreen may display an unknown-publisher prompt; trusted signing credentials are required to remove that warning reliably.

The installer files may be wrapped by GitHub internally when downloading Actions artifacts, but the files attached to the GitHub Release are the original `.exe` and `.deb` files.

## Create a release

Update the version, commit, and push a semantic version tag:

```bash
npm version X.Y.Z --no-git-tag-version
npm install --package-lock-only
npm run check
npm test
git add package.json package-lock.json
git commit -m "release: vX.Y.Z"
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow runs two platform jobs in parallel. Each job runs type-checking and tests, then verifies that exactly one valid installer artifact was created. After both succeed, the release job creates or updates the GitHub Release and attaches the raw `.exe` and `.deb` files. Runs for the same tag are serialized so two releases cannot publish conflicting assets.

A manual Actions run can validate builds and upload temporary workflow artifacts, but only a version tag publishes a GitHub Release.

## Local packaging

```bash
npm ci
npm run check
npm run package:win  # Windows or a compatible cross-build environment
npm run package:deb  # Linux
```

Both commands write packages to `release/`. The Linux `.deb` build can run on Ubuntu. Windows NSIS packaging is guaranteed on the workflow's `windows-latest` runner. The app writes installed model files under Electron's per-user `userData/Models` directory rather than the protected installation folder. Add code-signing secrets and configure signing before public distribution if trusted publisher identity is required.

The installer does not bundle large GGUF models or a platform-specific `llama-server` binary. After installation, users must install llama.cpp for their platform, place GGUF files in the app's per-user `Models/` directory, and configure `LLAMA_SERVER_PATH` when `llama-server` is not on `PATH`.
