# M8 Acceptance and v0.1.0 Design

- Date: 2026-11-21
- Status: Approved by the owner on 2026-11-21
- Roadmap item: M8 in [the Phase 1 roadmap](../plans/2026-11-19-phase-1-roadmap.md)
- Builds on: [project charter](2026-11-19-aji-project-charter-design.md) sections 6.3 and 8; roadmap sections 1, 5 (M5 to M8 exits), 6 and 7; the Status blocks of the M3 to M7 plans
- Markers: **[Decided]** was decided by the owner. **[Proposed]** is the author's call and can be overturned. **[To verify]** is checked during the work. **[Owner]** is still open for the owner.

## 1. Intent

M1 to M7 built the whole path from a clean machine to analysis on the board, but almost all of it was proved on one Mac with local builds and in CI. The Windows PC with the RTX 5070, which the charter names as the acceptance machine, has never run Aji, and the NVIDIA defaults still rest on desk research. M8 closes Phase 1: it proves the acceptance sentence on both machines with the real installers, records what the app measures on the PC, and tags `v0.1.0`.

**v0.1.0 is the owner's own checkpoint, not a public launch [Decided 2026-11-21].** M8 does what acceptance needs and what blocks it. Polish for other users (the app icon O8, signing, Linux packaging) stays in Phase 8. Any deferred review finding that cannot fail an acceptance step moves to a Phase 2 backlog document instead of being fixed now.

**The PC is part of M8 [Decided 2026-11-21].**

## 2. Goals, non-goals, anti-goals

**Goals**

- The acceptance sentence (charter 8) holds on the PC and on the Mac, each from a new OS user account, starting from an installer downloaded with a browser: no command line, no manual download, no config editing. The results and every system prompt seen are recorded in `docs/acceptance/phase-1.md`.
- The NVIDIA default (CUDA 13.2) is proved to install and run on the RTX 5070, and its speed from the app's own benchmark is written back into charter 6.3.
- The open native-window exit checks from M5, M6 and M7 are walked once, as part of the same checklist, on the installed app.
- A tag builds the three installers and publishes them as a GitHub release.
- The README says what Phase 1 delivers.
- Every deferred finding and open item from M1 to M7 is either fixed in M8 or written down in the repository for Phase 2, so nothing lives only in the agent's notes.

**Non-goals**

- The app icon (O8), code signing and notarisation, Linux GPU verification: Phase 8.
- Fixing review minors that cannot fail an acceptance step (section 6).
- New features of any kind.
- The mainland mirror decision (D1) and the Metal build on macOS 13: recorded as open, not tested.

**Anti-goals** (these would make M8 a failure even if every box is ticked)

- Accepting a build that is not what the user downloads. A locally built app has no quarantine flag, so it never shows Gatekeeper or proves the charter's **[To verify]** that downloaded KataGo is not blocked a second time.
- Recording a pass for a step nobody performed. A step that was not walked is written down as not walked.

## 3. Owner decisions (2026-11-21)

1. v0.1.0 is the owner's checkpoint.
2. The PC is in M8.
3. Ordering: first **two tracks** (approach A below), then the owner dropped the measuring visit: no scripts on the PC; the owner opens the app and tests it there. That turns M8 into approach C with the author's preparation done first.
4. Linux is not tested in M8 (5.6).
5. The release candidates and `v0.1.0` are **public** GitHub releases. So the About notices are fixed, and the WenKai reading and the coremltools licence are settled, before `rc.1` (section 6).
6. The signed manifest is **published in M8, before the walk** (5.7).

## 4. Approaches considered

The owner's time at the PC is the long pole. The approaches differ in how many visits it needs and how they line up with the author's work.

- **A. Two tracks, PC measurements first.** The owner runs the M3 capture and benchmark scripts on the PC first (CUDA 13.2, CUDA 12.8, DirectML and OpenCL against three networks, about 4 GB of downloads). Meanwhile the author prepares acceptance. The NVIDIA default is then set from the numbers, and the owner walks the checklist. Two PC visits; the walk happens on measured defaults. Chosen first, then dropped by the owner as too much script work for a checkpoint.
- **B. PC data first, then everything.** The same steps in strict order. Wastes the waiting time.
- **C. One PC visit, in the app [Decided].** The author prepares everything first (fixes, checklist, release workflow). The owner then installs the release candidate on the PC and walks the checklist in the app. The app's own detection rows and its 测速 button replace the scripts. The default stays CUDA 13.2, the desk-research pick, unless the walk shows it failing; then a fix round and a second walk.

## 5. Design

### 5.1 The PC: one visit, in the app [Decided 2026-11-21]

No scripts. The M3 scripts (`scripts/capture-hardware-windows.ps1`, `scripts/benchmark-windows.ps1`) stay in the repository for Phase 2 or later, unused in M8. What the owner sends back from the walk instead:

- **Detection:** a screenshot of the wizard's four detection rows (GPU, driver, memory, OS), and the backend it recommends. This replaces the hardware capture.
- **Speed:** after the engine is installed, press 测速 in settings and note the visits per second and the thread count it picks for CUDA 13.2 with the preselected network.
- **Optional comparison:** "重新设置引擎" with DirectML, 测速 again, then back to CUDA 13.2. Only if the owner has the time.
- **On a failure:** a screenshot of the failure panel and the stderr it shows.

### 5.2 What the PC results change

- **CUDA 13.2 installs and runs:** the default stands. Its 测速 number (and DirectML's, if measured) goes into charter 6.3 in place of the "provisional until R4" bullet, marked as measured by the app, not by the full R4 matrix. Roadmap section 7 records R4 as answered for the default only; the full backend comparison goes to the backlog.
- **DirectML was measured and came within about 10% of CUDA [Owner, with the numbers]:** DirectML needs no NVIDIA runtime download (about 1.5 to 2 GB) and no licence step, so the owner may want it as the default. Changing the default is a fix round. It changes only the row the PC falls in (driver 580 or newer, compute capability 7.5 or newer); the other NVIDIA rows and the fallback order stay as they are, since there is no measurement for them **[Proposed]**.
- **CUDA fails:** a fix round. The stderr becomes a test for the failure classifier (and checks the `gpuDriverTooOld` pattern if that is the cause), the fix lands, a new release candidate is tagged, and the PC install path is walked again.
- The M3 test `pc_capture_gives_the_rtx5070` is not written; it goes to the backlog with the capture script.

### 5.3 The author's work before the walk

1. **Fixes that block acceptance.** The short list in section 6, including the distribution checks (5.8).
2. **The acceptance checklist**, `docs/acceptance/phase-1.md` (5.4).
3. **The release workflow** (5.5).
4. **The Phase 2 backlog**, `docs/backlog/phase-1-deferred.md`: every deferred finding and open item from M1 to M7 that M8 does not fix, grouped by area, each with the milestone it came from and one line on why it waits. The Phase 2 plan starts from this file.
5. **The signed manifest** (5.7).
6. **README**, written with the record after the walk (section 8, step 9), so it states only what was checked: the status line becomes "Phase 1 (v0.1.0): engine setup, opening game records and live analysis on the board", and one short paragraph says what works and on which platforms, linking `docs/acceptance/phase-1.md`.

### 5.4 The acceptance checklist

One document with a column per machine (PC, Mac) and a result per step: pass, fail with a note, or not walked. It is written before the walk and filled in from the owner's report.

**Setup of the walk [Proposed]:**

- Each machine gets a new OS user account. On the PC, give the account a Chinese name (for example 测试), so every path Aji uses contains Chinese characters (roadmap review focus 1). On the Mac, a plain new account is enough, since CI already runs the fake KataGo from a CJK folder.
- The installer comes from the release-candidate page (5.5), downloaded with the browser of that account. This is what the anti-goal asks for. It differs from the earlier milestones, where the owner tested local builds; fix rounds inside M8 can still use local builds, but the recorded walk uses the CI installer.

**Steps** (the acceptance path first, then the folded-in exit checks):

1. *Install.* Download, open, and record each system prompt verbatim: SmartScreen on Windows; on macOS, Gatekeeper and "Open Anyway" in System Settings. The charter allows that one prompt; a second prompt for KataGo is a failure.
2. *First run.* The wizard detects the hardware and shows the recommended backend (on the PC, CUDA 13.2; screenshot the detection rows, 5.1); version and network lists; on the PC, the NVIDIA licence step names each component with its size.
3. *Install the engine.* Downloads, verification and the smoke test finish with nothing to type or edit. Record the time from the first click to analysis. Then press 测速 and note the result (5.1).
4. *Analysis.* The empty board shows candidates. Open an SGF (the owner's own Fox record, if there is one, plus a GBK fixture): names read correctly; discs, table, bar and graph follow navigation.
5. *The M7 exit items* (design 9, items 1 to 7): hold → through 50 moves and spin the wheel; the graph fills at a normal pace; hover a candidate and wheel through its line; set the limit to 1,000, see the ring, Continue to 2,000; Space, PageUp and PageDown, F and Z, and the engine card (including whether it opens from the indicator while it is disabled in WKWebView); both themes.
6. *The M6 exit items:* hold → through a full game while KataGo runs, with the wheel and the trackpad; analysis follows navigation, and the illegal-position fixture shows its line; a Finder or Explorer drop; the recent list after a restart, and a moved file shown as missing; save-as and open the result in another program; the macOS menu shortcuts ⌘N, ⌘O and ⇧⌘S; high-DPI.
7. *The M5 exit items:* "暂不设置" at the first step and the next launch; quitting during the network download and resuming it; the settings round trip (language and theme live, the visit limit stopping and resuming analysis, restart, stop, set up again, delete unused files); an external screen of another scale.
8. *Soak (PC only; the Mac was done in M5).* One position analysed for 30 minutes with no visit limit; KataGo's memory at 0, 10, 20 and 30 minutes from Task Manager.
9. *Quit.* Quitting leaves no KataGo process.

The document also records the versions under test (Aji, KataGo, network, OS, GPU driver) and, for the record, what Phase 1 does not cover: Linux (5.6), the Metal build on macOS 13, a laptop whose integrated GPU is listed first (roadmap review focus 3), and D1.

### 5.5 The release workflow

The `bundle` job runs today only for `main` pushes and manual runs, and its artifacts expire after 14 days, so nothing reaches a release.

- `ci.yml`: `bundle` also runs for tags matching `v*`. A new `release` job after `bundle`, only on tags, with `permissions: contents: write`, downloads the three artifacts and runs `gh release create` with:
  - the files the user downloads, and only those: `*-setup.exe`, `*.dmg`, `*.AppImage` (the upload glob also carries helper files, M1 minor 11), plus `SHA256SUMS.txt`;
  - `--prerelease` for tags with a suffix (`v0.1.0-rc.1`), a normal release for `v0.1.0`;
  - release notes from a short template: the unsigned-installer prompts and how to get past them, and a link to `docs/acceptance/phase-1.md`.
- The workflow fails if the tag's version (without the suffix) does not match `package.json`.
- The workflow gets `permissions: contents: read` at the top, and only `release` raises it (M1 minor 7, folded in because this change touches the same file).

**Flow [Proposed]:** when the author's work is done and merged into `main`, the owner tags `v0.1.0-rc.1`. The release candidate it publishes is what both walks install. A failed step means a fix, then `rc.2`. When the walks pass:

- The owner tags `v0.1.0` on **the same commit as the accepted release candidate**. The `release` job sees that a release candidate of that commit exists and copies its assets and checksums instead of using the fresh build, so `v0.1.0` carries the exact files that were walked (anti-goal 1). A `v*` tag with no suffix and no release candidate of its commit fails the job.
- The record (`phase-1.md` filled in, the roadmap's M8 status, the charter's R4 bullet, the README) lands on `main` after the tag through a docs branch. The release notes link to `docs/acceptance/phase-1.md` on `main`, so the tag does not need the record in its tree.

The app reports 0.1.0 in every candidate; the suffix is only on the tag.

The repository is public, so a pre-release is a public download. The owner chose public releases (decision 5).

### 5.6 Linux: skipped [Decided 2026-11-21]

The roadmap's M8 asked for the AppImage to install on Ubuntu 22.04, open a game, analyse on CPU or OpenCL, and have its board frame rate measured under WebKitGTK (R3). There is no Linux machine, and the owner skipped the Linux check. CI keeps building the AppImage and running the Rust tests on Linux, as it does today; nothing is added for Linux in M8. `docs/acceptance/phase-1.md` records Linux as not tested, and the roadmap moves the Linux check and R3 to Phase 8, which already holds Linux packaging.

### 5.7 The signed manifest: published before the walk [Decided 2026-11-21]

The app fetches `https://reallxuan.github.io/aji-manifest/v1/manifest.json`, which is still a 404: M3's publishing steps never ran. The local `aji-manifest` checkout is two commits ahead of its remote (`1773945`, job-separated signing; `b6f32d8`, a CI check against the keys Aji trusts). Before `rc.1`, each with the owner's go-ahead:

1. Push `aji-manifest` `main`.
2. Run `manifest.yml`, and check that GitHub Pages serves `v1/manifest.json` and its signature.
3. Check that the manifest it serves verifies against Aji's `TRUSTED_KEYS` and carries a sequence at least as high as the bundled copy, so the app takes it.
4. M3's remaining checks on the Mac: the setup report says the fetched copy is used; one byte changed in the cached copy makes the app fall back to the bundled copy.

The walk then runs on the fetched copy on fresh accounts. The tester there cannot read the app's log, so which copy is used is checked on the Mac by the author, with `aji-setup-report --fetch` and the installed app started from a terminal.

### 5.8 Distribution checks for public releases [Decided 2026-11-21]

- **About notices.** The notices generator (`scripts/third-party-notices.mjs`) falls back to the standard SPDX text when a crate packages no licence file (section 6). The staleness test keeps passing, and no notice reads "(no licence file; …)".
- **LXGW WenKai.** The font's licence keeps its Reserved Font Names but adds a permission for subsets converted to WOFF or WOFF2 for web font delivery that are not offered as installable desktop fonts. Aji's subset is WOFF2 inside the app and is never installed as a system font, so the author reads it as covered. **[Owner]** confirms that reading.
- **coremltools and the Metal zip.** The check in section 6.

## 6. Earlier findings: what M8 fixes

The rule: a finding is fixed in M8 only if it can fail an acceptance step or would mislead the record. Everything else goes to `docs/backlog/phase-1-deferred.md`.

| Item | From | M8 | Why |
|---|---|---|---|
| PC hardware capture fixture, null `displayVersion` | M3 open | Backlog | The owner tests in the app, without the capture script (5.1) |
| PC benchmark (R4), NVIDIA defaults | M3, M4 open | **Partly**: the default's 测速 number (5.2); the full matrix to the backlog | The default must work on the acceptance machine |
| `gpuDriverTooOld` pattern | M5 open | Check if CUDA fails on the PC; else backlog | Only an old driver shows it |
| Short GBK records read as EUC-KR | M6 minor 1 | **Fix**: a chardetng `cn` hint when the file carries `AP[foxwq]`, and no hint otherwise. A probe on 380 name pairs per case ruled out the two fixes first named here and any hint from `RU`: a `cn` hint for every file, or "prefer GBK when both decode", misreads every Korean record; `cn` from `RU[Chinese]` misreads every Big5 record; `jp` or `kr` from `RU` misreads most GBK records with those rules. With `AP[foxwq]` the Fox pairs read 380 of 380 as GBK | Step 4 opens Chinese records; wrong names would fail it |
| The catching-up header stays stale across a restart or pause | M7 minor 1 | **Fix**: show it only while analysing | Step 7 restarts and pauses; a stale "800 / 8,350" is a visible fault |
| Disabled HoverCard trigger in WKWebView | M7 minor 3 | Check in step 5; fix only if it fails | Unknown until walked |
| CI `permissions`, the broad upload glob | M1 minors 7, 11 | **Fix** in the release workflow (5.5) | Same file; the release must carry only installers |
| About notices: "(no licence file; MIT)" for about 40 crates | M5 open | **Fix**: when a crate packages no licence file, print the standard text of its SPDX licence (MIT, BSD, Apache-2.0 and the rest the allow-list permits) with the crate's authors as the copyright line | The releases are public (decision 5); MIT and BSD ask for the notice text |
| The LXGW WenKai Reserved Font Name | M5 open | **Owner confirms** the reading in 5.8 | Same |
| coremltools licence for the Metal build | M3, for M8 | **Check** that the Metal zip in `aji-manifest` carries the licences of what it contains; fix the build script if not | Same; that release is already public |
| Metal on macOS 13; the "Failed to import MPS module" line | M3, for M8 | Record as open | No macOS 13 machine; no effect seen on the M5 |
| Next Metal build flags | M3, for M8 | Backlog | No Metal rebuild in M8 |
| Metal thread counts | M4 open | Backlog | Settings' "测速" measures them per machine |
| D1 mainland download speeds | M4 open | Record as open | The owner's decision; Phase 1 does not depend on it |
| First CI run on all three OSes | M4 open | **Closed** | The M6 and M7 merges into `main` (runs 44793999767, 44869455892) passed on all three, installers included |
| M5 native-window items 2–6 and 8 (item 7, the soak, was done on the Mac in M5), M6 and M7 native-window items | M5–M7 open | **Walked** in the checklist (5.4, steps 5–8) | They are acceptance steps |
| `push` plus `pull_request` run pull-request branches twice | M1 minor 7 | Backlog | Costs CI minutes only |
| Every other minor from M1 to M7 | M1–M7 reviews | Backlog | Cannot fail an acceptance step |

A fault the walk finds is fixed in M8 if it fails a step, and goes to the backlog otherwise; the owner can overrule either way.

## 7. Testing

- Each fix in section 6 gets a test that fails first, as in earlier milestones.
- A PC failure's stderr (5.2) becomes a classifier test.
- The release workflow is tried without a tag: a manual run on the branch with a `dry-run` input makes the `release` job list the files, the checksums and the notes instead of publishing **[Proposed]**. The first real use is `v0.1.0-rc.1`. The copy-from-release-candidate path for `v0.1.0` gets its own dry run against `rc.1` before the owner tags.
- The checks before every commit are those of M7.

## 8. Order of work

1. Branch `feat/m8-acceptance` from `main` (`ccb3108`). This design is its first commit.
2. The author's work (5.3), in any order: the section 6 fixes and the distribution checks, the checklist, the release workflow, the backlog file.
3. The signed manifest is published (5.7), before `rc.1`.
4. The branch is pushed (with the owner's go-ahead) so the three-OS CI run passes, including a dry run of the release job.
5. Merge into `main` (the owner says which target), and the owner tags `v0.1.0-rc.1`.
6. The owner walks the checklist on the Mac and the PC (one visit) and reports. The author fills in `docs/acceptance/phase-1.md` and makes the 5.2 changes.
7. Fix rounds if a step failed: a fix branch, a merge, `rc.2`, and a walk of the failed steps again.
8. The owner tags `v0.1.0` on the accepted release candidate's commit (5.5).
9. A docs branch records the results: `phase-1.md`, the roadmap's M8 status, the charter's R4 bullet and section 8, the README. It merges into `main` after the tag.

## 9. Open for the owner

1. **The DirectML choice**, only if DirectML was measured and is close (5.2): decided with the numbers in hand.
2. **The WenKai reading** (5.8).
3. **Each push and tag:** the branch, the two `aji-manifest` pushes and the workflow run (5.7), the merge target, and the `rc` and `v0.1.0` tags.

## 10. Documents this changes

- New: `docs/acceptance/phase-1.md`, `docs/backlog/phase-1-deferred.md`.
- Charter 6.3 (the default's measured speed) and section 8 (Phase 1 done).
- Roadmap: M8 status and exit (the Linux check moves to Phase 8), section 7 (R3 to Phase 8, R4 done), O8 left open for Phase 8.
- README status.
- `.github/workflows/ci.yml`.

## 11. Left to the builder

- The exact format of `phase-1.md` and the release-notes template.
- The backlog file's grouping. Its sources are the M1 to M7 plans' Status blocks, the S5 audit's open items (G2 to G12, X1), any SDD ledgers left in `.superpowers/sdd/`, and the author's notes from each final review, which hold the numbered minor lists the plans only count. Where a plan's count is higher than the notes' list (M5 says sixteen; the notes list thirteen), the builder looks for the missing items in those sources and otherwise records the gap **[Proposed]**.
