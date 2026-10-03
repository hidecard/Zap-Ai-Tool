# Zap Ai Tool release workflow

The workflow at `.github/workflows/build-windows.yml` builds **raw installer files** and publishes them directly to a versioned GitHub Release. It does not publish ZIP files as release assets.

## Release outputs

For a tag such as `v0.3.1`, the release contains:

- `Zap-Ai-Tool-0.3.1-win-x64.exe` — Windows x64 NSIS installer
- `Zap-Ai-Tool-0.3.1-linux-amd64.deb` — Linux x64 Debian package

The installer files may be wrapped by GitHub internally when downloading Actions artifacts, but the files attached to the GitHub Release are the original `.exe` and `.deb` files.

## Create a release

Update the version, commit, and push a semantic version tag:

```bash
npm version 0.3.1 --no-git-tag-version
npm install --package-lock-only
git add package.json package-lock.json
git commit -m "release: v0.3.1"
git push origin main
git tag v0.3.1
git push origin v0.3.1
```

The workflow runs two platform jobs in parallel. After both succeed, the release job creates or updates the GitHub Release and attaches the raw `.exe` and `.deb` files.

A manual Actions run can validate builds and upload temporary workflow artifacts, but only a version tag publishes a GitHub Release.

## Local packaging

```bash
npm ci
npm run check
npm run package:win  # Windows or a compatible cross-build environment
npm run package:deb  # Linux
```

Both commands write packages to `release/`. The Linux `.deb` build can run on Ubuntu. Windows NSIS packaging is guaranteed on the workflow's `windows-latest` runner. Release installers are currently unsigned; add code-signing secrets before public distribution if required.
