# R1: May Aji download NVIDIA's runtime libraries for the user?

- **Charter item:** risk R1 (section 9), backend table (section 6.3). Roadmap research item S1 in M0.
- **Question:** may Aji, a desktop app, download NVIDIA's runtime libraries on the user's behalf, so that KataGo's CUDA and TensorRT builds run without the user installing anything by hand?
- **Researched:** 2026-11-19. Every source was fetched on that date. Licence texts were read in full from NVIDIA's own pages and from the `LICENSE` files inside NVIDIA's archives. Nothing here relies on memory.

> This is an engineering reading of the licence texts, not legal advice.

## Answer in brief

| Scenario | Verdict | Why |
|---|---|---|
| **(a)** Aji downloads the files from NVIDIA's servers at the user's request | **Allowed with conditions** (low risk) | Aji distributes nothing. The user receives the files from NVIDIA and is the licensee, and the licences let a licensee install and use them. Aji must show NVIDIA's licences and get the user's explicit acceptance before downloading. |
| **(b)** Aji re-hosts the files on GitHub Releases or a mirror | **Allowed with conditions** (medium risk) | The files are on NVIDIA's distributable lists, and Aji with KataGo is an application that adds real functionality. The weak point is that NVIDIA allows distribution only as part of an application. A public archive holding nothing but NVIDIA DLLs looks like stand-alone distribution, which the CUDA EULA forbids. |

**Scenario (b) is not needed for mainland China.** NVIDIA serves the same paths from its own China domain, `developer.download.nvidia.cn`, on a separate CDN. So scenario (a) covers both NVIDIA hosts.

**Recommendation.** Keep **CUDA with the runtime fetched by Aji from NVIDIA** as the default NVIDIA backend on Windows. Use the `.cn` host as the fallback. Do not re-host. During the first run, use **DirectML (self-contained, 23.6 MB)** so the user can start analysing while the CUDA runtime (about 0.84 GB) downloads. Switch to CUDA once the post-install benchmark passes. TensorRT stays an advanced option. Details are in section 6.

---

## 1. What the KataGo Windows packages need

KataGo's release notes only tell NVIDIA users to install CUDA plus either cuDNN or TensorRT. They do not list DLL names. To get the exact list, I downloaded the official Windows packages from the KataGo releases page and parsed the PE import table of each `katago.exe`, without running it. For libraries that NVIDIA loads at runtime through `LoadLibrary`, I relied on NVIDIA's documentation and on the import tables and strings of the NVIDIA DLLs.

None of the packages bundles any NVIDIA DLL. They bundle only the MSVC runtime, OpenSSL, zlib, libzip and similar libraries. In every CUDA and TensorRT build, the CUDA runtime (cudart) is linked statically: `katago.exe` imports no `cudart64_*.dll`. The NVIDIA display driver provides `nvcuda.dll`.

### 1.1 CUDA + cuDNN packages (KataGo v1.18.2, the newest CUDA release)

| KataGo package | Imported by `katago.exe` | Loaded at runtime by those DLLs |
|---|---|---|
| `katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64.zip` (9.8 MB) | `cublas64_13.dll`, `cudnn64_9.dll`, `nvrtc64_130_0.dll` | `cublasLt64_13.dll` (imported by `cublas64_13.dll`). `nvrtc-builtins64_132.dll` (named inside `nvrtc64_130_0.dll`). The cuDNN sub-libraries `cudnn_graph64_9.dll`, `cudnn_ops64_9.dll`, `cudnn_cnn64_9.dll`, `cudnn_adv64_9.dll`, `cudnn_engines_precompiled64_9.dll`, `cudnn_engines_runtime_compiled64_9.dll`, `cudnn_engines_tensor_ir64_9.dll`, `cudnn_heuristic64_9.dll` and `cudnn_ext64_9.dll`. |
| `katago-v1.18.2-cuda12.8-cudnn9.8.0-windows-x64.zip` (10.2 MB) | `cublas64_12.dll`, `cudnn64_9.dll`, `nvrtc64_120_0.dll` | `cublasLt64_12.dll`, `nvrtc-builtins64_128.dll`, and the cuDNN 9.8 sub-libraries (the same set without `tensor_ir` and `ext`) |

NVIDIA's cuDNN guide confirms that on Windows cuDNN calls `LoadLibraryA()` at runtime for `cublasLt*.dll` and `nvrtc*.dll`. KataGo needs both libraries anyway.

The release also contains cuda12.1 and cuda12.5 builds, and cuDNN 8.9.7 builds. KataGo itself says the cuDNN 8.9.7 builds are much slower on transformer networks, so Aji should not offer them.

### 1.2 TensorRT packages (KataGo v1.18.1, the newest TensorRT release)

| KataGo package | Imported by `katago.exe` | Loaded at runtime |
|---|---|---|
| `katago-v1.18.1-trt10.16.1-cuda13.2-windows-x64.zip` (8.5 MB) | `nvinfer_10.dll`, `nvonnxparser_10.dll` | One builder resource per GPU architecture. For the RTX 50 series (sm_120) that is `nvinfer_builder_resource_sm120_10.dll`. `nvinfer_10.dll` also names `nvrtc64_130_0.dll`. |
| `katago-v1.18.1-trt10.9.0-cuda12.8-windows-x64.zip` (8.4 MB) | `nvinfer_10.dll`, `nvonnxparser_10.dll` | `nvinfer_builder_resource_10.dll` (one file covering every architecture) |

Since TensorRT 10.16, NVIDIA splits the builder resource by architecture and loads only the one for the device in use. A separate `_ptx_` resource is used only for hardware-compatible engines. All TensorRT builds need TensorRT 10, because the DLL names carry `_10`.

### 1.3 DirectML package

`katago-v1.18.1-onnx1.24.4-directml-windows-x64.zip` is 23.6 MB. It is self-contained: `DirectML.dll`, `onnxruntime.dll` and its other dependencies are inside the zip. It needs no NVIDIA download.

### 1.4 Download sizes

The figures below are the compressed sizes of the needed DLL members inside NVIDIA's zip archives. I read them from each archive's central directory. "Full archive" is what a user would download if they fetched the whole zip. NVIDIA's servers accept HTTP Range requests, and I used them to read these listings and to extract single members, so Aji can download only the DLLs it needs.

| Runtime set | Components (version) | DLL download | On disk | Full archives |
|---|---|---|---|---|
| **CUDA 13.2 set** (for KataGo `cuda13.2-cudnn9.24.0`) | cuBLAS 13.4.1.3 (from CUDA 13.2.2): `cublas64_13` 47.5 MB + `cublasLt64_13` 340.3 MB. NVRTC 13.2.86: 39.7 MB. cuDNN 9.24.0.43 cuda13: 409.8 MB | **≈ 837 MB** | ≈ 1.18 GB | 388 MB + 288 MB + 1,274 MB ≈ 1.95 GB |
| **CUDA 12.8 set** (for KataGo `cuda12.8-cudnn9.8.0`) | cuBLAS 12.8.4.1 (from CUDA 12.8.1): `cublas64_12` 86.8 MB + `cublasLt64_12` 476.5 MB. NVRTC 12.8.93: 36.5 MB. cuDNN 9.8.0.87 cuda12: 674.9 MB | **≈ 1.27 GB** | ≈ 1.89 GB | 564 MB + 306 MB + 675 MB ≈ 1.54 GB |
| **TensorRT 10.16.1, CUDA 13.2, RTX 50 only** | `nvinfer_10` 192.8 MB + `builder_resource_sm120` 235.0 MB + `nvonnxparser_10` 1.3 MB (add NVRTC's 39.7 MB if `nvinfer` turns out to need it) | **≈ 430 MB** | ≈ 0.64 GB | 1.94 GB |
| **TensorRT 10.9.0, CUDA 12.8** | `nvinfer_10` 232.2 MB + `builder_resource_10` 1,374.6 MB + `nvonnxparser_10` 1.2 MB | **≈ 1.61 GB** | ≈ 2.42 GB | 1.85 GB |
| DirectML (for comparison) | the whole KataGo package | **23.6 MB** | | |

Minimum drivers, from NVIDIA's CUDA release notes: CUDA 13.x needs an R580 or newer driver. CUDA 12.8 Update 1 lists Windows driver 572.61 or newer. Choosing between these builds for the RTX 5070 is part of R4.

---

## 2. Licence texts read

| Licence | Version | Where read | Also checked against |
|---|---|---|---|
| CUDA Toolkit EULA (SDK licence plus CUDA Supplement, Attachments A and B) | "Last updated: January 26, 2026" (docs for CUDA 13.5) | https://docs.nvidia.com/cuda/eula/index.html | The `LICENSE` file inside `cuda_nvrtc-windows-x86_64-13.2.86-archive.zip`, which carries the same date and the same Attachment A. The stand-alone file at `.../cuda/redist/libcublas/LICENSE.txt` is an older version (January 12, 2024) with the same distribution clauses. |
| cuDNN Software License Agreement (SDK licence plus cuDNN Supplement) | v. February 22, 2022 | https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html | The `LICENSE` inside `cudnn-windows-x86_64-9.24.1.1_cuda13-archive.zip`, and `https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/LICENSE.txt` (also served from the `.cn` host). All three match. |
| TensorRT licence, documentation version (SDK licence plus TensorRT Supplement) | SDK licence v. May 24, 2021; supplement v. February 25, 2021 | https://docs.nvidia.com/deeplearning/tensorrt/latest/reference/sla.html | The "I Agree" checkbox on https://developer.nvidia.com/tensorrt/download/10x links here, through https://docs.nvidia.com/deeplearning/tensorrt/sla/. The official TensorRT zip contains **no** licence file, only `doc/Acknowledgements.txt` with third-party notices. |
| TensorRT licence, **PyPI wheel version** | NVIDIA Software License Agreement plus "TensorRT Supplement" section 12 | `tensorrt_cu13_libs-10.16.1.11.dist-info/LICENSE.txt` inside https://pypi.nvidia.com/tensorrt-cu13-libs/ | This is a **different and narrower** licence. See section 3.5. |

## 3. What the licences say

All three NVIDIA products use the same core text, the "License Agreement for NVIDIA Software Development Kits". Section numbers below are CUDA's. cuDNN and TensorRT number the same clauses 1.1, 1.2 and 2.x.

The deciding clauses are paraphrased below with their section numbers, with one verbatim quote. The full texts are at the URLs in section 2.

### 3.1 Grant (CUDA §1.1.1; cuDNN and TensorRT §1.1)

The licensee may install and use the SDK. The licensee may also distribute the portions identified as distributable, provided they are incorporated in object-code form into a software application that meets the distribution requirements.

### 3.2 Distribution requirements (CUDA §1.1.2; cuDNN and TensorRT §1.2)

1. The application must have material additional functionality beyond the NVIDIA portions.
2. Only the licensee's application may access the distributed NVIDIA portions.
3. The terms under which the application is distributed must be consistent with NVIDIA's agreement, including its grant, its restrictions and its protection of NVIDIA's intellectual property. The distributor must also protect users' privacy, security and legal rights.
4. The distributor must notify NVIDIA of known non-compliant distribution and enforce its own agreements.

### 3.3 Limitations (CUDA §1.2; cuDNN and TensorRT §2)

- Copyright and proprietary notices may not be removed.
- Nothing may be distributed except as the agreement expressly allows. CUDA §1.2 adds: **"you may not distribute or sublicense the SDK as a stand-alone product."**
- An application may not be presented as sponsored or endorsed by NVIDIA.
- Encryption, security, DRM and authentication mechanisms **in the SDK** may not be bypassed.
- The SDK may not be used in a way that would make it subject to an open-source licence, for example one that requires disclosing source or redistributing free of charge.

### 3.4 What is distributable

- **CUDA, Attachment A (§2.6).** Files that may be shipped with applications. For Windows the list includes `cudart.dll`, `cublas.dll`, `cublasLt.dll`, `nvrtc.dll` and `nvrtc-builtins.dll`, among others. Attachment A says that variants with a version or architecture in the file name are covered; its example is `cudart64_90.dll`. So `cublas64_13.dll`, `cublasLt64_13.dll`, `nvrtc64_130_0.dll` and `nvrtc-builtins64_132.dll` are distributable.
- **cuDNN Supplement §2.** The runtime `.so` and `.dll` files are distributable.
- **TensorRT Supplement §2 (documentation version).** The runtime `.so` and `.dll` files are distributable.

### 3.5 TensorRT: the PyPI wheel carries a narrower licence

The TensorRT Windows wheels on `pypi.nvidia.com` ship the older NVIDIA Software License Agreement. Its §12.1 permits distributing only the `libnvinfer` and `libnvinfer_plugin` libraries, in binary form, as part of the distributor's own product. The distributor must require its customers to accept terms at least as restrictive. Under that text, `nvonnxparser_10.dll`, which KataGo imports, is not clearly covered, and §12.2 adds yearly licence terms. **If TensorRT is ever re-hosted, take it from the official zip, which the documentation-version SLA governs, not from the wheel.**

### 3.6 Acceptance and access

- **Acceptance by downloading.** Each licence says that a person who does not accept it should not download, install or use the SDK. Only an adult of legal age can accept it.
- **CUDA and cuDNN redist servers.** `developer.download.nvidia.com/compute/cuda/redist/` and `.../cudnn/redist/` are plain public directory listings with JSON manifests. They have no sign-in and no click-through. Each archive contains its `LICENSE` file.
- **TensorRT.** The download page asks the visitor to tick an agreement box. The zip URL itself (`developer.nvidia.com/downloads/...`) redirects with a 302 to `developer.download.nvidia.com/...` and downloads without signing in.

### 3.7 Scope and contact

- **Scope.** CUDA §2.1, cuDNN §4.1 and TensorRT §1 license the SDK for developing applications that run only on systems with NVIDIA GPUs.
- **Contact.** When the distribution terms do not fit, all three licences invite questions to `nvidia-compute-license-questions@nvidia.com` (CUDA §2.5, cuDNN §3, TensorRT §3).

---

## 4. Scenario (a): Aji downloads from NVIDIA's servers

**Verdict: allowed with conditions.**

**Why it is allowed**

- **Aji distributes nothing.** NVIDIA delivers the files to the user, and the user becomes the licensee under the install-and-use grant (§1.1.1). Running KataGo with the files is ordinary use. This is the same position as every KataGo user today who follows KataGo's instructions to install CUDA and cuDNN. The only difference is that Aji performs the download.
- **No clause forbids it.** None of the licences prohibits a tool from fetching the files on the user's instruction.
- **Nothing is circumvented.** The redist paths have no access control. The anti-circumvention clause in §1.2 concerns mechanisms in the SDK itself, not a web page.

**Conditions**

1. **Get explicit consent before the first NVIDIA download.** Show a screen that names each component, its size and its licence, links to the licence text (section 2) and has an unticked "I accept the NVIDIA licence terms" control. The licences make acceptance a precondition of downloading, and only an adult can accept, so the wording should say the user confirms they can accept. Record locally which licence versions were accepted and when.
2. **For TensorRT, present the TensorRT SLA in the same way.** NVIDIA's download page gates TensorRT behind an agreement checkbox. Aji must not use the direct URL as a way around that step.
3. **Download only from NVIDIA hosts.** Use `developer.download.nvidia.com` as the primary host and `developer.download.nvidia.cn`, NVIDIA's own China host with the same paths, as the fallback. On 2026-11-19 the `.cn` host returned the same JSON manifests (identical byte counts), archives (identical sizes) and licence files, accepted Range requests, and was served by a different CDN (`Zen/4.3`) through Hong Kong and Singapore edge nodes. Its speed from inside mainland China is **not verified** and should be tested on a mainland connection.
4. **Do not modify the files.** Verify SHA-256 checksums (section 7). Install into Aji's private per-user runtime folder. Do not add that folder to the system `PATH` and do not copy files into `System32`. Section 6.3 explains how KataGo finds the DLLs.
5. **Do not imply NVIDIA endorsement.** Label the component as "NVIDIA CUDA runtime libraries, provided by NVIDIA under NVIDIA's licence". Do not use NVIDIA logos.
6. **Keep NVIDIA files outside Aji's AGPL distribution.** Never put them in the Aji installer or the source tree. Aji's "About / third-party components" page lists them separately and states that Aji's AGPL licence does not cover them. KataGo runs as a separate process, and the Aji code (AGPL) never links the NVIDIA libraries, so this is mere aggregation and does not trigger the open-source clause in §1.2.

**Residual uncertainty.** The scope clause speaks of "developing applications". An end user who only runs KataGo is not developing anything. NVIDIA has published these openly downloadable runtime archives for years (the CUDA redist manifests go back to CUDA 11.5), and KataGo's documented instructions already put users in this position, so the risk is low. The licences' export-control clause applies to the user as it does to any NVIDIA download. It was not analysed further here.

---

## 5. Scenario (b): Aji re-hosts the files on GitHub Releases or a mirror

**Verdict: allowed with conditions, medium risk.** Not recommended while scenario (a) works.

**Who would be the distributor.** The Aji maintainer distributes the files. The maintainer must accept the licences personally and becomes bound by every distribution requirement in section 3.2.

**What supports it**

- Every needed DLL is on a distributable list (section 3.4).
- Aji together with KataGo clearly has material additional functionality.

**The weak point.** NVIDIA's grant covers distribution only as part of a software application, and CUDA §1.2 forbids stand-alone distribution. A public GitHub release asset or mirror archive that holds only NVIDIA DLLs can be downloaded by anyone without Aji. That looks like stand-alone distribution. Arguing that it is merely a component of Aji is plausible but untested.

**Precedent, not permission.** llama.cpp attaches `cudart-llama-bin-win-cuda-13.5-x64.zip` (426 MB, containing the CUDA runtime and cuBLAS) to every GitHub release; release b12532 was checked on 2026-11-19. This shows the practice is common and that NVIDIA has tolerated it. It does not show that NVIDIA permits it.

**Conditions if (b) is ever adopted**

1. The maintainer accepts each licence and keeps a record of having done so.
2. Ship only distributable runtime DLLs:
   - **CUDA:** `cublas64_*`, `cublasLt64_*`, `nvrtc64_*` and `nvrtc-builtins64_*`. No static libraries, headers or tools.
   - **cuDNN:** the runtime `.dll` files.
   - **TensorRT:** the runtime `.dll` files from the official zip, never from the PyPI wheel (section 3.5).
3. Ship the binaries byte-for-byte unmodified. Include each archive's `LICENSE` file. For TensorRT, include the text of the documentation SLA (the zip has no licence file) and `doc/Acknowledgements.txt`.
4. Name and describe the asset as an Aji component, for example "Aji runtime pack for KataGo CUDA builds", not as "CUDA for Windows". Only Aji should fetch it. Keep it out of the AGPL source release and state that the AGPL does not cover it.
5. Show NVIDIA's terms in Aji and have the user accept them before download, exactly as in scenario (a). This is how Aji keeps its distribution terms consistent with NVIDIA's (§1.1.2, item 3).
6. Install into Aji's private folder so that only Aji's KataGo uses the files (§1.1.2, item 2).
7. Before shipping, ask NVIDIA for written confirmation at `nvidia-compute-license-questions@nvidia.com`. The licences invite exactly this question.

**Third-party Chinese mirrors.** NVIDIA publishes its runtimes on PyPI as wheels (for example `nvidia-cudnn-cu13` 9.28.1.4 has a 407 MB `win_amd64` wheel), and mainland PyPI mirrors carry copies of them. In that case the mirror operator, not NVIDIA, is the distributor. Wheel versions also do not line up exactly with KataGo's builds; for example, current `nvidia-cublas` releases have no Windows wheel. Aji should not use these mirrors as a primary source.

---

## 6. Recommendation

### 6.1 Default NVIDIA backend on Windows

Use **CUDA + cuDNN, with the runtime fetched by Aji from NVIDIA's servers (scenario a)**. Use `developer.download.nvidia.cn` as the automatic fallback host, and do not re-host anything.

- **RTX 50 series, or any card whose driver is R580 or newer.** Use the KataGo `cuda13.2-cudnn9.24.0` package with the CUDA 13.2 set: cuBLAS 13.4.1.3 from CUDA 13.2.2, NVRTC 13.2.86 and cuDNN 9.24.0.43 cuda13. This is about **0.84 GB**.
- **Older driver (572.61 to 579.x).** Use `cuda12.8-cudnn9.8.0` with cuBLAS 12.8.4.1, NVRTC 12.8.93 and cuDNN 9.8.0.87 cuda12. This is about **1.27 GB**. Alternatively, ask the user to update the driver and use the smaller CUDA 13.2 set. R4 decides between the two.
- **First run.** Bootstrap with **DirectML**: download and verify the 23.6 MB DirectML package first, so the first analysis appears within a minute or two. Download the CUDA runtime in the background. When it is ready, run the post-install benchmark and smoke test (charter section 6.3), then switch the default to CUDA and tell the user.
- **Fallback.** Keep DirectML as the fallback if the user declines the NVIDIA licence, the download fails, or the CUDA benchmark fails.
- **TensorRT** stays an **advanced option**. It adds about 430 MB for the sm_120-only subset of 10.16.1, or about 1.6 GB for 10.9.0, and has a longer start-up. KataGo's own notes say CUDA + cuDNN is usually faster on transformer networks with recent GPUs.

**Why not make DirectML the default and CUDA the advanced option.** That would also be licence-clean and needs no NVIDIA download. However, it leaves NVIDIA users on the path KataGo describes as a fallback for when native backends do not work. R1 found no licence obstacle to CUDA, so the charter's original plan stands. The R4 benchmarks on the RTX 5070 can still overturn this on performance grounds.

### 6.2 Charter impact

- **R1 is resolved.** Downloading the runtime from NVIDIA with in-app licence acceptance is permitted.
- **Section 6.3 table.** The NVIDIA row stays "CUDA, with the runtime downloaded by Aji". Add "from NVIDIA's servers, after in-app acceptance of NVIDIA's licence".
- **M4** downloads the CUDA runtimes, from NVIDIA directly. The manifest repository never hosts NVIDIA binaries.

### 6.3 Implementation notes for M3 and M4

- **Download DLL members only, through HTTP Range requests.** For cuDNN 9.24.0 cuda13 that is 410 MB instead of the 1,274 MB archive. NVIDIA's archive SHA-256 then cannot be checked, so the manifest must carry a SHA-256 for every extracted DLL. The maintainer computes these once, from an archive whose NVIDIA checksum has been verified. Aji checks each member's zip CRC32 and the manifest SHA-256. If a Range request fails, fall back to downloading the whole archive and checking NVIDIA's checksum.
- **Let KataGo find the DLLs without changing the system.** Put the runtime set in one shared folder, for example `<app data>/runtimes/nvidia/cuda13.2-cudnn9.24.0/`. Start `katago.exe` with that folder prepended to the child process's own `PATH`. Do not change the system `PATH`. cuDNN finds its sub-libraries, `cublasLt` and `nvrtc` with plain `LoadLibrary` calls, so they must sit together in that folder. The alternative is to copy the set next to each KataGo version's `katago.exe`, which duplicates about 1 GB per version.
- **Pin exact versions in the manifest.** Do not resolve "latest" from NVIDIA's JSON. Within a CUDA major version the DLL names stay the same, but `nvrtc-builtins64_1xy.dll` changes name with every minor version and must come from the same NVRTC archive as `nvrtc64_*.dll`.
- **Possible size cut, untested.** KataGo may never load some cuDNN sub-libraries, such as `cudnn_adv64_9.dll` (102 MB, used for RNN and legacy attention). Leaving them out is worth testing during R4. Until then, ship the whole set.

---

## 7. What the manifest must record

For each NVIDIA runtime set:

- **Identity.** A set id, the KataGo package ids that use it, and the NVIDIA DLL names those packages import (section 1).
- **Per component:**
  - product (CUDA Toolkit, cuDNN or TensorRT), component name and exact version;
  - platform;
  - NVIDIA's own manifest URL, for example `https://developer.download.nvidia.com/compute/cuda/redist/redistrib_13.2.2.json`;
  - the archive's relative path, size and NVIDIA SHA-256, copied from that JSON.
- **URLs.**
  - Primary: `https://developer.download.nvidia.com/compute/...`.
  - China: `https://developer.download.nvidia.cn/compute/...`.
  - No third-party URLs. If scenario (b) is ever adopted, mirror URLs must be flagged `rehosted: true`, with the licence basis recorded.
- **Members to extract.** The archive path of each member, its unpacked size and its SHA-256.
- **Licence:**
  - name and version or date, for example "CUDA Toolkit EULA, last updated 2026-01-26";
  - the web URL of the licence text, and the path of the licence file inside the archive;
  - the SHA-256 of the exact text shown to the user;
  - `requires_acceptance: true`.
- **Notice text to display**, for example: "NVIDIA cuBLAS 13.4.1.3, © NVIDIA Corporation. Licensed under the NVIDIA CUDA Toolkit EULA. Not covered by Aji's AGPL licence." Also a pointer to the third-party notices, such as cuDNN's bundled open-source notices and TensorRT's `doc/Acknowledgements.txt`.
- **Requirements.** The minimum Windows driver version (R580 for CUDA 13.x; 572.61 for CUDA 12.8 Update 1), and GPU architecture filters where relevant (TensorRT `builder_resource_sm120`).

Aji itself stores, outside the manifest, which licence versions the user accepted and when. When a licence's SHA-256 changes, Aji asks for acceptance again.

Example entry, abbreviated:

```json
{
  "id": "nvidia-cuda13.2-cudnn9.24.0-win-x64",
  "usedBy": ["katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64"],
  "minDriver": { "windows": "580" },
  "components": [
    {
      "product": "CUDA Toolkit",
      "name": "libcublas",
      "version": "13.4.1.3",
      "nvidiaManifest": "https://developer.download.nvidia.com/compute/cuda/redist/redistrib_13.2.2.json",
      "archive": {
        "path": "compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-13.4.1.3-archive.zip",
        "size": 388113288,
        "sha256": "bc6f590490134f4dbe29672b72e536c44362cc5f738a0f7e48c8c3c141e9b24a"
      },
      "hosts": ["https://developer.download.nvidia.com/", "https://developer.download.nvidia.cn/"],
      "members": [
        { "path": "libcublas-windows-x86_64-13.4.1.3-archive/bin/x64/cublas64_13.dll", "size": 51572848, "sha256": "91200c2ff57b8477e94254a4501030d75e1bb35a2de3a476e7ab66df897cb046" },
        { "path": "libcublas-windows-x86_64-13.4.1.3-archive/bin/x64/cublasLt64_13.dll", "size": 455685232, "sha256": "<computed by maintainer>" }
      ],
      "licence": {
        "name": "NVIDIA CUDA Toolkit EULA",
        "version": "2026-01-26",
        "url": "https://docs.nvidia.com/cuda/eula/index.html",
        "fileInArchive": "libcublas-windows-x86_64-13.4.1.3-archive/LICENSE",
        "textSha256": "<sha256 of the text shown>",
        "requiresAcceptance": true
      }
    }
  ]
}
```

The sizes and the `cublas64_13.dll` hash above are real values, read on 2026-11-19 from NVIDIA's archive through a Range request. The other placeholders are computed when the manifest is built.

---

## 8. Sources

All sources were accessed on **2026-11-19**.

### Licences

- CUDA Toolkit EULA: https://docs.nvidia.com/cuda/eula/index.html
- cuDNN Software License Agreement: https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html
- TensorRT licence (documentation version): https://docs.nvidia.com/deeplearning/tensorrt/latest/reference/sla.html (also served at https://docs.nvidia.com/deeplearning/tensorrt/sla/)
- TensorRT licence (wheel version), the `LICENSE.txt` inside https://pypi.nvidia.com/tensorrt-cu13-libs/tensorrt_cu13_libs-10.16.1.11-py3-none-win_amd64.whl
- CUDA licence file on the redist server: https://developer.download.nvidia.com/compute/cuda/redist/libcublas/LICENSE.txt
- cuDNN licence files on the redist servers: https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/LICENSE.txt and https://developer.download.nvidia.cn/compute/cudnn/redist/cudnn/LICENSE.txt

### NVIDIA download servers and manifests

- CUDA redist index: https://developer.download.nvidia.com/compute/cuda/redist/
- CUDA manifests: https://developer.download.nvidia.com/compute/cuda/redist/redistrib_13.2.2.json and https://developer.download.nvidia.com/compute/cuda/redist/redistrib_12.8.1.json
- cuDNN redist index: https://developer.download.nvidia.com/compute/cudnn/redist/
- cuDNN manifests: https://developer.download.nvidia.com/compute/cudnn/redist/redistrib_9.24.0.json and https://developer.download.nvidia.com/compute/cudnn/redist/redistrib_9.8.0.json
- China host, same paths: https://developer.download.nvidia.cn/compute/cuda/redist/redistrib_13.2.2.json and https://developer.download.nvidia.cn/compute/cudnn/redist/redistrib_9.24.1.json
- Archives whose contents were listed:
  - `https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-13.4.1.3-archive.zip`
  - `.../libcublas-windows-x86_64-12.8.4.1-archive.zip`
  - `.../cuda_nvrtc/windows-x86_64/cuda_nvrtc-windows-x86_64-13.2.86-archive.zip`
  - `.../cuda_nvrtc-windows-x86_64-12.8.93-archive.zip`
  - `.../cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-13.2.86-archive.zip`
  - `https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/windows-x86_64/cudnn-windows-x86_64-9.24.0.43_cuda13-archive.zip`
  - `.../cudnn-windows-x86_64-9.24.1.1_cuda13-archive.zip`
  - `.../cudnn-windows-x86_64-9.8.0.87_cuda12-archive.zip`
  - `.../cudnn-windows-x86_64-9.28.1.4_cuda12-archive.zip`
- TensorRT download page: https://developer.nvidia.com/tensorrt/download/10x
- TensorRT zips:
  - https://developer.nvidia.com/downloads/compute/machine-learning/tensorrt/10.16.1/zip/TensorRT-10.16.1.11.Windows.amd64.cuda-13.2.zip, which redirects to `developer.download.nvidia.com/...`
  - https://developer.download.nvidia.com/compute/machine-learning/tensorrt/10.9.0/zip/TensorRT-10.9.0.34.Windows.win10.cuda-12.8.zip

### NVIDIA documentation

- cuDNN runtime dependencies: https://docs.nvidia.com/deeplearning/cudnn/installation/latest/build-run-cudnn.html
- CUDA release notes, minimum driver versions: https://docs.nvidia.com/cuda/cuda-toolkit-release-notes/index.html

### KataGo

- Release API: https://api.github.com/repos/lightvector/KataGo/releases
- Release v1.18.2: https://github.com/lightvector/KataGo/releases/tag/v1.18.2
- Release v1.18.1: https://github.com/lightvector/KataGo/releases/tag/v1.18.1
- Release v1.18.0: https://github.com/lightvector/KataGo/releases/tag/v1.18.0
- Packages inspected:
  - https://github.com/lightvector/KataGo/releases/download/v1.18.2/katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64.zip
  - https://github.com/lightvector/KataGo/releases/download/v1.18.2/katago-v1.18.2-cuda12.8-cudnn9.8.0-windows-x64.zip
  - https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-trt10.16.1-cuda13.2-windows-x64.zip
  - https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-trt10.9.0-cuda12.8-windows-x64.zip
  - https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-onnx1.24.4-directml-windows-x64.zip

### Precedent and alternatives

- llama.cpp release b12532: https://github.com/ggml-org/llama.cpp/releases/tag/b12532
- NVIDIA PyPI packages: https://pypi.org/pypi/nvidia-cudnn-cu13/json and https://pypi.org/pypi/nvidia-cublas/json

## Method notes

- **Import tables.** Read with a small PE parser in the scratchpad, applied to the files inside the downloaded zips. No binary was executed.
- **Archive listings and member extraction.** Done with HTTP Range requests against NVIDIA's servers. Each archive's central directory supplied the member sizes.
- **Licence comparison.** Licence files from inside the archives were compared with the web versions by their "Last updated" or version lines and by their distribution sections.
- **Not done.** No download speed was measured from mainland China. No KataGo build was run against any of these runtimes; that is R4.
