# Phase 1 Deferred Items

Everything the M1 to M7 reviews and exit checks deferred, and M8 did not fix, in one place for Phase 2 planning. M8 fixes and checks are in [the M8 design](../superpowers/specs/2026-11-21-m8-acceptance-release-design.md), section 6.

Each item names where it came from: "M5 minor 3" is the third minor finding of M5's final review. These lists come from the author's notes of each final review, the Status blocks of the M1 to M7 plans, the M4 SDD ledger and the S5 audit. Items marked **(re-check)** were assigned to a milestone whose plan does not say whether it shipped; check the code before planning them.

Two gaps in the sources: M5's plan counts sixteen minors but the notes list thirteen, and the M2 SDD ledger is gone, so M2's N1 to N4 below come from the notes alone.

## First after v0.1.0

- ~~**Discs in the side to move's view (owner, 2026-11-21, during the walk):**~~ Fixed in Phase 2 M1 (design 5.10): the discs and the table show the side to move; the graph keeps its colour.
  Original note: the candidate discs on the board should show the win rate of the player to move, instead of the black/white perspective chosen in the graph legend (M7 design 13.1). Decide with the owner whether the table follows the discs, and keep the graph and the bar in a fixed colour, since a graph that switches sides every move would zigzag.

## Engine and engine manager

- **M2 N1 (re-check):** no deadline after killing a KataGo that does not die. Assigned to M4.
- **M2 N2:** the watchdog's unbiased `select!` can pick the timer over a queued reply. Fix only if Windows CI flakes.
- **M2 N3 (re-checked in Phase 2 M2, left as it is):** the 100 ms throttle equals the report interval, so updates may drop to 5–10 per second. That reads smoothly on the Mac and no test shows a problem. Assigned to M4 if the live numbers ever look choppy.
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
- ~~**M7 minor 2:** `continue_analysis` does not resubmit while a query is in flight.~~ Fixed in Phase 2 M2 (`continue_analysis_resubmits_while_a_query_is_in_flight`).
- ~~**M7 minor 11, test gaps:**~~ Closed in Phase 2 M2:
  - ~~a burst test (30 positions in 300 ms send at most 4 queries);~~ `a_burst_of_30_positions_in_300ms_sends_at_most_4_queries`;
  - ~~the service's cache-to-trend wiring;~~ `stored_results_reach_the_trend_without_a_refetch`;
  - ~~superko rejection with real KataGo.~~ KataGo 1.18.2 does **not** reject a positional-superko repeat under Tromp-Taylor rules: it analyses it (recorded, `real_katago_accepts_a_superko_repeat_as_recorded`). Phase 1's assumption that it rejects one was wrong, so no superko case reaches the rejection path.
- **M4 open:** the Metal thread counts. Speed fell as threads rose (6: 45.8 visits/s, 10: 36.8, 16: 26.0). Settings' 测速 measures them per machine.
- **R4 in full:** CUDA 13.2, CUDA 12.8, DirectML and OpenCL on the RTX 5070 with the same networks. M8 proved that the default (CUDA 13.2) installs and runs; no backend speeds were measured. `scripts/benchmark-windows.ps1` exists, but it takes the newest version with a CUDA engine (1.18.2), which has no DirectML or OpenCL build. Fix its version choice before using it.
- **The PC hardware capture:** `scripts/capture-hardware-windows.ps1` and the test `pc_capture_gives_the_rtx5070`, including a null `displayVersion`.
- **The `gpuDriverTooOld` pattern** stays [To verify]: the PC's driver was new enough, so no failure showed it.
- **M4 open, PC:** whether a missing DLL makes Windows show a SetErrorMode dialog. The walk passed, so it never came up.

## Game records and board

- **Short GBK records without Fox's `AP`** still read as EUC-KR about one time in twenty-five (M8 Task 1 hints only from `AP[foxwq]`).

## Analysis interface

- ~~**M7 minor 7:** the wheel over a table row scrolls the table instead of stepping the hovered line.~~ Fixed in Phase 2 M1.
- ~~**M7 minor 8:** the trend can race between a fetch or push and live updates.~~ Fixed in Phase 2 M2: trend pushes carry a revision and an older one is ignored.
- ~~**M7 minor 9:** Z can stick on macOS while Cmd is held (no keyup).~~ Fixed in Phase 2 M1.
- ~~**M7 minor 10:** font loading awaits only 12px Inter 400 before the discs draw.~~ Fixed in Phase 2 M1.
- **M7 minor 12:**
  - ~~a cached update keeps its stored `previous_visits`;~~ Fixed in Phase 2 M2: a cached update has none (`a_cached_update_has_no_previous_visits`);
  - test placement in `update.rs` (not touched in Phase 2 M2);
  - ~~the bar's `toFixed` is not locale-aware;~~ Fixed in Phase 2 M1.
  - ~~"黑领先 0.0 目" at an even lead.~~ Fixed in Phase 2 M1: it reads 均势 / Even.

## Wizard and settings

- ~~**M5 minor 1:** a failed settings save snaps the control back with no message.~~ Fixed in Phase 2 M1: 保存失败 shows beside the control.
- **M5 minor 2:** a relative `devEngine` path makes the whole settings read fall back to defaults (developer-only).
- **M5 minor 3:** `settingsSet` replaces the whole object and does not validate (visit limit 0, two equal disc lines from a non-UI client).
- **M5 minor 4:** the focus 4 test has no write half for an unreadable `downloadSource`.
- **M5 minor 5:** the first frame uses the system language and theme before settings arrive, and the analysis panel flashes before the first `engineStatus`. Partly fixed in Phase 2 M1: the panels wait for the device settings and the first game snapshot, so nothing flashes in the side; the header may still show the system language for a frame.
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
