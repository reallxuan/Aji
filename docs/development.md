# Development setup

Aji installs its engine through the setup wizard, which opens by itself while no engine is set
up. For development there are two more ways in:

- name your own KataGo files in `settings.json` (`devEngine`, below), which skips the wizard;
- point `AJI_DATA_ROOT` at an empty folder, to see first-run setup without touching your real
  settings and installs (below).

`pnpm dev` also has setup scenarios that run the interface against a fake engine side, for the
panels a Mac cannot reach (below).

## Where `settings.json` lives

It sits in the app config directory of `io.github.reallxuan.aji`:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/io.github.reallxuan.aji/settings.json` |
| Windows | `%APPDATA%\io.github.reallxuan.aji\settings.json` |
| Linux | `~/.config/io.github.reallxuan.aji/settings.json` |

Aji reads it once at startup. Unknown fields are ignored. Aji also writes it, for the download
source and the accepted licences; a write keeps every field it does not know, and goes through a
temporary file that is renamed over the old one. A malformed file is never overwritten: the write
fails instead.

A malformed file, or a relative path in it, is reported only on stderr, and Aji then shows "No
engine is set up." Nothing else tells you:

- On Windows, a release build has no console, so the message goes nowhere.
- On macOS, started from Finder, it is not visible either. Run `Aji.app/Contents/MacOS/aji` from a
  terminal to read it.

## The `devEngine` setting

```json
{
  "devEngine": {
    "katago": "/opt/homebrew/bin/katago",
    "model": "/Users/you/katago/kata1-b18c384nbt.bin.gz",
    "config": "/Users/you/katago/analysis.cfg"
  }
}
```

All three paths must be absolute. Keep the model and the config in one folder you own. KataGo's
working directory is the config's folder, and Aji passes the config and the model to KataGo as names
relative to it (`-config analysis.cfg -model nets/net.bin.gz`). This keeps a non-ASCII profile path
off KataGo's command line. A model outside the config's folder is passed by its absolute path. The
KataGo binary stays absolute, because it is the program, not an argument.

On Windows, escape each backslash in JSON, or use forward slashes:

```json
{
  "devEngine": {
    "katago": "C:\\Users\\you\\katago\\katago.exe",
    "model": "C:\\Users\\you\\katago\\kata1-b18c384nbt.bin.gz",
    "config": "C:/Users/you/katago/analysis.cfg"
  }
}
```

## Which engine starts

At startup Aji picks, in order:

1. `devEngine` from `settings.json`;
2. the active installed engine set from `installed.json` (below);
3. nothing, and the engine reports `notConfigured`.

The choice is logged on stderr, then the KataGo program it runs:

```text
aji: starting the installed engine katago-v1.18.2-metal-macos-arm64 with kata1-tf3-b11c768-s12382M-d6533M
aji: starting KataGo /Users/you/Library/Application Support/io.github.reallxuan.aji/engines/katago-v1.18.2-metal-macos-arm64/katago
```

`aji: starting the development engine` means `devEngine` won. `aji: starting without an engine`
says why: none is installed, or the active set names a file that is not recorded.

## macOS

1. `brew install katago`. The binary is `/opt/homebrew/bin/katago`.
2. Homebrew's `katago` ships a b18 network. Copy it into a folder you own, next to the config, and
   point `model` at the copy:

   ```sh
   mkdir -p ~/katago
   cp /opt/homebrew/share/katago/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz ~/katago/
   ```

3. Copy the example config into that folder, because Homebrew's folder is not yours to edit:

   ```sh
   cp /opt/homebrew/share/katago/configs/analysis_example.cfg ~/katago/analysis.cfg
   ```

   `nnMaxBatchSize` is required: KataGo aborts at startup without it. The example already sets
   `nnMaxBatchSize = 64`, so keep that line in the copy.

## Windows

Unzip a KataGo release (for example the OpenCL or Eigen build) and download a network by hand,
into one folder you own. Copy that release's `analysis_example.cfg` into the same folder, keep its
`nnMaxBatchSize` line (required, and present in the example), and write the three absolute paths in
`settings.json`, escaped as shown above.

A launch from a folder whose path has Chinese characters or spaces is tested in CI against a fake
KataGo. Real KataGo on Windows is checked in the Phase 1 acceptance (M8).

## Install folders and `installed.json`

Installs live in the app local data directory:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/io.github.reallxuan.aji/` (the same folder as `settings.json`) |
| Windows | `%LOCALAPPDATA%\io.github.reallxuan.aji\` |
| Linux | `~/.local/share/io.github.reallxuan.aji/` |

```text
engines/<engine id>/       the unpacked KataGo package
runtimes/<runtime id>/     the NVIDIA DLLs, flat in one folder
networks/<file name>       networks as downloaded; imported ones as imported-<hash>.bin.gz
configs/<engine>+<network>.cfg   the generated analysis config
katago-home/               KataGo's homeDataDir (OpenCL tuning files)
downloads/                 .part files, kept so a download resumes
staging/                   the unpack area
installed.json             the record of what is installed
manifest/                  the manifest cache
```

KataGo runs with this folder as its working directory, and gets the config and the model as
relative paths, so a non-ASCII profile path stays off its command line.

`installed.json` lists the verified engines, runtimes and networks, the engine sets whose test query
passed (with their thread count and benchmark), and `active`, the set that starts. A malformed record,
or one with a newer `schema`, is renamed to `installed.json.bad-<unix seconds>` and Aji starts with an
empty one.

To start over, quit Aji and delete `installed.json` with the `engines`, `runtimes`, `networks` and
`configs` folders. On macOS do not delete the whole folder: it holds `settings.json` too.

## Seeing first-run setup: `AJI_DATA_ROOT`

Set `AJI_DATA_ROOT` to an absolute folder before starting Aji. Settings then live in
`<root>/config/` and installs in `<root>/data/`, so an empty folder gives the first-run wizard
while your real settings and engines stay as they are:

```sh
AJI_DATA_ROOT="$HOME/aji-scratch" pnpm tauri dev
```

```sh
AJI_DATA_ROOT="$HOME/aji-scratch" "/Applications/Aji.app/Contents/MacOS/aji"
```

Aji logs `aji: AJI_DATA_ROOT puts settings and installs under …`. A relative path is ignored and
logged. Release builds read the variable too, so a packaged app can be checked. Delete the folder
to start over.

The M4 `AJI_DEV_INSTALL` trigger is gone: the wizard drives the same install pipeline.

## Setup panels without the hardware: `?scenario=`

A Mac reaches only the Metal path of the setup wizard. To see the other panels, run `pnpm dev`
and open the Vite page in a browser with a scenario name, for example
`http://localhost:1420/?scenario=a1-driver`. A scripted engine side (`src/dev/scenarios.ts`)
then answers every request with ids, sizes and driver versions from the bundled manifest, and
emits install progress on timers. Nothing is downloaded and no KataGo runs.

| Scenario | What it shows |
|---|---|
| `pc-cuda` | Windows with an RTX 5070 and a current driver: CUDA installs and the engine comes up |
| `pc-old-driver` | Step 2 with CUDA disabled for an old driver; "detect again" then finds the updated one |
| `cuda-licence` | The NVIDIA licence panel before the CUDA download |
| `a1-driver` | Panel A1: CUDA fails for an old driver; Retry fails again, DirectML installs |
| `a2-gpu-error` | Panel A2: CUDA fails with a GPU error, DirectML first |
| `b-download-failed` | Panel B: the network download fails, with nothing to fall back to |
| `d-crashed` | The analysis panel with a crashed engine, and "set up again" |
| `no-engine` | Choose "set up later" to see the no-engine panel |
| `mac` | The Metal path on Apple silicon |

The language follows the browser until you switch it in the title row or in settings. Reload
the page to start a scenario again. Scenarios exist only in a development build: `main.tsx`
loads them behind `import.meta.env.DEV`, so `pnpm build` leaves them out, and an unknown name
falls back to the Tauri transport with a warning in the console.

## The `downloadSource` setting

Where engine and network files are downloaded from. NVIDIA's archives always come from NVIDIA.

```json
{ "downloadSource": { "kind": "direct" } }
```

```json
{ "downloadSource": { "kind": "prefix", "url": "https://ghproxy.example/" } }
```

```json
{ "downloadSource": { "kind": "mirror", "url": "https://mirror.example/katago" } }
```

- `direct`, the default, tries the manifest's URLs in order.
- `prefix` puts the URL in front of each `https://github.com/` URL and tries that first.
- `mirror` tries `<url>/<file name>` first.

The original URLs are always tried after a prefix or mirror. The URL must start with `http://` or
`https://` and have a host; an invalid one is logged at startup and `direct` is used. A change made
while a download runs applies from its next attempt. The wizard has no selector for it yet (the
owner's decision for M5); the `setupSetDownloadSource` request sets it.

The wizard records accepted licences in `acceptedLicences`: the SHA-256 of each licence text and
the time it was accepted.

## Interface preferences

The settings page writes five more fields. Each is read on its own: a value Aji cannot read is
logged and that field alone takes its default.

```json
{
  "language": "system",
  "theme": "system",
  "discLines": ["winrate", "scoreLead"],
  "visitLimit": null,
  "defaultRules": { "kind": "chinese" }
}
```

`language` is `system`, `zh-CN` or `en`; `theme` is `system`, `dark` or `light`; `discLines` is two
different values of `winrate`, `scoreLead` and `visits`; `visitLimit` is a positive number of visits
per position, or `null` for no limit. `defaultRules` is what new games, and files that name neither
rules nor komi, are analysed with: `{ "kind": "chinese" }`, `{ "kind": "japaneseKorean" }`, or
`{ "kind": "custom", "komi": 7, "scoring": "area" }` (`scoring` is `area` or `territory`; `komi` is a
multiple of 0.5 from -150 to 150).

## Recent files and the macOS menu

`recent.json`, beside `settings.json`, lists the last 10 game files opened or saved, newest first,
with their full paths. Deleting it empties the list; an unreadable one is ignored and replaced on
the next open.

All interface text lives in `src/locales/`, with one exception: the macOS menu bar is built in
Rust, which cannot read those files, so its labels are a table in `src-tauri/src/platform/menu.rs`
with both languages. When a menu label changes, change both languages there; the locale parity
tests do not see it. The interface tells Rust which language it resolved (`menu_set_language`), so
the menu follows the language setting, including `system`.

## What Aji forces on the command line

Aji launches `katago analysis -config <config> -model <model> -quit-without-waiting
-override-config reportAnalysisWinratesAs=BLACK,logToStderr=true`. These cannot be changed from the
config:

- `-quit-without-waiting` makes KataGo exit when Aji closes its stdin. It is the macOS mechanism
  for "no KataGo outlives Aji". Windows uses a job object, and Linux the parent-death signal.
- `reportAnalysisWinratesAs=BLACK` makes every winrate and score lead Black's.
- `logToStderr=true` sends KataGo's log to stderr, which Aji keeps (the last 50 lines) for crash
  reports.

## Checking the setup recommendation: `aji-setup-report`

`aji-setup-report` prints what the setup wizard would offer on a machine, as pretty JSON:

```sh
cargo run -p aji-manager --bin aji-setup-report
```

The output has these keys:

- `manifest`: the copy in use (`source`, `sequence`) and `rejected`, one line for each copy that was turned away.
- `hardware`: the detected OS, CPU, memory and GPUs.
- `recommendation`: the backends in order, the default and the fallbacks.
- `versions`: the engine versions for each backend in the recommendation.
- `networks`: the networks for the newest engine of the default backend.

Options:

- `--fetch` refreshes the manifest from the published URL first. Without it the program makes no network call and
  uses the manifest compiled into the binary. Until the manifest is published, a fetch fails and the bundled copy
  stays in use.
- `--hardware <report.json>` reads a `HardwareReport` from a file instead of detecting.
- `--windows-capture <aji-hardware-capture.json>` builds the report from a capture made on a Windows PC, so the
  PC's recommendation can be checked on another machine. Give at most one of the two options.

The program keeps no cache: it uses a temporary folder that it removes at the end.

## SGF fixtures

`crates/aji-core/tests/fixtures/sgf/` holds the game records the SGF tests read. `SOURCES.md` there says where each file comes from. Five are public-domain Samsung Cup finals; the rest are written by `make.py` from one of them:

```bash
python3 -I crates/aji-core/tests/fixtures/sgf/make.py
```

Run it after changing `make.py`, then `cargo test -p aji-core --test sgf_fixtures`. The tests check that every fixture opens or fails as it should, that names in every encoding read correctly, and that saving a saved file gives the same bytes.

## Board screenshots

`src/board/screenshots.test.ts` draws empty 9×9, 13×13 and 19×19 boards and a game position with
Skia (`@napi-rs/canvas`, no browser) and compares each with its PNG in `src/board/__screenshots__/`.
A test fails when more than 0.1% of the pixels differ. After an intended change to the board's
drawing, write new baselines and look at each before committing:

```bash
UPDATE_SCREENSHOTS=1 pnpm test src/board/screenshots
```

Skia draws a little differently from WebKit and WebView2, so these guard against regressions in
the drawing code, not against the WebView; the exit check looks at the real app.
