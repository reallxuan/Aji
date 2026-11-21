# Aji

A cross-platform graphical interface for KataGo, for reviewing, analysing and playing Go. Aji aims to supersede [LizzieYzy](https://github.com/yzyray/lizzieyzy): easier to set up, faster, and better looking.

**Status: Phase 1 (v0.1.0): engine setup, opening game records, and live analysis on the board.**

The [v0.1.0 release](https://github.com/reallxuan/Aji/releases/tag/v0.1.0) was checked by hand on Windows (RTX 5070, CUDA) and on macOS (Apple Silicon, Metal): from downloading the installer to analysis on the board, with no command line and no manual download ([acceptance record](docs/acceptance/phase-1.md)). The Linux AppImage is built but has not been checked. The installers are not signed yet, so Windows and macOS each ask once before Aji first opens.

- Platforms: Windows, Linux, macOS; Android and iOS later, as clients of a desktop running the engine
- Engine: KataGo only
- Stack: Tauri 2 (Rust core, TypeScript and React interface)
- Interface languages: Simplified Chinese and English, more later

The project charter (goals, technology choices, feature list, roadmap) is in [docs/superpowers/specs/2026-11-19-aji-project-charter-design.md](docs/superpowers/specs/2026-11-19-aji-project-charter-design.md).

## Build from source

Prerequisites: [Rust](https://rustup.rs) (stable), Node 24 and pnpm 11, plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS. On macOS the Xcode Command Line Tools are enough.

```bash
pnpm install
pnpm tauri dev
```

`pnpm test` runs the interface tests and `cargo test --workspace` the Rust tests. CI runs the checks on every push. It builds installers for Windows, macOS and Linux on every push to `main`, or for any branch from Actions → CI → Run workflow.

## License

Copyright (C) 2026 reallxuan

Aji is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).
