# M3 Manifest, Hardware Detection and Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aji knows what machine it runs on and what to install there. A signed manifest lists every engine package, NVIDIA runtime and network. Aji detects the OS, CPU, memory and GPUs, and recommends a backend, versions and a network. A development command prints all of it on the Mac and the PC. The macOS engine is Aji's own Metal build of KataGo, built and hosted by `reallxuan/aji-manifest`.

**Architecture:**
- Two new crates join the workspace:
  - `aji-manager`, the engine manager of charter section 6.
    - It holds manifest schema v1, signature checking, the choice between the bundled, cached and fetched copies, hardware detection, and the recommendation.
    - The recommendation is a pure function of a `HardwareReport` and a `Manifest`.
    - Detection keeps parsing (pure, tested on fixtures captured from the real machines) apart from probing (OS calls, tested live on each CI OS).
  - `aji-manifest-tool` builds the manifest. It is a maintainer's tool, never bundled, and shares the schema types with `aji-manager`, so the two cannot drift apart.
- `reallxuan/aji-manifest` holds:
  - the Metal build script and its workflow, which publishes a release;
  - the curated runtime input;
  - the publish workflow, which generates the manifest, signs it with minisign and deploys it to GitHub Pages.
- `src-tauri` adds `setup.detect`, `setup.backends`, `setup.versions` and `setup.networks` to the `rpc` dispatcher. At startup it refreshes the manifest in the background, and never blocks a request on the network.
- M2's review items are folded in: `move_to_gtp` becomes total, the analysis cache is bounded, and the `engineStatus` reply carries the position and the latest analysis. The UI store also drops updates for any other position.

**Tech Stack:**
- Rust: tokio, serde, ts-rs, reqwest 0.13 with rustls on `ring`, minisign-verify, sysinfo, semver, `windows` (DXGI), and in the tool scraper and sha2.
- TypeScript: React 19, Zustand, Vitest. There is no new UI in M3; only the store and the protocol change.
- KataGo v1.18.2 built from source with the Metal backend (CMake, Ninja, Swift 6.4.2 from the Command Line Tools), plus static protobuf and abseil.
- minisign 0.11 (Ubuntu) in the publish workflow.

**Specs:**
- [Project charter](../specs/2026-11-19-aji-project-charter-design.md), sections 3, 6.1, 6.3 and 6.8.
- [Interface design](../specs/2026-11-19-aji-ui-design.md), section 7.
- [Phase 1 roadmap](2026-11-19-phase-1-roadmap.md), decisions O4 and O5, sections 3.1 to 3.3, M0 (S1 to S3, A1, A2), M3 and section 6 items 3 and 8.
- [R1: NVIDIA runtime](../../research/r1-nvidia-runtime.md), sections 6 and 7.
- [Phase 1 LizzieYzy menu check](../../audits/phase-1-lizzieyzy-menu.md): E14. Only G1 is approved, and it was done in M2; the other proposals stay open.

**Status:** Done on 2026-11-20, except the items under Outstanding.
- **Mac.** The exit check passed on the M5.
  - `aji-setup-report` reported Apple M5, `appleGpuCores` 10, `memoryBytes` 25769803776, 10 cores and OS "macOS 27.2". The default is `metal`, with versions `["1.18.2"]`. The 8 networks are in Elo order, with `kata1-tf3-b11c768-s12382M-d6533M` preselected. The bundled manifest has sequence 1795103730.
  - One deviation from Step 1: the report prints the source as `"Bundled"`, not `"bundled"`. It is logged for the final review.
- **Table tests.** `recommend_table`: 36 tests pass, and every charter 6.3 row has a test.
- **App.** `pnpm tauri build --bundles app` produced Aji.app (6.82 MiB). At startup it logged `aji: manifest Bundled sequence 1795103730`. The owner confirmed that analysis runs. The fetch from the Pages site fails silently until the manifest is published (Step 6).
- **Metal release (S2).** `reallxuan/aji-manifest` release `katago-v1.18.2-metal`: asset 3934477 bytes, SHA-256 `b307bc8c285e9cc9adff506519925dc2ed4453bf3bc8f52c47dd97104d1f26ea`, built by `katago-metal.yml` on a GitHub `macos-15` runner. On the M5, after a curl download, the binary has no quarantine attribute, links only `/usr/lib` and `/System/Library`, and has `minos 13.0`. `katago version` reports v1.18.2 on the Metal backend. The benchmark (b18c384nbt, 10 threads, 800 visits, final reading) gave 202.51 visits/s against Homebrew's 204.42, 0.9% slower.
- **Signing.** The owner's minisign key ABDFEC3DB730B0C2 is in `keys/aji-manifest.pub` (aji-manifest) and in `TRUSTED_KEYS` (Aji). The secret `MINISIGN_SECRET_KEY` is set in that repository.
- **Outstanding.**
  - Step 2, the PC from its capture: the owner's real capture has not arrived. Only a hand-written synthetic capture (RTX 5070, driver 591.44, capability 12.0) was run. It gave cuda (cuda13.2, versions 1.18.2 and 1.18.1) as the default, then directml and opencl. This does not stand for the real PC.
  - Task 12 Step 4, the PC benchmark results from `scripts/benchmark-windows.ps1` (S3, R4). They move to M4 if they arrive after M3 closes.
  - Step 6, after the owner merges into `main` and with the owner's OK: run `manifest.yml` once; check that `aji-setup-report --fetch` gives `source` fetched with a sequence above the bundled one; check that a one-byte change to the cache falls back to bundled; and read the `main` push's Windows CI run, the first Windows compile of Task 0's manifest embedding and of the DXGI code.
- TensorRT is out of Phase 1 (ruling R5).

## Owner decisions for M3 (2026-11-19)

| Item | Decision |
|---|---|
| Windows CI failure on `main` (run 44533163865) | Fixed in M3 (Task 0). It is checked by the `main` push after M3 merges. There are no CI runs of this branch. |
| O5, manifest signing | Signed in the manifest repository's CI. The owner makes a minisign key pair once and stores the secret key as an Actions secret of `reallxuan/aji-manifest`. Aji compiles in the public key and accepts a second one for rotation. |
| S2, Metal build | Part of M3. A1: the owner installed `cmake` 4.5.0 and `ninja` 1.13.2 on the Mac. A2: the agent created `reallxuan/aji-manifest` (public, AGPL-3.0, Pages from GitHub Actions) at the owner's request. |
| S3, benchmarks | The Mac half was measured during planning (Global Constraints, Metal speed). The PC half uses a script the owner runs when convenient (Task 12). PC values stay **[Proposed]** until then. |
| O4, network preselect | Preselect the top row: the highest-rated network on katagotraining.org that the chosen KataGo version can load. The same rule holds on every machine, with no GPU tiers and no local measurement (the owner: "you can easily get the elo from https://katagotraining.org/networks/"; "it doesn't make sense to run test on my local machine"). Today the top row is the transformer `kata1-tf3-b11c768-s12382M-d6533M`. |
| `deny.toml` target list | Left to the plan (the owner: "don't care about this"). Task 5 adds the three shipped targets (Global Constraints, Dependencies). |
| Execution | Subagent-driven, as in M2, with no git worktrees. |
| NVIDIA runtime checks (during execution) | Nothing NVIDIA is downloaded on the Mac, and no DLL is hashed on its own. Aji downloads each NVIDIA archive whole and checks NVIDIA's own SHA-256 from its redist JSON. The NVIDIA user downloads more on first install (the CUDA 13.2 set is 1.95 GB instead of about 0.84 GB); the owner accepted that. |
| Network digests (during execution) | The network's digest is the model server's ETag, which is its MD5. Nothing is downloaded to build the manifest. |
| TensorRT (ruling during execution) | Not in the Phase 1 manifest. Its 1.94 GB archive has no NVIDIA-published hash, and its ETag is an S3 multipart one (`"…-232"`), so a hash would need the download the owner ruled out. NVIDIA users get CUDA, DirectML and OpenCL. The owner can undo this. |

## Global Constraints

- **Everything from M1 and M2 still holds.** That covers language, interface text in both locales, dependency licences, Conventional Commits, the toolchain, the theme tokens and the protocol rules. See [M1](2026-11-19-phase-1-m1-foundation.md) and [M2](2026-11-19-phase-1-m2-analysis-skeleton.md), Global Constraints.
- **No git worktrees.** Never create a git worktree, in this repository or in `aji-manifest`, and do not let a skill create one. That includes subagent-driven development: every task works in `/Users/zepher/personal/Aji` itself (the owner's rule).
- **Branch.**
  - Work on `feat/m3-manifest`, created from `main` at `19a0810` (M2 merged).
  - `dev` is behind `main` and is not the target. The owner decides the merge at the finish.
  - Push only when the owner asks. The owner does not want CI runs of this branch, and every push starts one. So Windows-only code (DXGI, Task 0's manifest) is first compiled on Windows by the `main` push after the merge.
  - The `aji-manifest` repository is cloned to `/Users/zepher/personal/aji-manifest`. That is a separate clone, not a worktree. Every push to it waits for the owner's OK.
- **Crates.**
  - `crates/aji-manager` and `crates/aji-manifest-tool` join the workspace `members` with `version.workspace`, `edition.workspace` and `license.workspace`.
  - `aji-manager` depends on no workspace crate.
  - `aji-manifest-tool` (`publish = false`, binary `aji-manifest`) depends on `aji-manager`. Nothing depends on the tool.
  - `src-tauri` depends on `aji-manager`.
- **Protocol** (as in M2).
  - No file paths cross the boundary. Errors are `{ code, message }`. Types derive `ts_rs::TS` with `#[ts(export)]` into `src/transport/generated/`.
  - A `u64` that stays below 2^53, such as a byte count or a sequence number, carries `#[ts(type = "number")]`. ts-rs would otherwise generate `bigint`, which JSON never yields.
  - `OsKind` moves from `src-tauri/src/protocol.rs` to `aji-manager`, and `src-tauri` uses it from there. The generated `OsKind.ts` must stay byte-identical.
- **Manifest locations.**
  - Published: `https://reallxuan.github.io/aji-manifest/v1/manifest.json`, with the signature at the same URL plus `.minisig`.
  - Bundled: `crates/aji-manager/manifest/manifest.json`, compiled in with `include_bytes!`.
  - Cache: `<app_local_data_dir>/manifest/manifest.json` and `.minisig`.
  - Fetch limits: 10 s per URL, at most 4 MiB per body. The user agent is `Aji/<version>`; it carries no personal data.
- **Signing.**
  - The format is minisign, prehashed (the default of minisign 0.11). Aji verifies with `minisign-verify` 0.3 and `allow_legacy = false`.
  - The trusted public keys are a constant list in `aji-manager`. It stays empty until Task 11, so until then every fetched copy is rejected and the bundled one is used.
  - No key file, public or secret, is committed to the Aji repository. Tests generate their key pairs with the `minisign` crate (0.10, dev-dependency).
- **Dependencies.**
  - Every new crate passes `cargo deny check licenses`.
  - reqwest 0.13's `rustls` feature pulls in aws-lc-rs, whose `aws-lc-sys` carries the OpenSSL licence. That licence is not on the allow-list and is GPL-incompatible. So:
    - use `reqwest = { version = "0.13", default-features = false, features = ["rustls-no-provider", "http2", "charset", "system-proxy"] }`;
    - use `rustls = { version = "0.23", default-features = false, features = ["ring", "std", "tls12"] }`, with `rustls::crypto::ring::default_provider().install_default()` called once before the first client is built (an `Err` because it is already installed is ignored);
    - `cargo tree -i aws-lc-sys` and `cargo tree -i openssl-sys` must both report no match. reqwest 0.13.5 resolved rustls 0.23.46 in the planning dry run; there must be one `rustls` in the tree (`cargo tree -d -i rustls` prints nothing).
  - Two licence findings from a planning dry run of this exact set against `deny.toml`:
    - `zip`'s default features pull in bzip2 (licence `bzip2-1.0.6`), which is not on the allow-list. M3 no longer needs `zip`. M4's unpacker must use `zip = { version = "9", default-features = false, features = ["deflate"] }`, since KataGo's and NVIDIA's archives are deflate.
    - `rustls-platform-verifier` pulls in `webpki-root-certs` (CDLA-Permissive-2.0), but only for `wasm32` targets, which Aji never builds. cargo-deny fails anyway, because it checks every target.
      - So `deny.toml` `[graph]` gains `targets = ["x86_64-pc-windows-msvc", "aarch64-apple-darwin", "x86_64-unknown-linux-gnu"]`, the three shipped targets, with no new licence allowed. The owner left this to the plan. The mobile targets are added in Phase 7.
      - With both changes, the planned set and the current workspace pass `cargo deny check licenses`.
      - Task 5 makes the `deny.toml` change.
  - Expected additions:

    | Crate | Version | Licence | Where |
    |---|---|---|---|
    | `reqwest` | 0.13 | MIT OR Apache-2.0 | aji-manager, tool |
    | `rustls` | 0.23 (0.23.46 resolved; ring) | Apache-2.0 OR ISC OR MIT | aji-manager, tool |
    | `minisign-verify` | 0.3 | MIT | aji-manager |
    | `sysinfo` | 0.40 | MIT | aji-manager |
    | `semver` | 1 | MIT OR Apache-2.0 | aji-manager |
    | `windows` | 0.62 (`Win32_Graphics_Dxgi`, `Win32_Foundation`) | MIT OR Apache-2.0 | aji-manager, Windows only |
    | `scraper` | 0.29 | ISC | tool |
    | `sha2` | 0.11 | MIT OR Apache-2.0 | tool (licence text hashes) |
    | `minisign` | 0.10 | MIT | aji-manager dev-dependency |
    | `regex` | 1 | MIT OR Apache-2.0 | aji-manager (AMD family), tool |

- **KataGo releases** (recorded 2026-11-19 from `api.github.com/repos/lightvector/KataGo/releases`):
  - **Versions.** The manifest covers v1.17.0 and later, the first versions that load transformer networks. Release dates (UTC):

    | Version | Date |
    |---|---|
    | v1.18.2 | 2026-08-30 |
    | v1.18.1 | 2026-08-24 |
    | v1.18.0 | 2026-08-22 |
    | v1.17.2 | 2026-08-05 |
    | v1.17.1 | 2026-07-31 |
    | v1.17.0 | 2026-07-29 |

    v1.18.2 ships CUDA packages only; v1.17.2 ships TensorRT only.
  - **Asset metadata.** Every asset has `name`, `size`, `browser_download_url` and `digest` (`sha256:<hex>`). The engine's digest is GitHub's `digest`, used as-is, so KataGo packages are not downloaded to hash them. Networks use the model server's ETag MD5 (see below). Building the manifest downloads no engine, network or runtime archive.
  - **Phase 1 allow-list**, matched against the asset name with `^katago-v(?<ver>[0-9.]+)-(?<tag>.+)\.zip$`. Nothing else is listed: no `+bs50` packages, no cuDNN 8.9.7, no CUDA 12.1 or 12.5, and no TensorRT at all (Owner decisions, TensorRT).

    | `tag` pattern | Platform | Backend | Variant | Extra |
    |---|---|---|---|---|
    | `(cuda13\.2-cudnn9\.24\.0)-windows-x64` | windows-x64 | cuda | group 1 | runtime `nvidia-cuda13.2-cudnn9.24.0-windows-x64` |
    | `(cuda12\.8-cudnn9\.8\.0)-windows-x64` | windows-x64 | cuda | group 1 | runtime `nvidia-cuda12.8-cudnn9.8.0-windows-x64` |
    | `(onnx[0-9.]+-directml)-windows-x64` | windows-x64 | directml | group 1 | config `onnxProvider = directml` |
    | `(onnx-openvino[0-9.]*)-windows-x64` | windows-x64 | openvino | group 1 | config `onnxProvider = openvino` |
    | `(rocm[0-9.]+-(gfx103X\|gfx110X\|gfx1151\|gfx120X))-windows-x64` | windows-x64 | rocm | group 1 | `gpuFamily` = group 2 |
    | `(opencl)-(windows\|linux)-x64` | both | opencl | `opencl` | |
    | `(eigenavx2)-(windows\|linux)-x64` | both | eigenavx2 | `eigenavx2` | |
    | `(eigen)-(windows\|linux)-x64` | both | eigen | `eigen` | |

  - **The Metal build.** Assets of `reallxuan/aji-manifest` releases named `katago-v<ver>-metal-macos-arm64.zip` give platform macos-arm64, backend metal, variant `metal`.
  - **Notes from KataGo's own release notes:**
    - Transformers are much slower on OpenCL.
    - cuDNN 8.9.7 builds are much slower on transformers.
    - Windows ROCm needs only a recent AMD driver. Each package is for one GPU family.
    - The ONNX packages need `onnxProvider` set in the config.
- **NVIDIA** (R1, plus NVIDIA's CUDA 13 notes):
  - CUDA 13 dropped Maxwell, Pascal and Volta, so the CUDA 13.2 set needs compute capability 7.5 or newer.
  - Aji downloads each NVIDIA archive whole and checks NVIDIA's SHA-256 from the redist JSON (Owner decisions). The manifest names the DLLs to extract; it carries no per-DLL hash.
  - Archive sizes from the JSON files recorded on 2026-11-19:
    - CUDA 13.2 set: cuBLAS 388,113,288 + NVRTC 288,218,786 + cuDNN 1,274,017,601 = 1,950,349,675 bytes;
    - CUDA 12.8 set: 563,660,944 + 305,588,898 + 675,349,654 = 1,544,599,496 bytes.
  - Licence texts: each component's `license_path` under its redist root, for example `https://developer.download.nvidia.com/compute/cuda/redist/libcublas/LICENSE.txt` (63,021 bytes) and `https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/LICENSE.txt` (29,662 bytes).
  - Minimum Windows drivers: 580.00 for CUDA 13.x and 572.61 for CUDA 12.8 Update 1.
  - NVIDIA's redist JSON gives, for each component and platform, `relative_path`, `sha256`, `md5` and `size`. `size` is a string. cuDNN nests one level deeper, by CUDA variant (`cuda12`, `cuda13`).
  - Hosts: `https://developer.download.nvidia.com/`, then `https://developer.download.nvidia.cn/`. NVIDIA files are never re-hosted.
- **katagotraining.org** (recorded 2026-11-19):
  - `https://katagotraining.org/networks/` is one HTML table with 960 rows (`tr.normalNetworkStyle`, one `tr.strongestNetworkStyle`).
    - Cell 1: the name, plus an optional `<i title="…">` note.
    - Cell 2: `YYYY-MM-DD HH:MM:SS UTC`.
    - Cell 3: `<elo> ± <sd> - (<games> games)`, with `,` as the thousands separator.
    - Cell 4: a link to `https://media.katagotraining.org/uploaded/networks/models/kata1/<name>.bin.gz`. The `kata1-random` row has no link.
  - The model server answers `HEAD` with `content-length` and an `etag` that equals the file's MD5. The four networks downloaded during planning all matched. That MD5, as `md5:<hex>`, is the network's digest in the manifest (Owner decisions). The `HEAD` answers of 2026-11-19 are recorded in `crates/aji-manifest-tool/tests/fixtures/network-heads.json`.
  - The human SL network is `https://media.katagotraining.org/uploaded/networks/models_extra/b18c384nbt-humanv0.bin.gz`, 99,066,230 bytes, last modified 2025-04-22.
  - Licence page: `https://katagotraining.org/network_license/`.
  - **Network list rule.** Take the main networks with at least 1,000 rated games. Group them by family, which is the name up to and including the `b<n>c<n>[nbt][x2]` token with the `kata1-` prefix removed. Keep the highest Elo of each family, sort by Elo, and keep the top 8. On the 2026-11-19 page this gives exactly the interface mockup's eight rows:

    | # | Network | Elo | Games | Uploaded | Size (bytes) |
    |---|---|---|---|---|---|
    | 1 | kata1-tf3-b11c768-s12382M-d6533M | 14639.0 | 2,833 | 2026-11-01 | 262,041,254 |
    | 2 | kata1-zhizi-b40c768nbt-s11272M-d5935M | 14523.8 | 7,194 | 2026-06-06 | 863,210,287 |
    | 3 | kata1-tf3-b10c512-s3203M-d5937M | 14175.1 | 4,318 | 2026-08-25 | 94,281,753 |
    | 4 | kata1-zhizi-b28c512nbt-muonfd2 | 14164.6 | 5,062 | 2026-03-22 | 271,447,864 |
    | 5 | kata1-b28c512nbt-s13255194368-d5935380940 | 14111.3 | 4,315 | 2026-06-07 | 271,440,852 |
    | 6 | kata1-tf2-b10c384-s2941M-d5872M | 13715.8 | 4,072 | 2026-08-25 | 38,245,507 |
    | 7 | kata1-b18c384nbt-s9996604416-d4316597426 | 13629.0 | 3,991 | 2024-05-26 | 97,898,094 |
    | 8 | kata1-b60c320-s9356080896-d3824355768 | 13557.6 | 3,220 | 2023-11-17 | 403,507,095 |

  - Families starting with `tf` are transformers: `minEngineVersion` is 1.17.0. Other families have none.
- **The Mac** (MacBook Pro `Mac17,2`, recorded 2026-11-19):
  - `system_profiler -json SPDisplaysDataType SPHardwareDataType` takes 0.15 s. It reports one GPU: `sppci_model` "Apple M5", `sppci_cores` "10", `spdisplays_vendor` "sppci_vendor_Apple", `sppci_device_type` "spdisplays_gpu". It gives no GPU memory, since memory is unified.
  - `sysctl` gives:
    - `hw.memsize` 25769803776;
    - `hw.physicalcpu` 10, with `hw.perflevel0.physicalcpu` 4 and `hw.perflevel1.physicalcpu` 6;
    - `machdep.cpu.brand_string` "Apple M5";
    - `kern.osproductversion` 27.2 and `kern.osversion` 26B123.
  - A missing `hw.optional.*` key is silently left out (exit 0). An unknown key elsewhere prints `sysctl: unknown oid` and exits 1.
  - Homebrew KataGo 1.18.2 links libzip, protobuf 36.2 and 23 abseil 20260817.0 dylibs from `/opt/homebrew` (`otool -L`). It is not self-contained, which is why Aji builds its own.
  - Metal speed, measured with Homebrew KataGo 1.18.2 using `katago benchmark -config gtp_example.cfg -model <net>` (800 visits, auto-tuned threads unless noted). The raw outputs, M4's benchmark-parser fixtures, are committed in `crates/aji-manager/tests/fixtures/benchmark/1.18.2-metal/` (`72ac88f`).
    - With transformer networks, stderr repeats `Failed to import MPS module`. Convolutional networks do not print it. Answered in Task 3: Aji's own static Metal build prints it too, with the transformer network tf3-b10c512, and the benchmark still completes. It does not appear with the convolutional b18c384nbt, on either build. Whether it means a slower path has not been established.

    | Network | KataGo's recommended threads | visits/s there | Best visits/s |
    |---|---|---|---|
    | kata1-tf2-b10c384-s2941M-d5872M | 6 | 234.99 | 244.33 at 10 threads |
    | kata1-b18c384nbt-s9996604416-d4316597426 | 10 | 201.34 | 201.34 at 10 threads |
    | kata1-tf3-b10c512-s3203M-d5937M | 6 | 111.57 | 115.64 at 8 threads |
    | kata1-b28c512nbt-s13255194368-d5935380940 | stopped after 2 counts | — | 82.74 at 12 threads |
    | kata1-tf3-b11c768-s12382M-d6533M | 6 (fixed counts 6, 8 and 10, not auto-tuned) | 51.03 | 51.03 at 6 threads (50.81 at 8, 50.82 at 10) |

- **The KataGo Metal build** (KataGo `cpp/CMakeLists.txt` at v1.18.2):
  - It needs the Ninja generator and Swift 5.9 or newer.
  - It sets `CMAKE_OSX_DEPLOYMENT_TARGET` to 13.0 itself, which is the charter's macOS minimum.
  - It uses hybrid MPSGraph and CoreML execution. The vendored `external/katagocoreml` needs protobuf (with `protoc`) and abseil through pkg-config.
  - libzip is optional: without it KataGo defines `NO_LIBZIP`, and analysis works.

## Review Focus

1. **A GPU that looks usable but is not, or that Aji does not know.** Cases:
   - an NVIDIA driver too old for CUDA 12.8;
   - an RTX 50 card on a driver between 572.61 and 579;
   - a GTX 10-series card on a new driver, for which CUDA 13.2 refuses Pascal;
   - NVIDIA without `nvidia-smi`;
   - only the Microsoft Basic Render Driver, as over Remote Desktop;
   - a laptop whose integrated GPU is listed first;
   - an AMD card whose family Aji cannot place;
   - an Apple chip newer than any Aji knows.
   
   Each gets a working default, never "no GPU" for a real GPU, and never a CUDA build the card or driver cannot run. (Task 7: one test per row of the table; Task 6: `dxgi_basic_render_driver_is_software`, `nvidia_driver_from_umd`.)
2. **A tampered, stale or foreign manifest.** Cases: one byte changed, signed by another key, unsigned, an older signed copy replayed by a mirror, a copy whose sequence equals the bundled one. Each is rejected and the bundled copy is used. A tampered cache file is rejected on the next start. (Task 5: `a_tampered_manifest_is_rejected`, `a_signature_by_another_key_is_rejected`, `an_unsigned_manifest_is_rejected`, `an_older_or_equal_sequence_is_rejected`, `the_cache_is_verified_again_on_load`.)
3. **No network, or a hostile one, at startup.** Cases: offline, a server that accepts and never answers, a captive portal answering 200 with HTML. Setup requests answer at once from the bundled or cached copy, and the fetch gives up within its timeout. (Task 5: `fetch_gives_up_within_the_timeout`, `html_from_a_captive_portal_is_rejected`, `fetch_falls_back_to_the_next_base_url`; Task 8: `setup_requests_do_not_wait_for_the_fetch`.)
4. **A manifest newer than this Aji.** Cases: unknown fields, an engine with a backend or platform this Aji does not know, schema 2. An old Aji keeps working: it ignores the fields, skips those entries, and refuses schema 2 in favour of the bundled copy. (Task 4: `unknown_fields_are_ignored`, `entries_with_unknown_backend_or_platform_are_skipped`, `a_newer_schema_is_rejected`.)
5. **A detection probe that fails or prints garbage.** Cases: `nvidia-smi` printing "couldn't communicate with the NVIDIA driver", a missing or non-JSON `system_profiler`, DXGI failing. The report is still produced, names the failed probe in `problems`, and the recommendation works from what is known, at worst the CPU row. (Task 6: `nvidia_smi_failure_is_an_error`, `garbage_system_profiler_is_an_error`; Task 7: `a_failed_gpu_probe_still_recommends_the_cpu`.)

---

### Task 0: Windows test binaries get the app manifest (done during planning)

Already committed on the branch at the owner's request ("Add it to M3"). It stays unverified until a Windows CI run, which is the `main` push after the merge.

- [x] **Step 1:** `src-tauri/windows-app-manifest.xml` holds tauri-build 2.7.6's default manifest, which is the Common Controls v6 dependency only.
  - For a Windows MSVC target (`CARGO_CFG_TARGET_OS` and `CARGO_CFG_TARGET_ENV`, not `cfg!`), `src-tauri/build.rs` calls `tauri_build::try_build` with `WindowsAttributes::new_without_app_manifest()`.
  - It also emits `cargo:rustc-link-arg=/MANIFEST:EMBED` and `/MANIFESTINPUT:<path>`, so every binary of the package carries the manifest, test binaries included.
  - Other targets keep `tauri_build::build()`. Commit `52cdefd`, `fix: embed the Windows app manifest in test binaries`.
- [x] **Step 2:** CI runs `cargo test --workspace --no-fail-fast`, so one failing test binary cannot hide the others. Commit `574a22f`.
- [x] **Step 3:** On the Mac, `cargo fmt --all --check`, clippy with `-D warnings`, `cargo test --workspace` and `pnpm tauri build --bundles app` all passed.

### Task 1: M2 review items in `aji-core` and `aji-engine`

**Files:**
- Modify: `crates/aji-core/src/coords.rs`, `crates/aji-engine/src/{query,cache,engine,lib}.rs`, `crates/aji-engine/tests/engine.rs`, `crates/aji-engine/src/bin/engine-host.rs` (if it calls `set_position`).

**Interfaces:**
- Produces:
  - `pub fn move_to_gtp(mv: Move, size: BoardSize) -> Result<String, CoreError>`. An off-board point gives `Err(CoreError::PointOffBoard(p))` instead of a panic.
  - `pub fn analysis_query(id: &str, position: &Position, max_visits: u32, report_every: Duration) -> Result<String, CoreError>`.
  - `EngineError::InvalidPosition`.
  - `async fn set_position(&self, position: Position) -> Result<(), EngineError>`. It validates first. An invalid position changes nothing and sends no query.
  - `AnalysisCache::with_capacity(capacity: usize)`.
    - `offer` evicts the least recently used entry when a new key arrives at capacity.
    - `get(&mut self, key)` counts as a use.
    - `EngineOptions` gains `cache_entries: usize`, default **1,024 [Proposed]**.
  - `pub struct EngineStatus { pub state: EngineState, pub position: PositionKey, pub analysis: Option<AnalysisUpdate> }` and `fn status(&self) -> EngineStatus`.
    - `analysis` is the last update emitted for the current position.
    - On `set_position` it becomes the cached entry shown at once, or `None`.
    - Otherwise only a newer emitted update replaces it, as on the display. Pause, resume and restart keep it until the next report.
  - `state()` stays.

- [ ] **Step 1: Write the failing tests**
  - `aji-core` `gtp_rejects_off_board_points`:
    - `move_to_gtp(Play(19,0), 19×19)` and `Play(0,19)` give `Err(PointOffBoard)`, and so does `Play(9,0)` on 9×9;
    - the existing round-trip table still passes with `.unwrap()`.
  - `aji-engine`:
    - `cache_is_bounded`: capacity 2; offer A, offer B, `get(A)`, offer C. B is gone, and A and C remain.
    - `cache_updates_do_not_evict`: re-offering A at capacity evicts nothing.
    - `set_position_rejects_an_off_board_move`: the result is `Err(InvalidPosition)`, `status().position` is still P1's key, and no event carries another key.
    - `status_carries_the_latest_analysis`, with scenario `normal`:
      - after the first emitted update, `status().analysis` equals it;
      - after `set_position(P2)` with nothing cached, `analysis` is `None` and `position` is P2's key.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji-core -p aji-engine`. Expected: compile errors.
- [ ] **Step 3: Implement.** The cache stays `std`-only: a `HashMap` of entries with a use counter. On insert at capacity it evicts the minimum, which is O(n) at n = 1,024.
- [ ] **Step 4: Run them to verify they pass.** Run `cargo test -p aji-core -p aji-engine`. Expected: PASS, with every M2 test unchanged.
- [ ] **Step 5: Lint and commit**

```bash
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings
git add crates/aji-core crates/aji-engine
git commit -m "fix(engine): make GTP formatting total, bound the cache and expose the latest analysis"
```

### Task 2: The status reply carries the analysis, and the UI store checks positions

**Files:**
- Modify: `src-tauri/src/{protocol,service}.rs`, `src-tauri/tests/ipc.rs`, `src/transport/api.ts`, `src/engine/{engineStore.tsx,useEngineSync.ts}` and their tests.
- Regenerate: `src/transport/generated/`.

**Interfaces:**
- Consumes: Task 1's `Engine::status()`.
- Produces:
  - `Response::EngineStatus { engine: EngineState, position: PositionKey, analysis: Option<AnalysisUpdate> }`. The JSON is `{"type":"engineStatus","engine":{…},"position":"4d325c64abd378a1","analysis":null}`.
  - `EngineError::InvalidPosition` maps to `ErrorCode::Internal`, because no request sets a position until M6.
  - `getEngineStatus()` returns `{ engine, position, analysis }`.
  - The store state gains `position: PositionKey | null` and `sawAnalysis: boolean`.
    - `applyStatus(status)` sets `engine` unless `sawEvent` is set, sets `position` if it is still null, and sets `analysis` unless `sawAnalysis` is set or the positions differ.
    - `applyEvent` drops an `analysisUpdate` whose `position` differs from a non-null `position`; otherwise it sets `analysis` and `sawAnalysis`.
    - `setPosition(key)` sets `position`, and clears `analysis` when the key changes. M6 calls it.
  - `useEngineSync` passes the whole reply to `applyStatus`.

- [ ] **Step 1: Write the failing tests**
  - `protocol.rs` `engine_status_json_shape`: the JSON above for a not-configured engine.
  - `service.rs` `engine_status_reports_not_configured`: also position `4d325c64abd378a1` and analysis `None`.
  - `engineStore.test.ts`:
    - `update for another position is ignored`: status at position `aaaaaaaaaaaaaaaa`, then an update for `bbbbbbbbbbbbbbbb`. `analysis` stays null, and an update for `aaaa…` is applied.
    - `status reply shows the latest analysis`.
    - `status analysis never overwrites a newer update`: an update with 500 visits, then a status with 300, leaves 500.
    - The M2 test `status reply never overwrites a newer event` still passes.
  - `api.test.ts`: `getEngineStatus` returns all three fields.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji && pnpm test`. Expected: failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.** Run `cargo test --workspace && pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS. `EngineStatus` and the new `Response.ts` are regenerated.
- [ ] **Step 5: Commit**

```bash
git add src-tauri src src/transport/generated
git commit -m "feat: send the position and latest analysis with the engine status"
```

### Task 3: Build KataGo with Metal on the Mac (S2, local)

This task de-risks S2 before any code depends on it. Its script is the same one the manifest repository's workflow runs in Task 10.

**Files** (in `/Users/zepher/personal/aji-manifest`, a clone of `reallxuan/aji-manifest`):
- Create: `scripts/build-katago-metal.sh`.
- Create: `scripts/README-katago.txt.in`, the note shipped inside the zip.

**Interfaces:**
- Produces: `scripts/build-katago-metal.sh <katago-tag> <out-dir>` writes `<out-dir>/katago-<tag>-metal-macos-arm64.zip`, and prints its size and SHA-256 on the last two lines as `size <n>` and `sha256 <hex>`.
  - The zip holds `katago`, `LICENSE` (KataGo's, from the source root) and `README.txt`.
  - `README.txt` states that the build is from that tag of `https://github.com/lightvector/KataGo`, made by `reallxuan/aji-manifest`, unmodified, under KataGo's licence.

- [ ] **Step 1: Clone** `git clone https://github.com/reallxuan/aji-manifest /Users/zepher/personal/aji-manifest`.
- [ ] **Step 2: Write the script.** `set -euo pipefail`. Every path is under `WORK=$(mktemp -d)`. The steps:
  1. `git clone --depth 1 --branch <tag> https://github.com/lightvector/KataGo "$WORK/KataGo"`.
  2. Build abseil `20260817.0` and protobuf `v36.2` (the versions Homebrew built against) from source as **static** libraries into `$WORK/deps`.
     - Flags: `-G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 -DCMAKE_CXX_STANDARD=17`.
     - abseil also gets `-DABSL_PROPAGATE_CXX_STD=ON`.
     - protobuf also gets `-Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_ABSL_PROVIDER=package -DCMAKE_PREFIX_PATH=$WORK/deps`.
  3. Configure KataGo from `cpp/`.
     - Flags: `-G Ninja -DUSE_BACKEND=METAL -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=$WORK/deps -DCMAKE_IGNORE_PREFIX_PATH="/opt/homebrew;/usr/local"`.
     - Environment: `PKG_CONFIG_LIBDIR=$WORK/deps/lib/pkgconfig`.
     - The ignore path keeps Homebrew's shared protobuf, abseil and libzip out, so libzip is simply absent (`NO_LIBZIP`).
     - If the link fails on abseil's private dependencies, set `PKG_CONFIG="pkg-config --static"` and record that in the script.
  4. Run `ninja`, then `codesign --force --sign - --timestamp=none katago`, then zip and print the size and hash.
- [ ] **Step 3: Run it.** Run `scripts/build-katago-metal.sh v1.18.2 "$SCRATCH/metal"`, where `$SCRATCH` is the session scratchpad. Expected: exit 0.
  - **Time box: 2 hours.** If a static protobuf or abseil build cannot be made to link, use the fallback instead:
    - copy the dylibs next to `katago` and rewrite their install names to `@executable_path/` with `install_name_tool`;
    - ad-hoc sign each one;
    - record the fallback and why in the script header.
  - If CMake reports that the Command Line Tools' Swift cannot build the Metal backend, stop and ask the owner to install Xcode.
- [ ] **Step 4: Prove it is self-contained.**
  - `otool -L katago` lists only `/usr/lib/` and `/System/Library/` entries (and `@executable_path/` ones in the fallback).
  - `vtool -show-build katago` shows `minos 13.0`.
  - `./katago version` prints `KataGo v1.18.2` and `Using Metal backend`.
- [ ] **Step 5: Prove its speed.**
  - Run the new build, then Homebrew's, back to back, with the same command, from `$SCRATCH/metal`: `<katago> benchmark -config /opt/homebrew/share/katago/configs/gtp_example.cfg -model /opt/homebrew/share/katago/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz -t 10 -v 800 -n 10`.
  - Expected: the new build within 10% of Homebrew's run. The planning figure was 201.34 visits/s.
  - Also note whether `Failed to import MPS module` appears with `tf3-b10c512`.
- [ ] **Step 6: Commit in aji-manifest.** Do not push: Task 10 asks the owner.

```bash
git -C /Users/zepher/personal/aji-manifest add scripts
git -C /Users/zepher/personal/aji-manifest commit -m "build: add a self-contained KataGo Metal build script"
```

### Task 4: `aji-manager` and manifest schema v1

**Files:**
- Create: `crates/aji-manager/{Cargo.toml,src/lib.rs,src/manifest/mod.rs,src/manifest/schema.rs}`.
- Create: `crates/aji-manager/tests/fixtures/manifest/sample-v1.json`.
- Create: `crates/aji-manager/manifest/manifest.json`, a copy of the sample until Task 11.
- Modify: `Cargo.toml` (members).

**Interfaces:**
- Produces. All types are serde camelCase. Only `Platform` and `Backend` derive `TS`, because the manifest itself never crosses the boundary.
  - `pub const SCHEMA: u32 = 1;`
  - `pub struct Manifest { pub schema: u32, pub sequence: u64, pub generated: String, pub engines: Vec<Engine>, pub runtimes: Vec<Runtime>, pub networks: Vec<Network> }`.
    - `generated` is RFC 3339 UTC.
    - `sequence` is the generation time in seconds since 1970. It only grows.
  - `pub enum Platform`: `windows-x64`, `macos-arm64`, `linux-x64`, plus `#[serde(other)] Unknown`.
  - `pub enum Backend`: `cuda`, `directml`, `openvino`, `rocm`, `opencl`, `metal`, `eigenavx2`, `eigen`, plus `#[serde(other)] Unknown`. TensorRT is left out (Owner decisions); an older Aji skips a future `tensorrt` entry as `Unknown`.
  - `pub struct Engine { pub id: String, pub version: semver::Version, pub released: String, pub platform: Platform, pub backend: Backend, pub variant: String, pub runtime: Option<String>, pub gpu_family: Option<String>, pub config: BTreeMap<String, String>, pub file: FileRef }`.
    - `id` is the asset file stem, for example `katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64`.
    - `released` is `YYYY-MM-DD`.
  - `pub struct FileRef { pub name: String, pub size: u64, pub digest: Digest, pub urls: Vec<String> }`.
  - `pub enum Digest { Sha256(String), Md5(String) }` serialises as one string, `"sha256:<64 lowercase hex>"` or `"md5:<32 lowercase hex>"`, GitHub's `digest` format. Engines and NVIDIA archives use SHA-256; networks use MD5.
  - `pub struct Runtime { pub id, pub platform, pub min_driver: Option<String>, pub min_compute_capability: Option<String>, pub components: Vec<RuntimeComponent>, pub notice: String }`.
  - `pub struct RuntimeComponent { pub product, pub name, pub version, pub nvidia_manifest: String, pub archive: Archive, pub hosts: Vec<String>, pub extract: Vec<String>, pub licence: Licence }`.
    - `extract` lists the DLL file names to take out of the archive. `*` is a wildcard, as in `cudnn*64_9.dll`.
  - `pub struct Archive { pub path: String, pub size: u64, pub digest: Digest }`.
    - `path` is relative to each host, for example `compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-13.4.1.3-archive.zip`.
    - The archive is downloaded whole and checked against NVIDIA's own SHA-256 (Owner decisions).
  - `pub struct Licence { pub name, pub url, pub text_url, pub text_sha256, pub requires_acceptance: bool }`.
    - `text_url` is NVIDIA's `LICENSE.txt` for that component on the redist server.
    - `text_sha256` is the SHA-256 of that text. When it changes, Aji asks for acceptance again.

    These follow R1 section 7, simplified by the owner's decision to verify whole archives.
  - `pub struct Network { pub id, pub family, pub kind: NetworkKind, pub elo: Option<f64>, pub elo_games: Option<u32>, pub uploaded: String, pub min_engine_version: Option<semver::Version>, pub file: FileRef, pub licence: NetworkLicence { name, url } }`, with `NetworkKind` `main`, `humanSl`, plus `#[serde(other)] Unknown`.
  - `pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, ManifestError>`.
    - Unknown fields are ignored.
    - Entries whose platform, backend or kind is `Unknown` are dropped.
    - Then it validates:
      - every digest is `sha256:` with 64, or `md5:` with 32, lowercase hex digits;
      - every runtime component has at least one `extract` name and at least one `https://` host;
      - every `size` is above 0;
      - every URL list is non-empty and all `https://`;
      - ids are unique per list;
      - every engine `runtime` names a listed runtime.
  - `pub enum ManifestError { Json(String), UnsupportedSchema(u32), Invalid(String) }`. A schema other than 1 gives `UnsupportedSchema`, checked before the rest is parsed.
- Fixture `sample-v1.json`, sequence `1763500000`:
  - three engines:
    - `katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64`, with the real size and digest from Global Constraints;
    - `katago-v1.18.2-metal-macos-arm64`;
    - `katago-v1.18.1-eigenavx2-linux-x64`;
  - one runtime, `nvidia-cuda13.2-cudnn9.24.0-windows-x64`, with its cuBLAS component and the real values from `redistrib_13.2.2.json`;
  - two networks: rows 1 and 7 of the network table.

- [ ] **Step 1: Write the failing tests** (in `schema.rs`)
  - `parses_the_sample`: 3 engines, 1 runtime and 2 networks.
    - Engine 0 has size 9825374, digest `sha256:4b26f1889bed56b91964aa565f324eeab816e77f2ee79197be04f7291a2e7514` and runtime `nvidia-cuda13.2-cudnn9.24.0-windows-x64`.
    - Network 0 has elo 14639.0, min version 1.17.0, size 262041254 and digest `md5:db954878202524766e2f75ac61ae34c3`.
    - The runtime's cuBLAS archive has size 388113288 and digest `sha256:bc6f590490134f4dbe29672b72e536c44362cc5f738a0f7e48c8c3c141e9b24a`.
  - `unknown_fields_are_ignored`: an extra top-level field and an extra engine field.
  - `entries_with_unknown_backend_or_platform_are_skipped`: an engine with `"backend":"vulkan"` and one with `"platform":"freebsd-x64"` are dropped, and the rest are kept.
  - `a_newer_schema_is_rejected`: `"schema":2` gives `UnsupportedSchema(2)`.
  - `invalid_entries_reject_the_manifest`, one case each:
    - an uppercase SHA-256 digest;
    - a 63-digit SHA-256 digest;
    - a 31-digit MD5 digest;
    - an unknown algorithm, such as `sha1:…`;
    - a runtime component with an empty `extract`;
    - `size` 0;
    - an `http://` URL;
    - an empty `urls`;
    - a duplicate engine id;
    - an engine naming a missing runtime.
  - `bundled_manifest_parses`: `parse_manifest(BUNDLED)` is `Ok`.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji-manager`. Expected: compile errors.
- [ ] **Step 3: Implement.** Add `"crates/aji-manager"` to the workspace members. Dependencies: `serde`, `serde_json`, `semver` (with `serde`) and `ts-rs`. In `src/manifest/mod.rs`, add `pub const BUNDLED: &[u8] = include_bytes!("../../manifest/manifest.json");`.
- [ ] **Step 4: Run them to verify they pass.** Same command. Expected: PASS, and `Backend.ts` and `Platform.ts` are generated.
- [ ] **Step 5: Lint and commit**

```bash
git add Cargo.toml Cargo.lock crates/aji-manager src/transport/generated
git commit -m "feat(manager): add manifest schema v1"
```

### Task 5: Signature, choice of copy, cache and fetch

**Files:**
- Create: `crates/aji-manager/src/manifest/{verify,select,cache,fetch,keys}.rs`.
- Create: `crates/aji-manager/tests/manifest_fetch.rs` and `tests/common/http.rs`, a std-only HTTP/1.1 test server.

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `pub const TRUSTED_KEYS: &[&str] = &[];` holds minisign public keys in base64; it is filled in Task 11. `pub fn trusted_keys() -> Vec<minisign_verify::PublicKey>`.
  - `pub fn verify(bytes: &[u8], signature: &str, keys: &[PublicKey]) -> Result<(), Rejection>`. The key is picked by the signature's key id. No matching id gives `UnknownKey`; a mismatch gives `BadSignature`.
  - `pub enum Source { Bundled, Cache, Fetched }`, `pub struct Candidate { pub bytes: Vec<u8>, pub signature: Option<String>, pub source: Source }`.
  - `pub enum Rejection { Unsigned, UnknownKey, BadSignature, Unparsable(String), UnsupportedSchema(u32), NotNewer { sequence: u64, current: u64 } }`.
  - `pub struct Selected { pub manifest: Manifest, pub source: Source, pub rejected: Vec<(Source, Rejection)>, candidate: Option<Candidate> }`.
  - `pub fn select(bundled: &[u8], others: Vec<Candidate>, keys: &[PublicKey]) -> Selected`.
    - The bundled copy needs no signature. It parses by construction, since `bundled_manifest_parses` guards it, and is parsed with `expect`.
    - Each other candidate must be signed, verify, parse, and have a sequence strictly above the bundled one.
    - The highest sequence wins. A tie goes to `Fetched` over `Cache`.
  - `pub fn load_cache(dir: &Path) -> Option<Candidate>`. `pub fn store_cache(dir: &Path, candidate: &Candidate) -> io::Result<()>` writes temp files, then renames them.
  - `pub const MANIFEST_BASES: &[&str] = &["https://reallxuan.github.io/aji-manifest/v1"];`
  - `pub fn http_client(user_agent: &str) -> reqwest::Client`. It installs the ring provider, uses a 10 s timeout and the system proxy.
  - `pub async fn fetch(client: &reqwest::Client, bases: &[&str]) -> Result<Candidate, FetchError>`.
    - It GETs `<base>/manifest.json` and `<base>/manifest.json.minisig`, and moves to the next base on any failure.
    - A body over 4 MiB is a failure.
  - `pub struct ManifestStore`.
    - `ManifestStore::open(bundled: &'static [u8], cache_dir: PathBuf, keys: Vec<PublicKey>) -> ManifestStore` selects from the bundled copy and the cache, synchronously.
    - `fn current(&self) -> Arc<Selected>`.
    - `async fn refresh(&self, client: &reqwest::Client, bases: &[&str]) -> Source` fetches, selects against the current copy, stores a fetched winner in the cache, and swaps it in.

- [ ] **Step 1: Write the failing tests.** Each test generates a key pair with `minisign::KeyPair::generate_unencrypted_keypair()` and signs with it.
  - `select`:
    - `a_signed_newer_manifest_wins`: sequence bundled+1 gives `Fetched`.
    - `an_unsigned_manifest_is_rejected`.
    - `a_signature_by_another_key_is_rejected`: `UnknownKey`.
    - `a_tampered_manifest_is_rejected`: one byte flipped after signing gives `BadSignature`.
    - `an_older_or_equal_sequence_is_rejected`: `NotNewer` for both.
    - `a_newer_schema_is_rejected_even_when_signed`.
    - `html_from_a_captive_portal_is_rejected`: a signed HTML body gives `Unparsable`; an unsigned one gives `Unsigned`.
    - `fetched_beats_cache_on_a_tie`.
  - Cache:
    - `cache_round_trips_in_a_cjk_folder`: a temporary folder named `棋谱 测试`.
    - `the_cache_is_verified_again_on_load`: a byte changed on disk makes `ManifestStore::open` reject the cache and use the bundled copy.
  - `tests/manifest_fetch.rs`, against the test server on `127.0.0.1`:
    - `fetch_reads_both_files`;
    - `fetch_falls_back_to_the_next_base_url`: the first base returns 404;
    - `fetch_gives_up_within_the_timeout`: the server accepts and never answers; with a client timeout of 300 ms, `fetch` returns `Err` within 2 s;
    - `fetch_rejects_a_body_over_4_mib`;
    - `refresh_stores_a_winner_in_the_cache`.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji-manager`. Expected: compile errors.
- [ ] **Step 3: Implement.**
  - Dependencies: `minisign-verify`, `reqwest` and `rustls` as in Global Constraints, `tokio` (`rt`, `macros`, `time`, `sync`), and `tempfile` (dev).
  - `http_client` takes its timeout from a `ClientOptions { timeout }` with default 10 s, so tests can shorten it.
- [ ] **Step 4: Run them to verify they pass.** Same command. Expected: PASS. Also run `cargo tree -i aws-lc-sys; cargo tree -i openssl-sys`. Expected: both report that the package is not in the graph.
- [ ] **Step 5: Licences, lint and commit.** Add the `[graph] targets` line to `deny.toml` (Global Constraints, Dependencies), and name it in the commit message.

```bash
cargo deny check licenses && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings
git add Cargo.lock crates/aji-manager deny.toml
git commit -m "feat(manager): verify, choose, cache and fetch the signed manifest"
```

### Task 6: Hardware detection

**Files:**
- Create: `crates/aji-manager/src/hardware/{mod,macos,windows,linux,nvidia_smi,dxgi}.rs`.
- Create fixtures, each folder with a `SOURCE.md` saying where it came from and what was redacted:
  - Already committed during planning (`b47beb3`), with their `SOURCE.md`:
    - `crates/aji-manager/tests/fixtures/hardware/macos-m5/system_profiler.json`: captured 2026-11-19, with serial number, platform UUID, provisioning UDID, model number and display serial replaced by `REDACTED`;
    - `crates/aji-manager/tests/fixtures/hardware/macos-m5/sysctl.txt`: the reference values for the Mac exit check.
  - `windows-pc/aji-hardware-capture.json`: from `scripts/capture-hardware-windows.ps1` once the owner sends it. Until then, `windows-synthetic/` holds hand-written cases marked **synthetic** in its `SOURCE.md`.
  - `nvidia-smi/rtx5070-synthetic.csv` and `nvidia-smi/driver-failure.txt` (synthetic). The real query output from the PC capture is added next to them when it arrives.
  - `linux-synthetic/sys/...`, a hand-made sysfs tree, marked synthetic. There is no Linux GPU machine (R9).
- Modify: `src-tauri/Cargo.toml` (it gains the `aji-manager` dependency) and `src-tauri/src/protocol.rs` (it now uses `aji_manager::OsKind`).
- Already committed (`b47beb3`): `scripts/capture-hardware-windows.ps1`, which the owner runs on the PC. It has not been run on Windows yet.

**Interfaces:**
- Produces (serde camelCase, TS export):
  - `pub enum OsKind { Windows, Macos, Linux, Other }`, moved from `src-tauri` with its `current()`.
  - `pub struct HardwareReport { pub os: OsReport, pub cpu: CpuReport, #[ts(type = "number")] pub memory_bytes: u64, pub gpus: Vec<GpuReport>, pub problems: Vec<Probe> }`.
  - `pub struct OsReport { pub kind: OsKind, pub version: String, pub arch: String }`.
  - `pub struct CpuReport { pub name: String, pub cores: u32, pub threads: u32, pub avx2: bool }`.
  - `pub struct GpuReport { pub vendor: GpuVendor, pub name: String, #[ts(type = "number | null")] pub memory_bytes: Option<u64>, pub driver_version: Option<String>, pub pci_device_id: Option<u16>, pub apple_gpu_cores: Option<u32>, pub compute_capability: Option<String>, pub software: bool }`.
  - `pub enum GpuVendor { Nvidia, Amd, Intel, Apple, Microsoft, Other }`.
  - `pub enum Probe { SystemProfiler, Dxgi, NvidiaSmi, Sysfs }`, one entry for each probe that failed.
  - Parsers, pure and testable on every OS:
    - `pub fn gpus_from_system_profiler(json: &str) -> Result<Vec<GpuReport>, ParseError>`.
      - It takes `SPDisplaysDataType` entries with `sppci_device_type == "spdisplays_gpu"`.
      - `name` is `sppci_model`.
      - The vendor is Apple when `spdisplays_vendor` contains `Apple`, and Intel or AMD by the same test.
      - `apple_gpu_cores` comes from `sppci_cores`.
    - `pub fn parse_nvidia_smi(csv: &str) -> Result<Vec<NvidiaSmiGpu>, ParseError>`.
      - The input is the output of `--query-gpu=index,name,memory.total,driver_version,pci.device_id --format=csv`, header included, where memory looks like `12227 MiB` and `pci.device_id` like `0x2F0410DE`.
      - It yields `NvidiaSmiGpu { index: u32, name: String, memory_mib: u64, driver_version: String, device_id: u16 }`, where `device_id` is the high 16 bits.
      - Any line that does not fit, such as the "couldn't communicate with the NVIDIA driver" message, is `Err`.
    - `pub fn parse_nvidia_smi_compute_cap(csv: &str) -> Result<Vec<(u32, String)>, ParseError>`.
    - `pub struct DxgiAdapter { description: String, vendor_id: u32, device_id: u32, dedicated_video_memory: u64, flags: u32, umd_version: Option<String> }`.
      - It deserialises straight from the PC capture's `dxgi` entries, whose ids are `"0x10DE"` strings.
      - `pub fn gpus_from_dxgi(adapters: &[DxgiAdapter], smi: &[NvidiaSmiGpu], caps: &[(u32, String)]) -> Vec<GpuReport>`.
        - Vendor ids: 0x10DE NVIDIA, 0x1002 and 0x1022 AMD, 0x8086 Intel, 0x1414 Microsoft.
        - `software` is set when `flags & 2` is set or the vendor is 0x1414.
        - An NVIDIA adapter takes its driver version, memory and compute capability from the `nvidia-smi` entry with the same device id. Without one, the driver version comes from `nvidia_driver_from_umd`.
        - Other vendors keep the UMD version as the driver version.
    - `pub fn nvidia_driver_from_umd(umd: &str) -> Option<String>`: the last digit of the third part, then the fourth part zero-padded to 4 digits, read as `ddd.dd`. `32.0.15.6094` gives `560.94`; `32.0.15.8088` gives `580.88`.
    - `pub fn report_from_windows_capture(json: &str) -> Result<HardwareReport, ParseError>` builds a whole report from the capture script's file.
      - The GPUs come from `dxgi` and `nvidiaSmi` through the parsers above.
      - The CPU name and core counts come from `cpu[0]`; `avx2` from `cpuFeatures`; memory from `memory.totalPhysicalMemory`.
      - The OS is `Windows`, version `"<caption> <displayVersion> (<currentBuild>.<ubr>)"`, arch `x86_64`.
      - It lets the PC be checked on the Mac (Task 8 `--windows-capture`, Task 13).
    - `pub fn gpus_from_sysfs(root: &Path) -> Vec<GpuReport>`.
      - It reads `class/drm/card[0-9]*` only (not connector entries), using `device/vendor`, `device/device` and `device/mem_info_vram_total` (amdgpu).
      - The name is `"<Vendor> GPU 0x<device>"` unless `nvidia-smi` names it.
  - Probes, each behind `cfg(target_os)`:
    - macOS runs `/usr/sbin/system_profiler -json SPDisplaysDataType SPHardwareDataType`, with a 15 s limit.
    - Windows enumerates DXGI with `IDXGIFactory1::EnumAdapters1`, `GetDesc1`, and `CheckInterfaceSupport(IDXGIDevice)` for the UMD version.
      - When an NVIDIA adapter exists, it runs `nvidia-smi.exe` from `PATH`, or else from `%SystemRoot%\System32`.
      - That runs with `CREATE_NO_WINDOW`, a 10 s limit, and the two queries above.
    - Linux reads `/sys`, and runs `nvidia-smi` when a 0x10DE card exists.
    - Every OS gets the CPU, memory and OS version from `sysinfo` (`physical_core_count`, `cpus()[0].brand()`, `total_memory`, `long_os_version`). AVX2 comes from `is_x86_feature_detected!("avx2")` on x86_64 and is false elsewhere.
  - `pub async fn detect() -> HardwareReport`. Probes run on `spawn_blocking`. A failed probe adds to `problems` and never fails the report.

- [ ] **Step 1: Write the failing tests**
  - `macos_m5_fixture`: one GPU, vendor Apple, name `Apple M5`, `apple_gpu_cores` 10, memory `None`.
  - `garbage_system_profiler_is_an_error`: `not json`, and `{}` without `SPDisplaysDataType`, both give `Err`, so the probe is named in `problems`.
  - `nvidia_smi_parses`: the fixture `rtx5070-synthetic.csv`, or the real capture once it exists. Until then the synthetic one is:

    ```text
    index, name, memory.total [MiB], driver_version, pci.device_id
    0, NVIDIA GeForce RTX 5070, 12227 MiB, 591.44, 0x2F0410DE
    ```

    It gives memory 12227, driver `591.44` and device 0x2F04.
  - `nvidia_smi_failure_is_an_error`: `driver-failure.txt`, whose text is `NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running.`
  - `nvidia_driver_from_umd`: the two pairs above, plus the real pair from the PC capture when it arrives (its DXGI `umdVersion` against its `driver_version`).
  - `dxgi_with_nvidia_smi`: the RTX 5070 adapter and the Basic Render Driver adapter (vendor 0x1414, device 0x008C, flags 2) give two GPUs. The NVIDIA one has memory 12227 MiB, compute capability `12.0` and `software` false; the other is `software` true.
  - `dxgi_basic_render_driver_is_software`.
  - `dxgi_without_nvidia_smi_derives_the_driver`.
  - `sysfs_synthetic`: an AMD card with 16 GiB VRAM and an Intel iGPU with no VRAM file.
  - `pc_capture_gives_the_rtx5070`, once the capture arrives: `report_from_windows_capture` gives an NVIDIA GPU with `nvidia-smi`'s name, memory, driver and capability, plus the Basic Render Driver as `software`.
  - `detect_live_sanity`, on every CI OS: `cores >= 1`, `threads >= cores`, `memory_bytes > 0`, and `os.kind == OsKind::current()`.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji-manager hardware`. Expected: compile errors.
- [ ] **Step 3: Implement.** Dependencies: `sysinfo`; on Windows, `windows`; and `tokio` (`process` and `rt`) for the probe commands.
- [ ] **Step 4: Run them to verify they pass.** Run `cargo test --workspace && git diff --exit-code src/transport/generated/OsKind.ts`. Expected: PASS, and `OsKind.ts` unchanged.
- [ ] **Step 5: No identifiers leak.**
  - `! grep -rIiE "$(hostname -s)|$USER" crates/aji-manager/tests/fixtures` exits 0.
  - `grep -c REDACTED crates/aji-manager/tests/fixtures/hardware/macos-m5/system_profiler.json` prints 5.
  - If the script is installed, `pwsh -NoProfile -Command '$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile("scripts/capture-hardware-windows.ps1", [ref]$null, [ref]$e); $e'` prints nothing.
- [ ] **Step 6: Lint and commit**

```bash
git add Cargo.lock crates/aji-manager src-tauri/Cargo.toml src-tauri/src/protocol.rs src/transport/generated
git commit -m "feat(manager): detect the OS, CPU, memory and GPUs"
```

### Task 7: Recommendation

**Files:**
- Create: `crates/aji-manager/src/recommend/{mod,gpu,networks}.rs`, `crates/aji-manager/tests/recommend_table.rs`.

**Interfaces:**
- Consumes: Task 4 `Manifest`; Task 6 `HardwareReport`.
- Produces (serde camelCase, TS export):
  - `pub struct BackendRecommendation { pub platform: Option<Platform>, pub gpu: Option<GpuReport>, pub backends: Vec<BackendChoice>, pub default: Option<Backend>, pub fallbacks: Vec<Backend>, pub notes: Vec<RecommendationNote> }`.
  - `pub struct BackendChoice { pub backend: Backend, pub tags: Vec<BackendTag> }`.
  - `pub enum BackendTag { Fastest, NoRuntimeDownload, MostCompatible, Slowest, CpuOnly }`. The wizard's texts from interface design 7 map to these:

    | Tag | Mockup text |
    |---|---|
    | `fastest` | `最快` |
    | `noRuntimeDownload` | `免运行库` |
    | `mostCompatible` + `slowest` | `兼容性最好，最慢` |

  - `pub enum RecommendationNote { UnsupportedPlatform, NoUsableGpu, DriverTooOldForCuda, UnknownAmdFamily, NoEngineForBackend }`.
  - `pub struct EngineVersionChoice { pub engine: String, pub version: String, pub released: String, #[ts(type = "number")] pub download_bytes: u64, #[ts(type = "number | null")] pub runtime_bytes: Option<u64>, pub latest: bool }`. `runtime_bytes` is the sum of the runtime's archive sizes, which is what the user downloads.
  - `pub struct NetworkChoice { pub network: String, pub family: String, pub elo: Option<f64>, pub uploaded: String, #[ts(type = "number")] pub size_bytes: u64 }`.
  - `pub struct NetworkList { pub networks: Vec<NetworkChoice>, pub preselected: Option<String>, pub human: Option<NetworkChoice> }`.
  - `pub fn recommend_backends(report: &HardwareReport, manifest: &Manifest) -> BackendRecommendation`.
  - `pub fn versions(report: &HardwareReport, manifest: &Manifest, backend: Backend) -> Vec<EngineVersionChoice>`: newest first, for the variant this hardware needs.
  - `pub fn networks(report: &HardwareReport, manifest: &Manifest, engine_id: &str) -> Option<NetworkList>`.
    - It returns `None` for an unknown engine.
    - It keeps main networks whose `minEngineVersion` is at or below the engine's version, sorted by Elo, highest first.
    - The human SL network goes in `human`.
- **Choosing the GPU.**
  - Software adapters are ignored.
  - The rest are ordered by vendor (NVIDIA, Apple, AMD, Intel, then the others), then by memory, largest first. The first one is the GPU used.
- **The table** (charter 6.3 as amended by R1 and NVIDIA's CUDA 13 notes; **[Proposed]** where the charter is silent).
  - Rows apply to the platform from `os.kind` and `os.arch`: windows+x86_64, macos+aarch64 or linux+x86_64. Any other combination gives no backends and `UnsupportedPlatform`.
  - A backend is listed only when the manifest has an engine for this platform, backend and variant (or GPU family). Otherwise the next one moves up and `NoEngineForBackend` is noted.

  | GPU and conditions | `backends` in order (variant) | `default` | `fallbacks` |
  |---|---|---|---|
  | NVIDIA, Windows, driver ≥ 580.00, compute capability ≥ 7.5 | cuda (cuda13.2-cudnn9.24.0), directml, opencl | cuda | directml, opencl |
  | NVIDIA, Windows, driver ≥ 572.61 where the first row does not apply (driver below 580.00, or capability below 7.5 or unknown) | cuda (cuda12.8-cudnn9.8.0), directml, opencl | cuda | directml, opencl |
  | NVIDIA, Windows, driver below 572.61 or unknown | directml, opencl; note `DriverTooOldForCuda` | directml | opencl |
  | AMD, Windows, family known | rocm (that family), directml, opencl | rocm | directml, opencl |
  | AMD, Windows, family unknown | directml, opencl; note `UnknownAmdFamily` | directml | opencl |
  | Intel, Windows | openvino, directml, opencl | openvino | directml, opencl |
  | Any GPU, Linux | opencl, eigenavx2 (if AVX2), eigen | opencl | eigenavx2 or eigen |
  | Apple, macOS arm64 | metal | metal | none |
  | No usable GPU (including only software adapters) | eigenavx2 (if AVX2), eigen; note `NoUsableGpu` | the first one | the rest |

  - **AMD family by name [Proposed]**, case-insensitive:
    - `RX 6\d{3}` → gfx103X;
    - `RX 7\d{3}` → gfx110X;
    - `RX 9\d{3}` → gfx120X;
    - `Radeon 80[56]0S` → gfx1151;
    - anything else is unknown.
  - **Tags:**
    - cuda, rocm and openvino get `fastest`;
    - directml gets `noRuntimeDownload`;
    - opencl gets `mostCompatible` and `slowest`;
    - eigenavx2 and eigen get `cpuOnly`;
    - metal gets none.
  - Driver versions compare as dotted numbers. Compute capability compares as `major.minor` numbers.
- **Network preselect (O4, decided by the owner on 2026-11-19).**
  - `preselected` is the first row of `networks`: the highest Elo from katagotraining.org among the networks the engine can load.
  - The rule is the same on every machine and backend. There are no GPU tiers, and no local measurement feeds it.
  - On the 2026-11-19 data it is `kata1-tf3-b11c768-s12382M-d6533M`, as interface design 7 draws it.
  - On OpenCL and Eigen this preselects a network that KataGo's notes call much slower there. The user can pick another row.

- [ ] **Step 1: Write the failing tests** in `tests/recommend_table.rs`.
  - Build each `HardwareReport` with a helper. The manifest fixture `tests/fixtures/manifest/table-v1.json` has:
    - one engine for every backend and variant in the allow-list, for v1.18.1;
    - the cuda engines also for v1.18.2;
    - metal for v1.18.2;
    - runtimes for the two NVIDIA sets;
    - the eight networks plus `b18c384nbt-humanv0`.
  - One test per table row, asserting `backends`, `default`, `fallbacks` and `notes` exactly:
    - `nvidia_rtx50_new_driver` (RTX 5070, driver 591.44, capability 12.0): versions(cuda) gives `["1.18.2", "1.18.1"]`, both cuda13.2.
    - `nvidia_rtx50_driver_575` (575.51) gives cuda12.8.
    - `nvidia_pascal_new_driver` (GTX 1080, 581.29, capability 6.1) gives cuda12.8.
    - `nvidia_without_nvidia_smi` (no capability) gives cuda12.8.
    - `nvidia_driver_too_old` (566.03) gives directml first, with the note.
    - `amd_rdna3` (`AMD Radeon RX 7800 XT`) gives rocm gfx110X.
    - `amd_unknown_family` (`AMD Radeon(TM) Graphics`) gives directml, with the note.
    - `intel_arc` (`Intel(R) Arc(TM) A770 Graphics`) gives openvino.
    - `linux_amd` gives opencl, eigenavx2, eigen.
    - `apple_m5` (10 cores) gives metal only.
    - `apple_unknown_newer_chip` (`Apple M9 Ultra`, 80 cores) gives metal, not `NoUsableGpu`.
    - `no_gpu_avx2` and `no_gpu_without_avx2`.
    - `basic_render_driver_counts_as_no_gpu`.
    - `laptop_with_integrated_gpu_listed_first` (Intel UHD 770, then RTX 4060 Laptop) gives the NVIDIA row.
    - `intel_mac` (macOS x86_64) gives no backends, with `UnsupportedPlatform`.
    - `manifest_without_metal` gives the Mac no backends, with `NoEngineForBackend`.
    - `a_failed_gpu_probe_still_recommends_the_cpu`: no GPUs, `problems: [Dxgi]`, gives eigenavx2.
  - Networks:
    - `networks_are_in_elo_order_and_filtered_by_version`: an engine of version 1.16.0 in a test manifest lists no `tf` family.
    - `unknown_engine_gives_none`.
    - `preselects_the_top_row`: `kata1-tf3-b11c768-s12382M-d6533M` for `apple_m5`, `nvidia_rtx50_new_driver` and `no_gpu_avx2` alike.
    - `preselect_follows_elo_not_architecture`: in a test manifest where a b28c512nbt network out-rates every `tf` one, the b28 is first and preselected.
    - `preselect_skips_networks_the_engine_cannot_load`: for an engine of version 1.16.0, the preselected network is `kata1-zhizi-b40c768nbt-s11272M-d5935M`, the best non-transformer.
  - `runtime_bytes_is_the_whole_archives`: versions(cuda) gives `runtime_bytes` 1950349675 for the RTX 5070 (the CUDA 13.2 set) and 1544599496 for the GTX 1080 (the CUDA 12.8 set).
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji-manager --test recommend_table`. Expected: compile errors.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Lint and commit**

```bash
git add crates/aji-manager src/transport/generated
git commit -m "feat(manager): recommend a backend, versions and a network"
```

### Task 8: Setup protocol, the manifest at startup, and the development command

**Files:**
- Create: `crates/aji-manager/src/setup.rs`, `crates/aji-manager/src/bin/aji-setup-report.rs`.
- Modify:
  - `src-tauri/src/{protocol,service,lib}.rs` and `src-tauri/tests/ipc.rs`;
  - `src-tauri/Cargo.toml`;
  - `src/transport/transport.ts` (`KNOWN_CODES`);
  - `src/locales/{en,zh-CN}.json`;
  - `docs/development.md`.

**Interfaces:**
- Consumes: Tasks 5 to 7.
- Produces:
  - `pub struct Setup` in `aji-manager`:
    - `Setup::new(manifest: ManifestStore) -> Setup` detects lazily, once, on first use, behind a `tokio::sync::OnceCell`.
    - `Setup::with_hardware(manifest: ManifestStore, report: HardwareReport) -> Setup` is for tests.
    - Methods:
      - `async fn hardware(&self) -> HardwareReport`;
      - `async fn backends(&self) -> BackendRecommendation`;
      - `async fn versions(&self, backend: Backend) -> Vec<EngineVersionChoice>`;
      - `async fn networks(&self, engine: &str) -> Option<NetworkList>`;
      - `fn manifest(&self) -> &ManifestStore`.
  - Requests:
    - `SetupDetect` → `{"type":"setupDetect"}`;
    - `SetupBackends` → `{"type":"setupBackends"}`;
    - `SetupVersions { backend }` → `{"type":"setupVersions","backend":"cuda"}`;
    - `SetupNetworks { engine }` → `{"type":"setupNetworks","engine":"katago-v1.18.2-metal-macos-arm64"}`.
  - Responses:
    - `SetupDetect { hardware }`;
    - `SetupBackends { recommendation }`;
    - `SetupVersions { versions }`;
    - `SetupNetworks { networks }`.
  - `ErrorCode::SetupUnknownEngine` → `"setupUnknownEngine"`.
  - `AppContext` gains `pub setup: Arc<Setup>`, and `AppContext::detect(version, engine, setup)` takes it. Tests build it with `Setup::with_hardware`.
  - `run()`:
    - opens the `ManifestStore` from `BUNDLED`, `app_local_data_dir/manifest` and `trusted_keys()`;
    - spawns `refresh(MANIFEST_BASES)` on `tauri::async_runtime` without awaiting it;
    - logs the outcome with `eprintln!` (`aji: manifest <source> sequence <n>`, plus one line per rejection).
  - The binary `aji-setup-report [--fetch] [--hardware <report.json> | --windows-capture <aji-hardware-capture.json>]` prints pretty JSON:
    - `{ "manifest": { "source", "sequence", "rejected" }, "hardware", "recommendation", "versions": { "<backend>": [...] }, "networks": { "<engine of the default backend's latest version>": {...} } }`;
    - with `--fetch` it refreshes from `MANIFEST_BASES` first;
    - with `--hardware` it reads a `HardwareReport` from the file, and with `--windows-capture` it builds one with `report_from_windows_capture`, instead of detecting. This lets the PC be checked on the Mac. It uses no cache folder.
- Locale strings, exact:

  | Key | en | zh-CN |
  |---|---|---|
  | `errors.setupUnknownEngine` | That engine is not in the list. | 列表中没有这个引擎。 |

- [ ] **Step 1: Write the failing tests**
  - `protocol.rs`: the JSON shapes of the four requests, the four responses and the new code.
  - `service.rs`, with `Setup::with_hardware(apple_m5)` over the sample manifest:
    - `setupBackends` default is metal;
    - `setupVersions{metal}` gives one entry, `1.18.2`;
    - `setupNetworks{engine:"nope"}` gives `Err(setupUnknownEngine)`.
  - `setup.rs` `setup_requests_do_not_wait_for_the_fetch`: start `refresh` against the never-answering test server, then call `backends()`. It returns in under 100 ms from the bundled copy.
  - `tests/ipc.rs`: `rpc` with `{"request":{"type":"setupBackends"}}` returns `type` `setupBackends`.
  - The locale parity test passes with the new key.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test --workspace && pnpm test`. Expected: failures.
- [ ] **Step 3: Implement.** In `docs/development.md`, add a section on `aji-setup-report`: what it prints, `--fetch`, `--hardware` and `--windows-capture`.
- [ ] **Step 4: Run them to verify they pass.** Run `cargo test --workspace && pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5: Try it.** Run `cargo run -p aji-manager --bin aji-setup-report`. Expected: Apple M5, 10 cores, 25769803776 bytes, `default: "metal"`, from the sample manifest.
- [ ] **Step 6: Commit**

```bash
git add Cargo.lock crates/aji-manager src-tauri src docs/development.md
git commit -m "feat: answer setup requests from the manifest and the hardware report"
```

### Task 9: The manifest generator

**Files:**
- Create: `crates/aji-manifest-tool/{Cargo.toml,src/main.rs,src/releases.rs,src/networks.rs,src/nvidia.rs,src/generate.rs}`.
- Fixtures under `crates/aji-manifest-tool/tests/fixtures/`:
  - Already committed during planning, with `SOURCE.md` (recorded 2026-11-19):
    - `katago-releases.json`: the six releases, trimmed to `tag_name`, `published_at` and each asset's `name`, `size`, `digest` and `browser_download_url`;
    - `networks.html`: the whole page, 504,019 bytes;
    - `network-heads.json`: the `HEAD` answers (`url`, `status`, `contentLength`, `etag`, `lastModified`) for the eight networks and the human SL network;
    - `redistrib_13.2.2.json` and `redistrib_12.8.1.json` (`libcublas`, `cuda_nvrtc`), `redistrib_9.24.0.json` and `redistrib_9.8.0.json` (`cudnn`).
    
    The live sources change daily. Tests read these files and never re-fetch them.
  - Create:
    - `metal-releases.json`: a hand-made answer naming one `katago-v1.18.2-metal-macos-arm64.zip`;
    - `licence-text.txt`: a few lines standing in for an NVIDIA `LICENSE.txt`.
- Modify: `Cargo.toml` (members).

**Interfaces:**
- Consumes: Task 4 types and `parse_manifest`.
- Produces the binary `aji-manifest`:
  - `aji-manifest generate --out <manifest.json> [--sequence <n>] [--katago-releases <file>] [--metal-releases <file>] [--networks-page <file>] [--network-heads <file>] [--nvidia-dir <dir>] [--licence-texts <dir>]`.
    - Without the file flags it reads:
      - `https://api.github.com/repos/lightvector/KataGo/releases?per_page=30`;
      - `https://api.github.com/repos/reallxuan/aji-manifest/releases?per_page=30`;
      - `https://katagotraining.org/networks/`;
      - one `HEAD` request for each chosen network;
      - the four NVIDIA JSON files and each component's `LICENSE.txt`.
      
      `GH_TOKEN`, when set, goes to GitHub as a bearer token.
    - It downloads no engine, network or runtime archive.
    - **Networks.**
      - The digest is `md5:` plus the `HEAD` answer's `etag` without its quotes; the size is `content-length`.
      - An ETag that is not exactly 32 hex digits, such as an S3 multipart `"…-232"`, fails the generation, naming the network.
      - The human SL network's `uploaded` date comes from its `last-modified`.
    - **NVIDIA sets.** These are constants in `nvidia.rs`:

      | Set | Driver | Capability | Components (NVIDIA JSON) | `extract` |
      |---|---|---|---|---|
      | `nvidia-cuda13.2-cudnn9.24.0-windows-x64` | 580.00 | 7.5 | libcublas 13.4.1.3 and cuda_nvrtc 13.2.86 (`redistrib_13.2.2.json`); cudnn 9.24.0.43, `cuda13` (`redistrib_9.24.0.json`) | `cublas64_13.dll`, `cublasLt64_13.dll`; `nvrtc64_130_0.dll`, `nvrtc-builtins64_132.dll`; `cudnn*64_9.dll` |
      | `nvidia-cuda12.8-cudnn9.8.0-windows-x64` | 572.61 | 5.0 | libcublas 12.8.4.1 and cuda_nvrtc 12.8.93 (`redistrib_12.8.1.json`); cudnn 9.8.0.87, `cuda12` (`redistrib_9.8.0.json`) | `cublas64_12.dll`, `cublasLt64_12.dll`; `nvrtc64_120_0.dll`, `nvrtc-builtins64_128.dll`; `cudnn*64_9.dll` |

      - The JSON URLs are `https://developer.download.nvidia.com/compute/cuda/redist/redistrib_<v>.json` and `https://developer.download.nvidia.com/compute/cudnn/redist/redistrib_<v>.json`.
      - The archive `path` is `compute/cuda/redist/` or `compute/cudnn/redist/`, followed by the JSON's `windows-x86_64` `relative_path`. Its size is parsed from the JSON's string, and its digest is `sha256:` plus the JSON's `sha256`.
      - The hosts are both NVIDIA hosts from Global Constraints.
      - The licence names are `NVIDIA CUDA Toolkit EULA` for the JSON licence `CUDA Toolkit`, at `https://docs.nvidia.com/cuda/eula/index.html`, and `NVIDIA cuDNN Software License Agreement` for `cudnn`, at `https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html`.
      - `text_url` is the redist root plus the JSON's `license_path`; `text_sha256` hashes the fetched text.
      - The notice has one line per component: `NVIDIA <JSON name> <version>, © NVIDIA Corporation. Licensed under the <licence name>. Not covered by Aji's AGPL licence.`
    - The output is pretty JSON with sorted keys. Engines are sorted by platform, backend, variant and version (descending); networks by Elo. Identical inputs and `--sequence` give identical bytes.
    - It runs `parse_manifest` on its own output before writing, and fails if that fails.
  - `aji-manifest verify --manifest <file> --signature <file> --public-key <file>` verifies with `aji_manager::verify`, parses, and prints `sequence <n> engines <n> runtimes <n> networks <n>`.

- [ ] **Step 1: Check the committed fixtures.** Run `! grep -rqF "$HOME" crates/aji-manifest-tool/tests/fixtures crates/aji-manager/tests/fixtures`. Expected: exit 0. Version filtering in the tool uses `semver`: a string comparison would put `v1.9.0` after `v1.17.0`.
- [ ] **Step 2: Write the failing tests**
  - `allow_list_windows_1_18_1`: exactly 11 engines for windows-x64 v1.18.1:
    - cuda ×2;
    - directml with `onnxProvider = directml`;
    - openvino with `onnxProvider = openvino`;
    - rocm ×4, with families gfx103X, gfx110X, gfx1151 and gfx120X;
    - opencl;
    - eigenavx2;
    - eigen.
  - `allow_list_linux_1_18_1`: opencl, eigenavx2 and eigen only.
  - `no_bs50_or_cudnn8_or_tensorrt`: no engine id contains `+bs50`, `cudnn8.9.7` or `trt`.
  - `engine_uses_the_github_digest`: `katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64` has size 9825374, digest `sha256:4b26f1889bed56b91964aa565f324eeab816e77f2ee79197be04f7291a2e7514`, the `browser_download_url`, `released` 2026-08-30 and runtime `nvidia-cuda13.2-cudnn9.24.0-windows-x64`.
  - `versions_start_at_1_17_0`: versions compare with `semver`, so a release `v1.9.0` that the test adds to the input is left out.
  - `metal_engine_from_aji_manifest_releases`.
  - `network_list_matches_the_page`: the eight ids, Elos, games and dates of the Global Constraints table, in that order.
  - `network_digest_from_etag`: `kata1-tf3-b11c768-s12382M-d6533M` has digest `md5:db954878202524766e2f75ac61ae34c3` and size 262041254.
  - `a_multipart_etag_fails`: an ETag of `"56d884632364106ca7f99ba428b468b6-232"` fails, naming the network.
  - `transformers_need_1_17`: tf2 and tf3 families have min version 1.17.0; the others have none.
  - `human_sl_network_is_listed`: `b18c384nbt-humanv0`, kind `humanSl`, elo null, digest `md5:dc7ce241411b05ef2a5416d6406313a4`, size 99066230, uploaded 2025-04-22.
  - `nvidia_sets_from_redist`:
    - the CUDA 13.2 set's archives have sizes 388113288, 288218786 and 1274017601;
    - its cuBLAS digest is `sha256:bc6f590490134f4dbe29672b72e536c44362cc5f738a0f7e48c8c3c141e9b24a`;
    - cuDNN resolves through `cuda13`;
    - the CUDA 12.8 set's archive sizes sum to 1544599496.
  - `licence_text_is_hashed`: with `--licence-texts` pointing at `licence-text.txt`, every component's `text_sha256` equals that file's SHA-256, computed in the test.
  - `generate_is_deterministic`: all file flags and `--sequence 1763500000`, run twice, give byte-identical files.
  - `generated_manifest_parses`.
- [ ] **Step 3: Run them to verify they fail.** Run `cargo test -p aji-manifest-tool`. Expected: compile errors.
- [ ] **Step 4: Implement.** Dependencies: `aji-manager`, `reqwest` (as in Global Constraints, plus `json`), `rustls`, `tokio`, `scraper`, `sha2`, `serde_json` and `regex`. Arguments are parsed by hand; there is no CLI crate.
- [ ] **Step 5: Run them to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 6: Licences, lint and commit**

```bash
cargo deny check licenses && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings
git add Cargo.toml Cargo.lock crates/aji-manifest-tool
git commit -m "feat(manifest-tool): generate the manifest from KataGo releases, networks and NVIDIA's redist data"
```

### Task 10: The manifest repository (S2 in CI, publishing, the signing key)

Outward-facing. Each push and each workflow run waits for the owner's OK.

**Files** (in `/Users/zepher/personal/aji-manifest`):
- Create:
  - `README.md`, replacing the one-line default;
  - `.github/workflows/katago-metal.yml`;
  - `.github/workflows/manifest.yml`;
  - `keys/aji-manifest.pub`.

**Interfaces:**
- Consumes: Task 3's script; Task 9's tool, built from `reallxuan/Aji` at a given ref.
- Produces:
  - **The `katago-metal.yml` workflow.**
    - It runs on `workflow_dispatch` with input `tag` (default `v1.18.2`), on `macos-15`, with `permissions: contents: write`.
    - Steps:
      1. checkout;
      2. `brew install cmake ninja pkgconf`;
      3. `scripts/build-katago-metal.sh "$tag" out`;
      4. `gh release create "katago-$tag-metal" out/*.zip --title "KataGo $tag (Metal, macOS arm64)" --notes-file <generated notes>`.
    - The notes name the source tag, the script commit, the SHA-256, and that it is unmodified KataGo under its licence.
  - **The `manifest.yml` workflow.**
    - It runs on `workflow_dispatch` with input `aji_ref` (default `main`), on `ubuntu-24.04`, with `permissions: contents: read, pages: write, id-token: write`.
    - Steps:
      1. check out this repository, and `reallxuan/Aji` at `aji_ref` into `aji/`;
      2. `rustup toolchain install` in `aji/`;
      3. `cargo build --release --manifest-path aji/Cargo.toml -p aji-manifest-tool`;
      4. `aji-manifest generate --out site/v1/manifest.json`, with `GH_TOKEN: ${{ github.token }}`;
      5. `sudo apt-get install -y minisign`;
      6. write `${{ secrets.MINISIGN_SECRET_KEY }}` to a `umask 077` temp file and run `minisign -S -s <file> -m site/v1/manifest.json -x site/v1/manifest.json.minisig -t "aji-manifest sequence <n>"`, then delete the file;
      7. `aji-manifest verify --manifest site/v1/manifest.json --signature site/v1/manifest.json.minisig --public-key keys/aji-manifest.pub`;
      8. `actions/upload-pages-artifact` from `site/`, then `actions/deploy-pages`.
  - `README.md` covers:
    - what the repository is;
    - the two URLs;
    - that Metal builds are unmodified KataGo under its licence;
    - that NVIDIA files are never hosted here;
    - the network licence link;
    - how to run both workflows;
    - key rotation: add the new public key to Aji first, release, then switch the secret.

- [ ] **Step 1: The owner makes the signing key.** Ask the owner to run, in a folder outside both repositories:

  ```bash
  brew install minisign
  minisign -G -W -p aji-manifest.pub -s aji-manifest.key
  gh secret set MINISIGN_SECRET_KEY -R reallxuan/aji-manifest < aji-manifest.key
  ```

  - The owner keeps `aji-manifest.key` in their password manager and gives the agent only `aji-manifest.pub`, which is public.
  - The secret key never passes through the agent's session.
- [ ] **Step 2: Write the files**, with the public key as `keys/aji-manifest.pub`.
- [ ] **Step 3: Check the workflows locally.** Run `pnpm exec prettier --check` on both, from the Aji checkout, with `--config` pointing at Aji's Prettier config. Expected: valid YAML.
- [ ] **Step 4: Commit and ask to push.**

  ```bash
  git -C /Users/zepher/personal/aji-manifest add -A
  git -C /Users/zepher/personal/aji-manifest commit -m "ci: build KataGo with Metal and publish the signed manifest"
  ```

  Ask the owner to approve `git push origin main` in aji-manifest.
- [ ] **Step 5: Run the Metal build.** With the owner's OK, run `gh workflow run katago-metal.yml -R reallxuan/aji-manifest -f tag=v1.18.2`, then `gh run watch`. Expected: a release `katago-v1.18.2-metal` with one zip asset.
- [ ] **Step 6: Prove it on the M5.** The runner is older Apple hardware, so the proof is here.
  1. `curl -L -o "$SCRATCH/katago-metal.zip" <asset url>`, with no browser.
  2. `xattr -l` shows no `com.apple.quarantine`.
  3. `shasum -a 256` matches the release notes.
  4. Unzip, then run `./katago version` and Task 3 Step 5's back-to-back benchmark. Expected: within 10% of Homebrew's run.
- [ ] **Step 7:** The manifest workflow is **not** run yet. It needs the tool on Aji's `main`; Task 13 runs it after the merge.

### Task 11: Real data: the bundled manifest and the trusted key

**Files:**
- Replace: `crates/aji-manager/manifest/manifest.json` (Task 4's sample copy).
- Modify: `crates/aji-manager/src/manifest/keys.rs`.

- [ ] **Step 1: The bundled manifest.** Run `cargo run --release -p aji-manifest-tool -- generate --out crates/aji-manager/manifest/manifest.json`. It reads only APIs, pages, `HEAD` answers, NVIDIA's JSON files and the licence texts, well under 1 MB in all. Expected:
  - for v1.18.1 windows-x64, the 11 engines of Task 9's allow-list test;
  - the metal engine from Task 10's release;
  - the two NVIDIA runtime sets, with the CUDA 13.2 set's archives summing to 1950349675 bytes;
  - 8 main networks, each with an `md5:` digest, plus the human SL network;
  - a file of 1 MiB or less.
- [ ] **Step 2: The trusted key.** `TRUSTED_KEYS` gets the base64 line of `keys/aji-manifest.pub`.
  - Test `trusted_keys_decode`: `trusted_keys().len() == 1`.
  - `bundled_manifest_parses` is extended to `bundled_manifest_covers_phase_1`: at least one engine each for windows-x64 cuda, windows-x64 directml, macos-arm64 metal and linux-x64 eigenavx2; exactly 8 main networks; and 2 runtimes.
- [ ] **Step 3: Run** `cargo test --workspace`. Expected: PASS. Run `cargo run -p aji-manager --bin aji-setup-report`. Expected: Task 13's Mac values.
- [ ] **Step 4: Commit**

```bash
git add crates/aji-manager/manifest/manifest.json crates/aji-manager/src
git commit -m "feat(manager): bundle the first real manifest and trust the manifest key"
```

### Task 12: The PC benchmark script (S3, PC half)

**Files:**
- Create: `scripts/benchmark-windows.ps1`.

**Interfaces:**
- Consumes: the bundled manifest from Task 11, copied next to the script. It is the single source of URLs and hashes.
- Produces: `powershell -ExecutionPolicy Bypass -File .\benchmark-windows.ps1 [-Network <id>...]` writes `aji-benchmarks\<engine-id>\<network>.{stdout,stderr}.txt` and `aji-benchmarks\summary.json`.
  - **Engines.** For the newest version it downloads and verifies (SHA-256 against the manifest) the cuda13.2, cuda12.8, directml and opencl Windows engines.
  - **Runtimes.**
    - It prints each NVIDIA licence name, URL and notice from the manifest, and continues only after the owner types `accept`.
    - It then downloads each component's whole archive, checks its digest against the manifest, and extracts the `extract` names into `aji-benchmarks\runtimes\<set>\`.
  - **Networks.** The default is rows 1, 3 and 7 of the network table.
  - **Runs.** Each run prepends the runtime folder to the child's `PATH` only, then runs `katago.exe benchmark -config <generated gtp config with onnxProvider where needed> -model <net> -v 800`.
  - Nothing is written outside `aji-benchmarks\`, and no system setting changes.
- Untestable on the Mac. Each section reports and continues on failure, like the capture script.

- [ ] **Step 1: Write the script.**
- [ ] **Step 2: Check it parses**, if `pwsh` is installed: `pwsh -NoProfile -Command '$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile("scripts/benchmark-windows.ps1", [ref]$null, [ref]$e); $e'` prints nothing. Otherwise read it through. Installing `pwsh` needs the owner's OK.
- [ ] **Step 3: Commit, and send the script and the manifest to the owner** to run when convenient.

```bash
git add scripts/benchmark-windows.ps1
git commit -m "chore: add a Windows script that benchmarks every NVIDIA backend"
```

- [ ] **Step 4: When results arrive**, add the outputs as fixtures. Update the NVIDIA defaults if CUDA is not the fastest, or if cuda12.8 beats cuda13.2 on the 5070. Record them in R4's place in the roadmap. If they arrive after M3 closes, this moves to M4.

### Task 13: Exit check and docs

- [ ] **Step 1: The Mac.** Run `cargo run --release -p aji-manager --bin aji-setup-report`. Expected:
  - Apple M5, `apple_gpu_cores` 10, `memory_bytes` 25769803776, 10 cores, and an OS version containing `27.2`;
  - `default: "metal"`;
  - versions `["1.18.2"]`;
  - the 8 networks in Elo order, with `kata1-tf3-b11c768-s12382M-d6533M` preselected;
  - the manifest `source: "bundled"`.
- [ ] **Step 2: The PC from its capture.** On the Mac, run `aji-setup-report --windows-capture crates/aji-manager/tests/fixtures/hardware/windows-pc/aji-hardware-capture.json`. Expected: the RTX 5070 with its real driver and capability; cuda (cuda13.2) default, then directml and opencl, if the driver is 580 or newer. On the PC itself, the owner may run the same command from a `cargo` build, or defer to M8 as in M1 and M2.
- [ ] **Step 3: Charter table tests.** `cargo test -p aji-manager --test recommend_table` passes, and every row of charter 6.3 has a test.
- [ ] **Step 4: The app still works.**
  - Build with `pnpm tauri build --bundles app`, then open `Aji.app`.
  - M2's analysis still runs.
  - The log line `aji: manifest bundled sequence <n>` appears. The fetch fails with 404 until Step 6.
- [ ] **Step 5: Docs.**
  - Mark M3 done in this plan and in the roadmap, with what was checked.
  - Propose to the owner the edits to charter 6.3's table, from R1, NVIDIA's CUDA 13 notes and S3. Edit the charter only once they agree.
  - Commit `docs: mark M3 manifest, hardware detection and recommendation done`.
- [ ] **Step 6: After the owner merges into `main`:**
  - With the owner's OK, run `gh workflow run manifest.yml -R reallxuan/aji-manifest -f aji_ref=main`.
  - On the Mac, `aji-setup-report --fetch` gives `source: "fetched"` with a sequence above the bundled one.
  - Changing one byte of the cached file makes the next run fall back to `bundled`.
  - The `main` push run is the Windows check for Task 0 and for the DXGI code. Read `force_quit_leaves_no_engine` and `starts_from_a_folder_with_cjk_and_spaces` in its Windows log.

## Deferred items carried

- To M4 and M5: R1 section 6.1's first run on NVIDIA. DirectML (23.6 MB) is installed first so analysis starts within a minute or two. The CUDA runtime downloads behind it, and Aji switches once CUDA passes its benchmark and smoke test. M3's recommendation already lists both. The install order and the switch belong to the pipeline and the wizard.
- To M4: verifying `md5:` and `sha256:` digests while streaming (with `md-5` and `sha2`), extracting an NVIDIA archive's `extract` names, and `zip` with `deflate` only (Global Constraints, Dependencies).
- To M4: from M2's review, a deadline after killing an unkillable KataGo, startup-timeout tuning, and a throttle tolerance (admit at about 90% of the report interval). From M3, the downloader, unpacking, the benchmark parser (fixtures from Task 9), config generation (`config` overrides from the manifest) and the licence-acceptance record.
- S3 on the PC (Task 12) measures backends (which CUDA build, and CUDA against DirectML on the RTX 5070: charter risk R4), never networks. Network choice follows the published Elo. The owner may drop Task 12 if R4 is not worth measuring.
- Kept open with the owner: M1's deferred findings 1, 2, 3, 6, 7, 8 and 11; audit proposals G2 to G12 and X1; and M2's proposed values (Chinese rules with komi 7.5, the 100,000-visit cap, the 60 s stall timeout, and the `engine-error` colours).
