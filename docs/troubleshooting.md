# Zap Ai Tool troubleshooting

## Windows app opens but the UI is blank

This usually means the renderer assets were built with web-root paths while Electron is loading the page through `file://`.

The repository is configured with `base: './'` in `vite.config.ts`, so new builds generate relative `./assets/...` paths that work inside the packaged app.

### Fix

1. Pull the latest `main` branch.
2. Run `npm ci`.
3. Run `npm run check` and `npm test`.
4. Build or download a fresh Windows installer. An older installed build will not update itself.
5. Uninstall the old build if Windows keeps launching its previous shortcut, then install the new `Zap-Ai-Tool-*.exe`.

### Verify the build

After `npm run build`, confirm that `dist/renderer/index.html` references assets like:

```html
<script type="module" crossorigin src="./assets/index-<hash>.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-<hash>.css" />
```

Absolute `/assets/...` paths are not valid for the packaged Electron `file://` renderer.

## No local models found

Place one or more `.gguf` files in the `Models/` directory next to the application source before launching the desktop app. The Settings panel only lists `.gguf` files and ignores other file types.

## Workspace cannot be loaded

Use **Choose project folder** or drag a folder into the workspace. Zap Ai Tool skips common dependency/build directories and secret filenames such as `.env`, `.env.local`, and SSH private keys by default.
