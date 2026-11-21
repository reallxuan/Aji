# Phase 1 Deferred Items

Everything the M1 to M7 reviews and exit checks deferred, and M8 did not fix, in one place for Phase 2 planning. M8 fixes and checks are in [the M8 design](../superpowers/specs/2026-11-21-m8-acceptance-release-design.md), section 6.

Each item names where it came from: "M5 minor 3" is the third minor finding of M5's final review. These lists come from the author's notes of each final review, the Status blocks of the M1 to M7 plans, the M4 SDD ledger and the S5 audit. Items marked **(re-check)** were assigned to a milestone whose plan does not say whether it shipped; check the code before planning them.

Two gaps in the sources: M5's plan counts sixteen minors but the notes list thirteen, and the M2 SDD ledger is gone, so M2's N1 to N4 below come from the notes alone.

## Engine and engine manager

- **M2 N1 (re-check):** no deadline after killing a KataGo that does not die. Assigned to M4.
- **M2 N2:** the watchdog's unbiased `select!` can pick the timer over a queued reply. Fix only if Windows CI flakes.
- **M2 N3 (re-check):** the 100 ms throttle equals the report interval, so updates may drop to 5–10 per second. Assigned to M4.
- **M2 N4:** subscribing before reading the status relies on IPC ordering. This matters for Phase 3's WebSocket transport.
- **M3, for M4 (re-check):**
  - `refresh` discards its `FetchError`;
  - `Source` serialises in PascalCase;
  - a concurrent `refresh` can swap a lower sequence over a higher one, and the cache uses fixed `.tmp` names;
  - read the CUDA thresholds from `minDriver` and `minComputeCapability` (charter 6.3 says done in M5);
  - `#[ts(skip)]` on the `Unknown` variants;
  - the System32 `nvidia-smi` retry only on NotFound;
  - log probe errors;
  - on Linux, find NVIDIA by PCI display class.
- **M3, missing tests (re-check):**
  - a legacy-signature rejection;
  - the 4 MiB streaming guard with no or a wrong `Content-Length`;
  - the 580.00/579.99, 572.61/572.60 and 7.5/7.4 boundaries;
  - `invalid_entries` asserting the error variant;
  - unknown runtime and network entries dropped;
  - a non-flaky `status_carries_the_latest_analysis`.
- **M4 minor 12:** the test-only fake KataGo is a normal `[[bin]]` of `aji-manager`, built by every release build. It is not bundled into the app. Consider `required-features`.
- **M4 minor 13:** if the download HTTP client cannot be built, the app does not start (`src-tauri/src/lib.rs`, `start_installer`). Degrading to an installer whose jobs fail would be kinder.
- **M5 minor 10:** the declined-licence offer uses `recommendation.backends`, while the server's offer uses default plus fallbacks. Neither skips a backend that needs the same licence.
- **M5 minor 11:** `remove_unused` holds the jobs lock through deletion and can race `import_network`'s unlocked copy.
- **M5 minor 12:** a write failure during download is `downloadFailed`, not `diskError`.
- **M7 minor 2:** `continue_analysis` does not resubmit while a query is in flight.
- **M7 minor 11, test gaps:**
  - a burst test (30 positions in 300 ms send at most 4 queries);
  - the service's cache-to-trend wiring;
  - superko rejection with real KataGo.
- **M4 open:** the Metal thread counts. Speed fell as threads rose (6: 45.8 visits/s, 10: 36.8, 16: 26.0). Settings' 测速 measures them per machine.
- **R4 in full:** CUDA 13.2, CUDA 12.8, DirectML and OpenCL on the RTX 5070 with the same networks. M8 measured only the default. `scripts/benchmark-windows.ps1` exists, but it takes the newest version with a CUDA engine (1.18.2), which has no DirectML or OpenCL build. Fix its version choice before using it.
- **The PC hardware capture:** `scripts/capture-hardware-windows.ps1` and the test `pc_capture_gives_the_rtx5070`, including a null `displayVersion`.
- **The `gpuDriverTooOld` pattern** stays [To verify] unless an M8 failure settled it.

## Game records and board

- **M6 minor 2:** the komiUnreadable detail says "default rules", but with `RU[Japanese]KM[abc]` the Japanese/Korean preset is used.
- **M6 minor 3:** the encodingGuessed title says the file "names no encoding", but it also shows when a declared `CA` failed.
- **M6 minor 4:** choosing Custom without editing marks the rules changed, and save rewrites `RU`/`KM` (Fox `KM[375]` becomes `KM[7.5]`). Compare effective komi and scoring instead.
- **M6 minor 5:** missing recent files are disabled in the macOS menu, so they cannot be clicked to remove them.
- **M6 minor 6:** a drop opens `paths[0]`, not the first `.sgf`.
- **M6 minor 9:** a collection whose first game is header-only cannot be saved.
- **M6 minor 10:** `has_illegal` stores a board for every node, so a pathological 20 MB file could use gigabytes.
- **Short GBK records without Fox's `AP`** still read as EUC-KR about one time in twenty-five (M8 Task 1 hints only from `AP[foxwq]`).
- **M7 minor 4:** the trend graph's click and drag navigate by move number, not by node.
- **M7 minor 5:** PageDown on a trailing comment node, and PageUp/PageDown bursts while held.
- **M7 minor 6:** `next_move` skips nodes that only set the player to move (`PL`).

## Analysis interface

- **M7 minor 7:** the wheel over a table row scrolls the table instead of stepping the hovered line.
- **M7 minor 8:** the trend can race between a fetch or push and live updates.
- **M7 minor 9:** Z can stick on macOS while Cmd is held (no keyup).
- **M7 minor 10:** font loading awaits only 12px Inter 400 before the discs draw.
- **M7 minor 12:**
  - a cached update keeps its stored `previous_visits`;
  - test placement in `update.rs`;
  - the bar's `toFixed` is not locale-aware;
  - "黑领先 0.0 目" at an even lead.
- **M7 minor 3:** a disabled HoverCard trigger in WKWebView may not open the engine card. M8 checks it in the walk; it stays here only if the walk found it working.

## Wizard and settings

- **M5 minor 1:** a failed settings save snaps the control back with no message.
- **M5 minor 2:** a relative `devEngine` path makes the whole settings read fall back to defaults (developer-only).
- **M5 minor 3:** `settingsSet` replaces the whole object and does not validate (visit limit 0, two equal disc lines from a non-UI client).
- **M5 minor 4:** the focus 4 test has no write half for an unreadable `downloadSource`.
- **M5 minor 5:** the first frame uses the system language and theme before settings arrive, and the analysis panel flashes before the first `engineStatus`.
- **M5 minor 7:** Restart and Stop disable on `starting` only, and Stop stays disabled for an engine hanging at start.
- **M5 minor 8:**
  - a job resumed after a reload loses `rerun` (the left link reads 暂不设置, not 取消);
  - a failed job reappears after every reload.
- **M5 minor 9:** the licence step has Back but no 暂不设置.
- **M5 minor 13:** `AJI_DATA_ROOT` also works in release builds.

## Interface foundation (M1)

- **M1 minor 1:** the i18n parity test misses formatted placeholders, CJK punctuation in English values, and plural suffixes.
- **M1 minor 2:** no test ties each `ErrorCode` or `OsKind` value to a locale key; `t()` is untyped. (M6 added `codes.test.ts` for error codes; re-check `OsKind`.)
- **M1 minor 3:** no UI test drives a plain-string IPC rejection end to end.
- **M1 minor 6:** `ProtocolError.message` is never logged.
- **M1 minor 8:** `deny.toml` says its allow-list mirrors CLAUDE.md, but it is stricter (no LGPL, GPL-3.0 or OFL).

## CI and release

- **M1 minor 7, second half:** `push` plus `pull_request` run pull-request branches twice.
- **M1 minor 11:** the CI artifact upload glob is broad (the DMG folder holds helper files; the Linux artifact was 172 MB). The release itself picks only the installers (M8).
- **M3, manifest generator:**
  - check that scraped network links start with the katagotraining models prefix;
  - read GitHub's `prerelease` and `draft` flags.
- **M3, CI:** verify the manifest against Aji's `TRUSTED_KEYS`. Done in `aji-manifest` `b6f32d8`; re-check that it runs.
- **M3, next Metal build:** `CMAKE_IGNORE_PREFIX_PATH` for the dependencies, and dependency tags pinned to commits.

## Platforms (Phase 8)

- **Linux:** the AppImage on Ubuntu 22.04 (installs, opens a game, analyses on CPU or OpenCL), and the board frame rate under WebKitGTK (R3).
- **The Metal build on macOS 13**, and whether "Failed to import MPS module" with transformer networks means a slower path.
- **A laptop whose integrated GPU is listed first** (roadmap review focus 3; M4 sets no GPU device).
- **The app icon (O8)**, code signing and notarisation.

## Decisions still open

- **D1:** a mirror reachable from mainland China.
- **Audit X1:** a charter bullet that Aji does not integrate third-party cloud engine services (such as ikatago) or keep a quick-launch list of external programs.
