# Zap Ai Tool troubleshooting

## Buttons do nothing and the window never opens

Two separate failures look the same from the outside: every click is ignored because the renderer has no bridge, or nothing opens at all.

**No window opens.** Some editors and agent shells export `ELECTRON_RUN_AS_NODE=1`, which turns `electron .` into a plain Node process. The app then dies before creating a window. `npm run desktop` launches through `scripts/launch.mjs`, which strips that variable, so use the script rather than calling `electron` directly.

**The window opens but every action fails.** That is the preload bridge missing: `window.zap` is `undefined` and every IPC call throws. Confirm the preload loaded with `Settings → Check runtime health`, or check the startup log for `Unable to load preload script`. `desktop/preload.cts` compiles to `dist/desktop/preload.cjs`, which Electron can execute; an ESM `preload.js` next to it cannot. `npm test` fails if the preload path or the `.cts` build step is removed.

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

## Searching finds nothing

Search reads file contents from the indexed project files. Two things can limit it:

- Binary files, files above the 1 MB scan limit, and protected paths (secrets, build output) are skipped. The result line reports how many files were searched and skipped.
- Files excluded by `ZAP.md` instructions or `.zapignore` patterns are not indexed and therefore not searched. Check **Settings → Ignored paths** and remove the pattern, then save so the project is re-indexed.

## Text looks garbled in the editor or terminal

Zap decodes file content by its byte-order mark, so UTF-8, UTF-8 with BOM, UTF-16LE, and UTF-16BE files all open correctly, and a manual save keeps the encoding the file already used.

Terminal output is decoded as strict UTF-8 first, which covers `git`, `npm`, and Node tools, and falls back to a Windows code page for commands that still write the OEM console encoding. If a specific command prints garbled text, run it with output redirected to a file and read the file in the editor instead:

```bash
npm test > test-output.txt 2>&1
```

## A terminal command is rejected by policy

In **Settings → Terminal policy**, `Ask before every command` shows the approval dialog for everything. `Only allow listed commands` allows only the listed prefixes, for both your own commands and Agent commands. Entries are matched on command words, so `npm test` also allows `npm test --watch`, while `npm` alone allows every `npm ...` command. Switch back to `Ask before every command` if a specific command should simply be approved once.

Blocked safety patterns (`rm -rf`, `sudo`, `curl | sh`, `chmod`, writes to `/etc`) are refused regardless of the allow-list.

## Hosted model will not load

- Confirm the base URL ends in the API root, for example `https://api.example.com/v1`. Zap appends `/chat/completions` and checks `/models` for health.
- Use **Settings → Check runtime health** to see the exact HTTP status or network error.
- A 401/403 usually means the API key is missing or wrong. The key is stored in the app's local `settings.json`; clear the field and save to remove it.
- Switching the provider unloads the local `llama-server` model. Switch back to **Local llama.cpp server (GGUF)** to use local models again.
