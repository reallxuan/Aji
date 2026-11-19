# Development setup

Until the setup wizard of M5 exists, the KataGo files are named in a `settings.json` file. The
setting goes away once the wizard replaces it. Without it, Aji starts with no engine and reports
`notConfigured`.

## Where `settings.json` lives

It sits in the app config directory of `io.github.reallxuan.aji`:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/io.github.reallxuan.aji/settings.json` |
| Windows | `%APPDATA%\io.github.reallxuan.aji\settings.json` |
| Linux | `~/.config/io.github.reallxuan.aji/settings.json` |

Aji reads it once at startup. Unknown fields are ignored.

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
