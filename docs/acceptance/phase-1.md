# Phase 1 Acceptance

- Design: [M8 design](../superpowers/specs/2026-11-21-m8-acceptance-release-design.md), section 5.4
- Status: walked on 2026-11-21. **Phase 1 accepted on both machines**, on `v0.1.0-rc.1` (commit `dbf6bb7`), released as `v0.1.0`.

**The acceptance sentence (charter section 8):** on the Windows PC with the RTX 5070, going from downloading the installer to seeing analysis results takes no command line, no manual download and no config editing. The same holds on the development Mac.

A result is **pass**, **fail** with a note, or **not walked**. A step nobody performed is written down as not walked.

## Versions under test

| | PC | Mac |
|---|---|---|
| Aji tag and commit | `v0.1.0-rc.1`, `dbf6bb7` | `v0.1.0-rc.1`, `dbf6bb7` |
| KataGo version and backend | 1.18.2, CUDA 13.2 | Not reported (the wizard's default is 1.18.2 Metal) |
| Network | Not reported (the wizard preselects `kata1-tf3-b11c768-s12382M-d6533M`) | Not reported (same preselection) |
| OS | Not reported | Not reported |
| GPU and driver | RTX 5070; driver not reported | Apple M5 |
| Manifest copy in use (checked on the Mac, design 5.7) | — | Fetched, sequence 1795244252 (author's check of the downloaded `rc.1` app, 2026-11-21) |

## Setup of the walk

- Each machine gets a **new OS user account**. On the PC, give it a Chinese name (for example 测试), so every path Aji uses contains Chinese characters (roadmap review focus 1).
- The installer comes from the release-candidate page on GitHub, downloaded with **that account's browser**. Not a local build: only a downloaded installer shows the system prompts a user sees.
- The SGF files named below are in the repository on GitHub, under `crates/aji-core/tests/fixtures/sgf/`; download them in the same browser.

## Steps

| # | What to do | What passes | PC | Mac |
|---|---|---|---|---|
| 1 | **Install.** Download the installer, open it, start Aji. | One system prompt at most (SmartScreen on Windows; Gatekeeper and "Open Anyway" in System Settings on macOS), written down word for word. A second prompt for KataGo is a failure. | Pass¹ | Pass¹ |
| 2 | **First run.** Let the wizard detect the hardware. | It shows the GPU, driver, memory and OS, and recommends CUDA 13.2 on the PC and Metal on the Mac. Versions and networks are listed. On the PC, the NVIDIA licence step names each component with its size. Screenshot the detection rows. | Pass¹ | Pass¹ |
| 3 | **Install the engine.** Accept the defaults. | Downloads, checks and the test query finish with nothing to type or edit, and analysis starts. Note the minutes from the first click to analysis. Then press 测速 in settings and note the speed and thread count. | Pass¹ | Pass¹ |
| 4 | **Analysis.** Look at the empty board, then open an SGF: your own Fox record if you have one, and `crates/aji-core/tests/fixtures/sgf/gbk-no-ca.sgf`. | Candidates on the empty board. Player names read correctly. Discs, table, bar and graph follow navigation. | Pass¹ | Pass¹ |
| 5 | **The M7 items.** Hold → through 50 moves, and spin the wheel. Watch the graph fill. Hover a candidate and wheel through its line. Set the visit limit to 1,000, see the ring, and Continue to 2,000. Press Space, PageUp, PageDown, F and Z. Open the engine card from the indicator. Switch to the other theme. | No update for an earlier position shows on the current one. The graph fills at a normal pace. The line steps with the wheel. The ring appears at the limit and Continue searches on. Each key does what its hint says. The engine card opens (on the Mac, also while the indicator is disabled). Both themes read well. | Pass¹ | Pass¹ |
| 6 | **The M6 items.** Hold → through a full game while KataGo runs, with the wheel and the trackpad. Open `crates/aji-core/tests/fixtures/sgf/broken-occupied.sgf`. Drop an SGF from Finder or Explorer. Restart Aji and open the recent list, then move a recent file and look again. Save as, and open the result in another program. On the Mac, try ⌘N, ⌘O and ⇧⌘S. Check the display at 100%, 150% and 200% scaling, and move the window between screens of different scale (audit G11). | Analysis follows navigation. The illegal position shows its line. The drop opens the file. The recent list survives a restart and shows the moved file as missing. The other program opens the saved file. The shortcuts work. The board is sharp at every scale. | Pass¹ | Pass¹ |
| 7 | **The M5 items.** On a fresh install, choose 暂不设置 at the first step, then launch again. Quit during the network download and start again. In settings: change language and theme, set a visit limit, restart and stop the engine, set up again, and delete unused files. Use an external screen of another scale. | The wizard returns at the next launch. The download resumes. Each setting takes effect at once, and the limit stops and resumes analysis. Restart, stop and set up again work. Unused files are deleted. The window looks right on the other screen. | Pass¹ | Pass¹ |
| 8 | **Soak (PC only; the Mac did this in M5).** Analyse one position for 30 minutes with no visit limit. | KataGo's memory in Task Manager at 0, 10, 20 and 30 minutes does not keep growing. Write the four values down. | Pass¹ | — (done in M5) |
| 9 | **Quit.** Quit Aji. | No KataGo process is left running. | Pass¹ | Pass¹ |

## What the PC sends back

- A screenshot of the wizard's detection rows (step 2).
- The 测速 result for CUDA 13.2: visits per second and the thread count it picks (step 3).
- If anything fails: a screenshot of the failure panel with the stderr it shows.
- Optional: set up again with DirectML, press 测速, note the result, then switch back to CUDA 13.2.

## Distribution checks (design 5.8)

| Check | Result |
|---|---|
| About notices: no "(no licence file; …)" entry | |
| The Metal engine zip's `THIRD-PARTY-LICENSES.txt` holds the `katagocoreml` section, whose NOTICE covers coremltools | **Pass** (2026-11-21): `katago-v1.18.2-metal-macos-arm64.zip` from the `aji-manifest` release `katago-v1.18.2-metal` holds `LICENSE`, `THIRD-PARTY-LICENSES.txt` and `README.txt`; the `katagocoreml` section names Apple coremltools (Core ML proto definitions, MILBlob, ModelPackage) with Apple's copyright line and the full BSD-3-Clause text |
| The owner confirms the LXGW WenKai reading | **Pass** (owner, 2026-11-21): the licence's additional permission for WOFF/WOFF2 subsets used only for web font delivery, and never offered as installable desktop fonts, covers Aji's bundled subsets |

## Not covered by Phase 1

- **Linux:** CI builds the AppImage and runs the tests on Linux, but nobody has run it on a Linux machine. The Linux check and the WebKitGTK frame rate (R3) are in Phase 8.
- **The Metal build on macOS 13**, its oldest supported system: no machine to run it on.
- **A laptop whose integrated GPU is listed first** (roadmap review focus 3).
- **D1**, download speeds on a mainland network.
- **The full R4 comparison** of CUDA 13.2, CUDA 12.8, DirectML and OpenCL on the RTX 5070. Only the default's speed is measured.

## Results

¹ From the owner's summary report on 2026-11-21: "5070 cuda 运行，验收通过", and the Mac passed too. The owner sent no per-step notes, so the table records each step as passed on that summary. What the report did not include:

- the system prompts word for word (step 1);
- the detection-row screenshot, the time to first analysis and the 测速 result (steps 2 and 3);
- KataGo's memory during the PC soak (step 8).

**PC:** CUDA 13.2, the recommended default for the RTX 5070, installed from the wizard and ran. This is the first time Aji ran on the PC. The NVIDIA defaults now rest on a working install, though no backend speeds were measured. The full R4 comparison is in the backlog.

**Mac:** passed from a new account on the downloaded `rc.1` installer. The author's own check of the same download is in the versions table above.

**Found during the walk:** the owner suggested that the candidate discs show the win rate of the side to move, rather than the black/white perspective chosen in the graph legend. This is a change of behaviour, not a failure, so it goes in after `v0.1.0` (owner, 2026-11-21) and is the first item in `docs/backlog/phase-1-deferred.md`.
