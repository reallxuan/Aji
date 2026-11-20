# Development setup

Until the setup wizard of M5 exists, there are two ways to give Aji an engine:

- name your own KataGo files in `settings.json` (`devEngine`, below);
- let Aji install one with the `AJI_DEV_INSTALL` trigger, the same pipeline the wizard will use.

Without either, Aji starts with no engine and reports `notConfigured`.

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

## Installing an engine: `AJI_DEV_INSTALL`

Set `AJI_DEV_INSTALL` before starting Aji, to `recommended` or to a backend name:

```sh
AJI_DEV_INSTALL=recommended pnpm tauri dev
```

```sh
AJI_DEV_INSTALL=recommended "/Applications/Aji.app/Contents/MacOS/aji"
```

- `recommended` installs the default backend of the setup recommendation. A backend name (`cuda`,
  `directml`, `opencl`, `metal`, `eigenavx2`, `eigen` and so on) must be one the recommendation lists
  for this machine; `aji-setup-report` (below) shows them.
- The engine is that backend's newest version, and the network the preselected one: the highest Elo
  that engine can load.
- It acts only when no engine is configured: no `devEngine` and no active set. Otherwise it logs
  `aji: AJI_DEV_INSTALL ignored: an engine is already set up`.
- It accepts every licence the engine needs (for CUDA, NVIDIA's CUDA Toolkit EULA and cuDNN licence)
  for that job only. Nothing is written to `settings.json`. Set it only if you accept those licences.
- Release builds read it too, so a packaged app can be checked. A Windows release build has no
  console, so its log is not visible there.

The job logs each step as it changes, not each byte:

```text
aji: dev install katago-v1.18.2-metal-macos-arm64 with kata1-tf3-b11c768-s12382M-d6533M
aji: install engine: running (0 of 3934477)
aji: install engine: done
aji: install network: running (0 of 262041254)
aji: install network: done
aji: install benchmark: running (0 of 3)
aji: install benchmark: done
aji: install testQuery: running (0 of 1)
aji: install testQuery: done
aji: install installed
```

On success the engine switches to the new set at once, and it starts on the next launch too. A
failure ends with its code and, when another backend might work, the offer:

```text
aji: install failed: outOfMemory; offer: directml (katago-v1.18.1-onnx1.24.4-directml-windows-x64, 23584379 bytes)
```

Aji never installs the offer by itself. To take it, start again with that backend's name
(`AJI_DEV_INSTALL=directml`).

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
while a download runs applies from its next attempt. The setup wizard sets it with the
`setupSetDownloadSource` request.

The wizard also records accepted licences in `acceptedLicences`: the SHA-256 of each licence text
and the time it was accepted. The `AJI_DEV_INSTALL` trigger does not.

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
