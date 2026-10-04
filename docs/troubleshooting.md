# Zap Ai Tool troubleshooting

## Windows app opens but the UI is blank

This usually means the renderer assets were built with web-root paths while Electron is loading the page through `file://`.

The repository is configured with `base: './'` in `vite.config.ts`, so new builds generate relative `./assets/...` paths that work inside the packaged app.

### Fix

1. Download the latest `Zap-Ai-Tool-*.exe` release.
2. Install it for the current user using the default install folder (`%LOCALAPPDATA%\Programs`). The installer does not require administrator privileges.
3. Uninstall the old build if Windows keeps launching its previous shortcut, then install the new version.

### Verify the build

After `npm run build`, confirm that `dist/renderer/index.html` references assets like:

```html
<script type="module" crossorigin src="./assets/index-<hash>.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-<hash>.css" />
```

Absolute `/assets/...` paths are not valid for the packaged Electron `file://` renderer.

## Windows says the app is from an unknown publisher

The Windows installer is currently unsigned. Microsoft SmartScreen can show an unknown-publisher warning and require **More info → Run anyway** (wording may vary by Windows version). This warning cannot be reliably removed by changing installer settings; a trusted code-signing certificate and signed release are required. Do not bypass the warning unless you downloaded the installer from the official Zap Ai Tool GitHub Releases page and trust the source.

## No local models found

- In development, place `.gguf` files in the repository's `Models/` directory.
- In an installed app, place `.gguf` files in the app's per-user application data `Models/` directory (on Windows, beneath `%APPDATA%` in the Zap Ai Tool folder).

Packaged builds now keep models outside the installation folder so users can run normally without administrator permissions. Models are not bundled in the installer.

## Workspace cannot be loaded

Use **Choose project folder** or drag a folder into the workspace. Zap Ai Tool skips common dependency/build directories and secret filenames such as `.env`, `.env.local`, and SSH private keys by default.
