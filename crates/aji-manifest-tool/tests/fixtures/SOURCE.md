# Generator inputs recorded on 2026-11-19

The M3 plan pins values from these snapshots (network Elos, game counts, asset sizes and
digests). The live sources change daily, so tests use these files, not fresh downloads.

- `katago-releases.json`: `https://api.github.com/repos/lightvector/KataGo/releases?per_page=10`,
  kept to v1.17.0 to v1.18.2 and to `tag_name`, `published_at` and each asset's `name`, `size`,
  `digest` and `browser_download_url`.
- `networks.html`: `https://katagotraining.org/networks/`, unedited (960 rows).
- `redistrib_13.2.2.json`: `https://developer.download.nvidia.com/compute/cuda/redist/redistrib_13.2.2.json`,
  kept to the top-level release fields, `libcublas` and `cuda_nvrtc`.
- `redistrib_9.24.0.json`: `https://developer.download.nvidia.com/compute/cudnn/redist/redistrib_9.24.0.json`,
  kept to the top-level release fields and `cudnn`.
