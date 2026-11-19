# M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri 2 desktop app whose CI produces installers for Windows, macOS and Linux. It opens to the main-screen frame, follows the OS theme and language, and shows a version line fetched from the Rust side through the transport layer.

**Architecture:** One Cargo workspace with the Tauri app in `src-tauri`, and one Vite and React frontend in `src`. Every request from the UI goes through a TypeScript `Transport` interface to one Tauri command, `rpc`. The command hands it to a dispatcher, `service::handle`, which does not depend on Tauri, so Phase 3's WebSocket server can reuse it. The Rust message types are the single source: `ts-rs` generates the TypeScript types from them.

**Tech Stack:**
- Rust (stable), Tauri 2, serde, ts-rs.
- Node 24 LTS, pnpm 11.
- React 19, TypeScript, Vite, Tailwind CSS 4, i18next with react-i18next.
- Vitest with Testing Library and jsdom; ESLint 9 with typescript-eslint, react-hooks and eslint-plugin-i18next; Prettier.
- GitHub Actions.

**Specs:**
- [Project charter](../specs/2026-11-19-aji-project-charter-design.md), sections 5, 6.1 and 11.
- [Interface design](../specs/2026-11-19-aji-ui-design.md), sections 2, 3 and 4.
- [Phase 1 roadmap](2026-11-19-phase-1-roadmap.md), sections 3.2 and M1.

## Global Constraints

- **Language.** Everything in the repository is in English. Chinese appears only as interface text: in `src/locales/zh-CN.json`, and in tests that assert the rendered Chinese strings.
- **Interface text.**
  - Every user-visible string goes through i18next.
  - Any string change edits `src/locales/zh-CN.json` and `src/locales/en.json` in the same commit.
  - The product name "Aji" is not translated.
- **Dependency licences.** Only licences compatible with AGPL-3.0-or-later are allowed:
  - MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, LGPL, GPL-3.0.
  - Other permissive licences such as ISC, Zlib, 0BSD, CC0-1.0 and Unicode-3.0.
  - OFL-1.1 for fonts.
  - Never proprietary or non-commercial licences.
- **Protocol.**
  - Transport messages never carry file paths.
  - Errors cross the boundary as `{ code, message }`. The UI shows text looked up from `code`, never `message`.
- **Git.**
  - Work on the branch `feat/m1-foundation`, created from `main`, which includes both specs since the `dev` merge `6067d00`.
  - Conventional Commits.
  - Never commit to `main`. Push and open the pull request only when the owner asks.
- **Toolchain.**
  - `rust-toolchain.toml` with `channel = "stable"` and the `rustfmt` and `clippy` components.
  - Node 24.
  - `"packageManager": "pnpm@11.20.0"` in `package.json`.
  - Dependencies at their latest stable versions at scaffold time; the lockfiles record them.
- **App identity.** `productName` is `Aji`. `identifier` is `io.github.reallxuan.aji` (roadmap decision O3). `version` is `0.1.0`, held only in `package.json`; `tauri.conf.json` points to it and `src-tauri/Cargo.toml` repeats it.
- **Window.** Default 1440 × 900, minimum 1024 × 640, native decorations, title `Aji`.
- **Minimum OS.** Windows 10 1809 x64; macOS 13 on Apple Silicon (`bundle.macOS.minimumSystemVersion = "13.0"`); Ubuntu 22.04 with webkit2gtk 4.1.
- **CI runners.** These labels were checked against `actions/runner-images` on 2026-11-19:
  - Checks run on `ubuntu-24.04`.
  - The AppImage is built on `ubuntu-22.04`, for the oldest glibc. When that label is retired (Ubuntu 26.04 is already listed), the job moves to an `ubuntu:22.04` container on `ubuntu-24.04`.
  - macOS uses `macos-15`, which is arm64. Do not use `macos-14`: it is now an x64 image and deprecated.
  - Windows uses `windows-latest`.
- **Theme tokens** (interface design section 2, exact values):

  | Token | Dark | Light |
  |---|---|---|
  | `ground` | `#161618` | `#E3E3E0` |
  | `panel` | `#1E1E21` | `#F5F5F3` |
  | `hairline` | `#303035` | `#D6D6D2` |
  | `divider-soft` | `#28282C` | `#E6E6E2` |
  | `text` | `#ECEAE4` | `#1D1D1B` |
  | `text-muted` | `#A3A19A` | `#5E5E5A` |
  | `line` | `#5A5A61` | `#A3A39E` |
  | `score` | `#E3A548` | `#B26A00` |
  | `engine-ok` | `#1E8E5A` | `#1E8E5A` |

  `board-base` is `#DDB067` in both themes.
- **Font stack.** `Inter, "LXGW WenKai", -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif` with `font-feature-settings: 'tnum'`. Inter comes before WenKai. The fonts themselves are bundled in M5.

## Review Focus

These are the inputs most likely to bite a user of this milestone, and the task whose tests pin each one.

1. **A narrow or short window.** The board stays square and never gets a negative size, and the panel keeps its 360 px minimum until the board reaches zero. (Task 2: `computeFrame(1024, 900)`, `computeFrame(300, 200)`)
2. **OS locale lists in their real-world shapes**: `zh-Hans-CN`, `zh-TW`, upper case, `ja-JP` before `zh-CN`, or an empty list. Each resolves to a sensible language. (Task 3: `resolveLanguage` table)
3. **An OS theme preference the webview cannot read.** Dark is used. (Task 1: `readSystemTheme` returns `null`, and `resolveTheme` maps it to `dark`)
4. **An IPC failure that is not a `ProtocolError`.** For example, Tauri rejects a malformed request with a plain string. The UI shows localised error text and does not crash or print the raw string. (Task 4: mock-IPC test of a malformed request; Task 5: `toTransportError` and `VersionLine` error tests)
5. **A translation that drops or renames a placeholder**, such as a `zh-CN` value missing `{{version}}`, or English text that contains Chinese. CI fails. (Task 3: parity test)

---

### Task 0: Development toolchain (owner action)

Rust is not installed on the development Mac. This task changes the owner's machine, so the owner runs it or approves each command.

- [ ] **Step 1: Install rustup and the stable toolchain**

  Run, from <https://rustup.rs>: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`. Then open a new shell.

- [ ] **Step 2: Verify**

  Run `rustc --version && cargo --version`. Expected: both print a stable version. The Xcode Command Line Tools are already installed at `/Library/Developer/CommandLineTools`, which is all Tauri needs on macOS.

### Task 1: Scaffold the app, with theme tokens that follow the OS

**Files:**
- Create:
  - Root: `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`.
  - Frontend: `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`, `src/test/setup.ts`, `src/styles/index.css`, `src/styles/theme.css`, `src/theme/theme.ts`, `src/theme/theme.test.ts`, `src/theme/useThemeSync.ts`.
  - Tauri app: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/icons/*`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`.

**Interfaces:**
- Produces (`src/theme/theme.ts`):
  - `type Theme = 'dark' | 'light'`
  - `type ThemePreference = 'system' | Theme`
  - `resolveTheme(preference: ThemePreference, system: Theme | null): Theme`
  - `readSystemTheme(matchMedia: ((query: string) => { matches: boolean }) | undefined): Theme | null`
  - `applyTheme(theme: Theme, root?: HTMLElement): void`, which sets `root.dataset.theme` and defaults to `document.documentElement`.
- Produces (`src/theme/useThemeSync.ts`): `useThemeSync(): void`. It applies the resolved theme on mount and again when either `prefers-color-scheme` media query changes. The preference is `'system'` until M5 adds settings.
- Produces (CSS): `--ground`, `--panel`, `--hairline`, `--divider-soft`, `--text`, `--text-muted`, `--line`, `--score`, `--engine-ok` and `--board-base`, mapped to Tailwind colours of the same names with `@theme inline` (`bg-ground`, `text-text-muted` and so on).

- [ ] **Step 1: Create the branch**

  Run `git switch -c feat/m1-foundation main`.

- [ ] **Step 2: Generate the template and move it in**

  1. Run `pnpm create tauri-app@latest aji --template react-ts --manager pnpm --identifier io.github.reallxuan.aji --yes` in the scratchpad.
  2. Copy the result into the repository root. Keep the repository's own `README.md`, `LICENSE` and `.gitignore`.
  3. Delete the template's demo code: the `greet` command, its logos, and `App.css`.

- [ ] **Step 3: Make it a workspace, and set the app identity**

  1. Root `Cargo.toml`:
     - `[workspace]` with `members = ["src-tauri"]` and `resolver = "3"`.
     - `[workspace.package]` with `version = "0.1.0"`, `edition = "2024"` and `license = "AGPL-3.0-or-later"`.
  2. `src-tauri/Cargo.toml`: package `aji` and lib `aji_lib`, both inheriting the workspace package fields.
  3. `rust-toolchain.toml` as in Global Constraints.
  4. `tauri.conf.json`:
     - `"version": "../package.json"`.
     - The window values from Global Constraints.
     - `bundle.targets = "all"`, `bundle.publisher = "reallxuan"`, `bundle.macOS.minimumSystemVersion = "13.0"` and `bundle.macOS.signingIdentity = "-"` (an ad-hoc signature; without one, Apple Silicon calls a downloaded app "damaged").
     - `bundle.windows.nsis.languages = ["English", "SimpChinese"]`. NSIS falls back to the first language when the system language is not listed.
     - `app.security.csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'"`.
  5. `package.json`: `"packageManager"`, `"engines": { "node": ">=24" }`, and the scripts `lint` (`eslint . && prettier --check .`), `format`, `typecheck` (`tsc --noEmit`) and `test` (`vitest run`).

- [ ] **Step 4: Add the frontend tooling**

  1. Install Tailwind CSS 4 with `@tailwindcss/vite`, Vitest, jsdom, `@testing-library/react`, `@testing-library/jest-dom`, ESLint 9, typescript-eslint, `eslint-plugin-react-hooks` and Prettier.
  2. In `vite.config.ts`, set `test: { environment: 'jsdom', setupFiles: ['src/test/setup.ts'] }`.
  3. Configure Prettier with `{ "singleQuote": true, "printWidth": 100 }`.

- [ ] **Step 5: Write the failing tests** in `src/theme/theme.test.ts`

```ts
import css from '../styles/theme.css?raw';
import { applyTheme, readSystemTheme, resolveTheme } from './theme';

function tokens(theme: 'dark' | 'light'): Record<string, string> {
  const block = css.match(new RegExp(`:root\\[data-theme=['"]${theme}['"]\\]\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  // Prettier may lower-case hex colours, so compare in upper case.
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toUpperCase()]));
}

it('defines the dark tokens from the interface design', () => {
  expect(tokens('dark')).toEqual({
    ground: '#161618', panel: '#1E1E21', hairline: '#303035', 'divider-soft': '#28282C',
    text: '#ECEAE4', 'text-muted': '#A3A19A', line: '#5A5A61', score: '#E3A548', 'engine-ok': '#1E8E5A',
  });
});
it('defines the light tokens from the interface design', () => {
  expect(tokens('light')).toEqual({
    ground: '#E3E3E0', panel: '#F5F5F3', hairline: '#D6D6D2', 'divider-soft': '#E6E6E2',
    text: '#1D1D1B', 'text-muted': '#5E5E5A', line: '#A3A39E', score: '#B26A00', 'engine-ok': '#1E8E5A',
  });
});
it('defines the board base colour once for both themes', () => {
  expect(css).toMatch(/:root\s*\{[^}]*--board-base:\s*#DDB067;/i);
});
it.each([
  ['system', 'light', 'light'], ['system', 'dark', 'dark'], ['system', null, 'dark'],
  ['light', 'dark', 'light'], ['dark', null, 'dark'],
] as const)('resolveTheme(%s, %s) is %s', (pref, system, expected) => {
  expect(resolveTheme(pref, system)).toBe(expected);
});
it('reads the system theme, and null when no preference is readable', () => {
  const mm = (dark: boolean, light: boolean) => (q: string) => ({ matches: q.includes('dark') ? dark : light });
  expect(readSystemTheme(mm(true, false))).toBe('dark');
  expect(readSystemTheme(mm(false, true))).toBe('light');
  expect(readSystemTheme(mm(false, false))).toBeNull();
  expect(readSystemTheme(undefined)).toBeNull();
});
it('applies the theme as a data attribute', () => {
  const el = document.createElement('div');
  applyTheme('light', el);
  expect(el.dataset.theme).toBe('light');
});
```

- [ ] **Step 6: Run the tests to verify they fail**

  Run `pnpm test src/theme`. Expected: FAIL, because `./theme` and `theme.css` do not exist.

- [ ] **Step 7: Implement `theme.css`, `theme.ts` and `useThemeSync`**

  1. `theme.css` holds three blocks: `:root` (board base), `:root[data-theme='dark']` and `:root[data-theme='light']`, each with one declaration per token. Then an `@theme inline` block maps `--color-<token>: var(--<token>)`.
  2. `index.css` imports Tailwind and `theme.css`, and sets `body` to `bg-ground text-text`, with the font stack and `tnum`.
  3. `main.tsx` calls `applyTheme(resolveTheme('system', readSystemTheme(window.matchMedia?.bind(window))))` before the first render, so the first frame already has the right ground colour.

- [ ] **Step 8: Run the tests to verify they pass**

  Run `pnpm test src/theme`. Expected: PASS.

- [ ] **Step 9: Verify the app**

  1. Run `pnpm lint && pnpm typecheck && pnpm tauri dev`. Expected: a 1440 × 900 window filled with the ground colour of the current OS theme.
  2. Switch the macOS appearance while it runs. Expected: the colour follows.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri app with theme tokens that follow the OS"
```

### Task 2: Main frame layout

**Files:**
- Create: `src/layout/frame.ts`, `src/layout/frame.test.ts`, `src/layout/useWindowSize.ts`, `src/layout/MainFrame.tsx`.
- Modify: `src/App.tsx`.

**Interfaces:**
- Produces (`src/layout/frame.ts`):
  - `BOARD_MARGIN = 16`
  - `PANEL_MIN_WIDTH = 360`
  - `type Frame = { board: { x: number; y: number; size: number }; panel: { x: number; width: number } }`
  - `computeFrame(width: number, height: number): Frame`
- Produces (`src/layout/MainFrame.tsx`): `MainFrame({ panel }: { panel: React.ReactNode })`.
  - Renders the board area as a `bg-board-base` square at `frame.board`. M5 replaces the square with the canvas.
  - Renders the panel at `frame.panel`: full height, flush right, `bg-panel`, and a `border-hairline` left edge.

- [ ] **Step 1: Write the failing test** in `src/layout/frame.test.ts`

```ts
import { computeFrame } from './frame';

it('matches the 1440 x 900 reference in the interface design', () => {
  expect(computeFrame(1440, 900)).toEqual({ board: { x: 16, y: 16, size: 868 }, panel: { x: 900, width: 540 } });
});
it('gives extra width to the panel, because height limits the board', () => {
  expect(computeFrame(2560, 1440)).toEqual({ board: { x: 16, y: 16, size: 1408 }, panel: { x: 1440, width: 1120 } });
});
it('shrinks the board so the panel keeps its minimum width', () => {
  expect(computeFrame(1024, 900)).toEqual({ board: { x: 16, y: 16, size: 632 }, panel: { x: 664, width: 360 } });
});
it('never returns a negative board size', () => {
  expect(computeFrame(300, 200)).toEqual({ board: { x: 16, y: 16, size: 0 }, panel: { x: 32, width: 268 } });
});
it('uses whole pixels for the board', () => {
  expect(computeFrame(1440, 900.6).board.size).toBe(868);
});
```

- [ ] **Step 2: Run the test to verify it fails**

  Run `pnpm test src/layout`. Expected: FAIL, because `./frame` does not exist.

- [ ] **Step 3: Implement `computeFrame`**

  `size = max(0, floor(min(height − 2·BOARD_MARGIN, width − 2·BOARD_MARGIN − PANEL_MIN_WIDTH)))`. The panel starts at `size + 2·BOARD_MARGIN` and takes the rest of the width.

- [ ] **Step 4: Run the test to verify it passes**

  Run `pnpm test src/layout`. Expected: PASS.

- [ ] **Step 5: Implement `useWindowSize` and `MainFrame`, and render `MainFrame` from `App` with an empty panel**

  `useWindowSize` returns `{ width: window.innerWidth, height: window.innerHeight }` and updates on `resize`.

- [ ] **Step 6: Verify the app**

  Run `pnpm tauri dev` and resize the window. Expected: the board square follows the height, the panel takes the rest of the width, and at the minimum window size both stay visible.

- [ ] **Step 7: Commit**

```bash
git add src/layout src/App.tsx
git commit -m "feat: lay out the main frame with a square board area and side panel"
```

### Task 3: Internationalisation

**Files:**
- Create: `src/i18n/language.ts`, `src/i18n/language.test.ts`, `src/i18n/createI18n.ts`, `src/i18n/parity.test.ts`, `src/locales/zh-CN.json`, `src/locales/en.json`.
- Modify: `src/main.tsx`, `eslint.config.js`, `package.json`.

**Interfaces:**
- Produces (`src/i18n/language.ts`):
  - `type Language = 'zh-CN' | 'en'`
  - `type LanguagePreference = 'system' | Language`
  - `resolveLanguage(preference: LanguagePreference, systemLocales: readonly string[]): Language`
- Produces (`src/i18n/createI18n.ts`): `createI18n(language: Language): i18n`. It returns a new, initialised i18next instance (not the global one), with the bundled resources loaded synchronously and `fallbackLng: 'en'`. It also sets `document.documentElement.lang` to `language`, so the system's Chinese fallback fonts pick Simplified glyphs.
- Produces (locale keys, used by Task 5): `about.versionLine`, `os.windows`, `os.macos`, `os.linux`, `os.other` and `errors.internal`, with the values in Step 7.

- [ ] **Step 1: Write the failing tests** in `src/i18n/language.test.ts`

```ts
import { resolveLanguage } from './language';

it.each([
  ['system', ['zh-CN'], 'zh-CN'],
  ['system', ['zh-Hans-CN'], 'zh-CN'],
  ['system', ['zh-TW'], 'zh-CN'], // until a Traditional Chinese locale exists
  ['system', ['ZH-cn'], 'zh-CN'],
  ['system', ['en-GB', 'zh-CN'], 'en'],
  ['system', ['ja-JP', 'zh-CN'], 'zh-CN'],
  ['system', ['ja-JP'], 'en'],
  ['system', [], 'en'],
  ['en', ['zh-CN'], 'en'],
  ['zh-CN', ['en-US'], 'zh-CN'],
] as const)('resolveLanguage(%s, %j) is %s', (pref, locales, expected) => {
  expect(resolveLanguage(pref, locales)).toBe(expected);
});
```

- [ ] **Step 2: Write the failing parity test** in `src/i18n/parity.test.ts`

  The test flattens both locale files to dotted keys and asserts four things:
  - Both files have the same sorted key list.
  - No value is empty.
  - Each key has the same set of `{{placeholder}}` names in both files.
  - No `en` value contains a character in `㐀-鿿`.

- [ ] **Step 3: Run the tests to verify they fail**

  Run `pnpm test src/i18n`. Expected: FAIL, because the modules and the locale files do not exist.

- [ ] **Step 4: Implement `resolveLanguage`**

  An explicit preference wins. Otherwise, walk the locales in order and compare each locale's first subtag, lower-cased: `zh` gives `zh-CN`, `en` gives `en`. The first match wins. With no match, return `en`.

- [ ] **Step 5: Implement `createI18n`, and wire it into `main.tsx`**

  `main.tsx` calls `createI18n(resolveLanguage('system', navigator.languages))` and wraps `App` in `I18nextProvider`.

- [ ] **Step 6: Add the lint rule against literal JSX text**

  Install `eslint-plugin-i18next`. In `eslint.config.js`, set `'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }]` for `src/**/*.tsx`, excluding `*.test.tsx`.

- [ ] **Step 7: Write the locale files**

  | Key | `zh-CN` | `en` |
  |---|---|---|
  | `about.versionLine` | `Aji 版本 {{version}} · {{os}} {{arch}}` | `Aji version {{version}} · {{os}} {{arch}}` |
  | `os.windows` | `Windows` | `Windows` |
  | `os.macos` | `macOS` | `macOS` |
  | `os.linux` | `Linux` | `Linux` |
  | `os.other` | `未知系统` | `Unknown system` |
  | `errors.internal` | `Aji 内部出错。` | `Aji ran into an internal error.` |

- [ ] **Step 8: Run the tests to verify they pass**

  Run `pnpm test src/i18n`. Expected: PASS.

- [ ] **Step 9: Verify that the lint rule bites**

  1. Add `<p>hello</p>` to `App.tsx` and run `pnpm lint`. Expected: FAIL with `i18next/no-literal-string`.
  2. Remove the line and run `pnpm lint`. Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/i18n src/locales src/main.tsx eslint.config.js package.json pnpm-lock.yaml
git commit -m "feat: add zh-CN and en locales with OS language detection"
```

### Task 4: Protocol and dispatcher (Rust)

**Files:**
- Create: `src-tauri/src/protocol.rs`, `src-tauri/src/service.rs`, `src-tauri/src/ipc.rs`, `src-tauri/tests/ipc.rs`, `.cargo/config.toml`.
- Generate and commit: `src/transport/generated/*.ts`.
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `.prettierignore`, `eslint.config.js` (ignore `src/transport/generated`).

**Interfaces:**
- Produces (`src-tauri/src/protocol.rs`). Every type derives `Debug, Clone, PartialEq` and `ts_rs::TS` with `#[ts(export)]`:
  - `enum Request { AppInfo }`
    - `#[serde(tag = "type", rename_all = "camelCase")]`, `Deserialize` only.
    - JSON: `{"type":"appInfo"}`.
  - `enum Response { AppInfo(AppInfo) }`
    - Same serde attributes, `Serialize` only.
    - JSON: `{"type":"appInfo","version":…,"os":…,"arch":…}`.
  - `struct AppInfo { pub version: String, pub os: OsKind, pub arch: String }`
  - `enum OsKind { Windows, Macos, Linux, Other }`
    - `#[serde(rename_all = "camelCase")]`.
    - `OsKind::current() -> OsKind` decides by `cfg!(target_os)`.
  - `struct ProtocolError { pub code: ErrorCode, pub message: String }`, `Serialize`.
  - `enum ErrorCode { Internal }`, `#[serde(rename_all = "camelCase")]`.
- Produces (`src-tauri/src/service.rs`):
  - `struct AppContext { pub version: String, pub os: OsKind, pub arch: String }`
  - `AppContext::detect(version: String) -> AppContext`, using `OsKind::current()` and `std::env::consts::ARCH`.
  - `async fn handle(ctx: &AppContext, request: Request) -> Result<Response, ProtocolError>`
  - No Tauri types anywhere in this file.
- Produces (`src-tauri/src/ipc.rs`): `#[tauri::command] async fn rpc(ctx: tauri::State<'_, AppContext>, request: Request) -> Result<Response, ProtocolError>`
- Produces (`src-tauri/src/lib.rs`):
  - `pub fn configure<R: tauri::Runtime>(builder: tauri::Builder<R>, ctx: AppContext) -> tauri::Builder<R>`, which manages `ctx` and registers `rpc`.
  - `pub fn run()`, which builds `AppContext::detect` from the version in the generated context's package info.
- Produces (TypeScript): `Request`, `Response`, `AppInfo`, `OsKind`, `ProtocolError` and `ErrorCode` in `src/transport/generated/`, one file per type.

- [ ] **Step 1: Write the failing unit tests** at the bottom of `protocol.rs` and `service.rs`

```rust
// service.rs
#[tokio::test]
async fn app_info_reports_the_context() {
    let ctx = AppContext { version: "0.1.0".into(), os: OsKind::Macos, arch: "aarch64".into() };
    assert_eq!(
        handle(&ctx, Request::AppInfo).await,
        Ok(Response::AppInfo(AppInfo { version: "0.1.0".into(), os: OsKind::Macos, arch: "aarch64".into() }))
    );
}

// protocol.rs
#[test]
fn request_json_shape() {
    assert_eq!(serde_json::from_value::<Request>(json!({"type": "appInfo"})).unwrap(), Request::AppInfo);
    assert!(serde_json::from_value::<Request>(json!({"type": "nope"})).is_err());
}
#[test]
fn response_json_shape() {
    let r = Response::AppInfo(AppInfo { version: "0.1.0".into(), os: OsKind::Macos, arch: "aarch64".into() });
    assert_eq!(serde_json::to_value(r).unwrap(), json!({"type": "appInfo", "version": "0.1.0", "os": "macos", "arch": "aarch64"}));
}
#[test]
fn error_json_shape() {
    let e = ProtocolError { code: ErrorCode::Internal, message: "boom".into() };
    assert_eq!(serde_json::to_value(e).unwrap(), json!({"code": "internal", "message": "boom"}));
}
#[test]
fn current_os_matches_the_build_target() {
    #[cfg(target_os = "macos")] assert_eq!(OsKind::current(), OsKind::Macos);
    #[cfg(target_os = "windows")] assert_eq!(OsKind::current(), OsKind::Windows);
    #[cfg(target_os = "linux")] assert_eq!(OsKind::current(), OsKind::Linux);
}
```

- [ ] **Step 2: Write the failing IPC test** in `src-tauri/tests/ipc.rs`

  1. Use Tauri's mock runtime, with `tauri` as a dev-dependency with the `test` feature: `mock_builder`, `mock_context`, `noop_assets` and `get_ipc_response`.
  2. Build `configure(mock_builder(), AppContext { version: "0.1.0".into(), os: OsKind::Linux, arch: "x86_64".into() })`, then create a webview.
  3. Invoke `rpc` with the JSON body `{"request": {"type": "appInfo"}}`. Assert that the response deserialises to `{"type":"appInfo","version":"0.1.0","os":"linux","arch":"x86_64"}`.
  4. Invoke `rpc` with `{"request": {"type": "nope"}}`. Assert an error response whose payload is a string, not a `ProtocolError`. This pins the case the TypeScript side must normalise (Review Focus 4).

- [ ] **Step 3: Run the tests to verify they fail**

  Run `pnpm build && cargo test -p aji`. Expected: compile errors for the missing items.

  `pnpm build` comes first because `tauri::generate_context!` embeds `../dist` at compile time and fails if it is missing.

- [ ] **Step 4: Implement `protocol.rs`, `service.rs`, `ipc.rs` and `configure`, and set up generation**

  1. Add the dependencies `serde` (derive), `serde_json` and `ts-rs`. Add the dev-dependencies `tokio` (macros, rt-multi-thread) and `tauri` (feature `test`).
  2. In `.cargo/config.toml`, set `[env] TS_RS_EXPORT_DIR = { value = "src/transport/generated", relative = true }`.

- [ ] **Step 5: Run the tests to verify they pass**

  Run `cargo test -p aji`. Expected: PASS, and `src/transport/generated/` holds six `.ts` files. `Request.ts` declares `{ "type": "appInfo" }`.

- [ ] **Step 6: Verify lint**

  Run `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings`. Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add .cargo src-tauri src/transport/generated .prettierignore eslint.config.js Cargo.lock
git commit -m "feat: add the rpc protocol with a transport-independent dispatcher"
```

### Task 5: Transport (TypeScript) and the version line

**Files:**
- Create:
  - `src/transport/transport.ts`, `src/transport/tauri.ts`, `src/transport/fake.ts`, `src/transport/api.ts`, `src/transport/TransportProvider.tsx`, `src/panel/VersionLine.tsx`.
  - Tests: `src/transport/transport.test.ts`, `src/transport/tauri.test.ts`, `src/transport/api.test.ts`, `src/panel/VersionLine.test.tsx`.
- Modify: `src/main.tsx`, `src/App.tsx`.

**Interfaces:**
- Consumes: the generated types from Task 4; `createI18n` and the locale keys from Task 3; `MainFrame` from Task 2.
- Produces (`src/transport/transport.ts`):
  - `interface Transport { request(request: Request): Promise<Response> }`. Milestone M2 adds `subscribe`.
  - `class TransportError extends Error { readonly code: ErrorCode }`, built with `new TransportError(code, message)`.
  - `toTransportError(error: unknown): TransportError`:
    - An object with a known `code` string and a `message` string keeps both.
    - Anything else becomes code `'internal'`, with the message taken from `String(error)`, or from `JSON.stringify` for an object.
- Produces (`src/transport/tauri.ts`): `createTauriTransport(): Transport`. It calls `invoke('rpc', { request })` and rejects with `toTransportError(error)`.
- Produces (`src/transport/fake.ts`): `createFakeTransport(handler: (request: Request) => Response | Promise<Response>): Transport`, for tests and later UI development.
- Produces (`src/transport/api.ts`): `getAppInfo(transport: Transport): Promise<AppInfo>`. It throws `TransportError('internal', …)` if the response `type` is not `'appInfo'`.
- Produces (`src/transport/TransportProvider.tsx`): `TransportProvider({ transport, children })` and `useTransport(): Transport`. The hook throws outside a provider.
- Produces (`src/panel/VersionLine.tsx`): `VersionLine()`. While loading it renders nothing. On success it renders `about.versionLine`, with `os` translated through `os.<kind>`. On failure it renders `errors.<code>`.

- [ ] **Step 1: Write the failing tests**

```ts
// transport.test.ts
it('keeps a ProtocolError as it is', () => {
  const e = toTransportError({ code: 'internal', message: 'boom' });
  expect([e.code, e.message]).toEqual(['internal', 'boom']);
});
it('turns a plain string rejection into an internal error', () => {
  const e = toTransportError('invalid args `request` for command `rpc`');
  expect(e.code).toBe('internal');
  expect(e.message).toContain('invalid args');
});
it('turns an object with an unknown code into an internal error', () => {
  expect(toTransportError({ code: 'teapot', message: 'x' }).code).toBe('internal');
});

// tauri.test.ts  (mockIPC and clearMocks from '@tauri-apps/api/mocks')
it('sends every request through the rpc command', async () => {
  const calls: unknown[] = [];
  mockIPC((cmd, args) => { calls.push([cmd, args]); return { type: 'appInfo', version: '0.1.0', os: 'macos', arch: 'aarch64' }; });
  await expect(createTauriTransport().request({ type: 'appInfo' }))
    .resolves.toEqual({ type: 'appInfo', version: '0.1.0', os: 'macos', arch: 'aarch64' });
  expect(calls).toEqual([['rpc', { request: { type: 'appInfo' } }]]);
});
it('rejects with a TransportError when the command fails', async () => {
  mockIPC(() => { throw { code: 'internal', message: 'boom' }; });
  await expect(createTauriTransport().request({ type: 'appInfo' })).rejects.toMatchObject({ code: 'internal' });
});

// api.test.ts
it('rejects an unexpected response type', async () => {
  const t = createFakeTransport(() => ({ type: 'somethingElse' }) as unknown as Response);
  await expect(getAppInfo(t)).rejects.toMatchObject({ code: 'internal' });
});

// VersionLine.test.tsx  (render inside I18nextProvider(createI18n(lang)) and TransportProvider(fake))
it('shows the version line in English', async () => {
  renderWith('en', () => ({ type: 'appInfo', version: '0.1.0', os: 'macos', arch: 'aarch64' }));
  expect(await screen.findByText('Aji version 0.1.0 · macOS aarch64')).toBeInTheDocument();
});
it('translates an unknown OS in Chinese', async () => {
  renderWith('zh-CN', () => ({ type: 'appInfo', version: '0.1.0', os: 'other', arch: 'riscv64' }));
  expect(await screen.findByText('Aji 版本 0.1.0 · 未知系统 riscv64')).toBeInTheDocument();
});
it('shows localised error text, not the raw message', async () => {
  renderWith('zh-CN', () => { throw new TransportError('internal', 'raw backend text'); });
  expect(await screen.findByText('Aji 内部出错。')).toBeInTheDocument();
  expect(screen.queryByText(/raw backend text/)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

  Run `pnpm test src/transport src/panel`. Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement the transport modules, `TransportProvider` and `VersionLine`**

  `VersionLine` ignores a result that arrives after it unmounts.

- [ ] **Step 4: Run the tests to verify they pass**

  Run `pnpm test`. Expected: PASS, the whole suite.

- [ ] **Step 5: Wire the app together**

  1. `main.tsx` wraps `App` in `TransportProvider` with `createTauriTransport()`.
  2. `App` renders `MainFrame` with a panel that holds `VersionLine` at its foot, in `text-text-muted`.

- [ ] **Step 6: Verify the app**

  1. Run `pnpm tauri dev`. Expected: the panel shows `Aji version 0.1.0 · macOS aarch64` on an English-first Mac.
  2. Set the macOS language order to put English first and restart the app. Expected: still correct, with no CSP errors in the webview console.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: add the UI transport layer and show the app version from Rust"
```

### Task 6: CI checks and licence gates

**Files:**
- Create: `.github/workflows/ci.yml`, `deny.toml`, `scripts/check-npm-licenses.mjs`.

**Interfaces:**
- Produces: a workflow named `CI` that runs on every push and pull request. Its jobs are `frontend`, `rust` and `licenses`, and the bundle jobs of Task 7 depend on them.

- [ ] **Step 1: Write `scripts/check-npm-licenses.mjs`**

  1. Run `pnpm licenses list --prod --json` and parse the output, which is grouped by licence.
  2. Fail with a list of `name@version (licence)` for anything outside this allow-list: `MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `0BSD`, `MPL-2.0`, `CC0-1.0`, `Unlicense`, `BlueOak-1.0.0`, `OFL-1.1`.
  3. Accept an SPDX `OR` expression if any alternative is allowed.

- [ ] **Step 2: Verify that it bites**

  1. Run `node scripts/check-npm-licenses.mjs`. Expected: exit 0.
  2. Temporarily empty the allow-list and run it again. Expected: exit 1, listing `react` and the other dependencies. Restore the list.

- [ ] **Step 3: Write `deny.toml`**

  1. Add a `[licenses]` allow-list of the Global Constraints licences in SPDX form. Include `AGPL-3.0-or-later` for Aji's own crate.
  2. Run `cargo deny check licenses` (install the tool with `cargo install cargo-deny --locked`). Add a licence only if it is on the Global Constraints list, or is permissive and listed by the FSF as GPL-compatible. Name each addition in the commit message.
  3. Expected: `licenses ok`.

- [ ] **Step 4: Write `ci.yml`**

  - `frontend` (`ubuntu-24.04`):
    1. `pnpm/action-setup`, which reads `packageManager`.
    2. `actions/setup-node`, Node 24, with the pnpm cache.
    3. `pnpm install --frozen-lockfile`.
    4. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `node scripts/check-npm-licenses.mjs`.
  - `rust` (`ubuntu-24.04`):
    1. Install the Tauri Linux prerequisites: `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`.
    2. Set up Node and pnpm, and run `pnpm build` (for `generate_context!`).
    3. Use the Rust toolchain from `rust-toolchain.toml`, with `Swatinem/rust-cache`.
    4. `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.
    5. `git diff --exit-code -- src/transport/generated`, and `test -z "$(git status --porcelain src/transport/generated)"`, so stale or new generated files fail.
  - `licenses` (`ubuntu-24.04`): `EmbarkStudios/cargo-deny-action` with `command: check licenses`.

- [ ] **Step 5: Verify the workflow file**

  Run `gh workflow view` after the push, or validate locally with `actionlint` if installed. Expected: no syntax errors. The full run is verified in Task 7, after the owner pushes.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml deny.toml scripts/check-npm-licenses.mjs
git commit -m "ci: run lint, type, test and licence checks on every push"
```

### Task 7: Installers from CI, verified on the real machines

**Files:**
- Modify: `.github/workflows/ci.yml` (add the `bundle` job), `README.md` (status line and a short "Build from source" section).

**Interfaces:**
- Consumes: the `frontend`, `rust` and `licenses` jobs from Task 6.
- Produces: CI artifacts `aji-windows-x64` (NSIS `.exe`), `aji-macos-arm64` (`.dmg`) and `aji-linux-x64` (`.AppImage`), kept for 14 days.

- [ ] **Step 1: Add the `bundle` job**

  1. `needs: [frontend, rust, licenses]`.
  2. Matrix:
     - `windows-latest` with `--bundles nsis`.
     - `macos-15` (arm64) with `--bundles dmg`.
     - `ubuntu-22.04` with `--bundles appimage`, plus the Linux prerequisites from Task 6.
  3. Run `pnpm install --frozen-lockfile` and `pnpm tauri build <bundles>`.
  4. Upload `target/release/bundle/<kind>/*` with `actions/upload-artifact`, under the artifact names above.

- [ ] **Step 2: Update `README.md`**

  1. Status: "Phase 1 in progress: the app skeleton builds; no engine support yet."
  2. Build from source: `pnpm install`, then `pnpm tauri dev`, with the prerequisites linked to Task 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: build Windows, macOS and Linux installers on every push"
```

- [ ] **Step 4: Owner pushes `feat/m1-foundation`, then verify the run**

  Run `gh run watch` on the triggered run. Expected: every job green and three artifacts attached.

- [ ] **Step 5: Owner verifies on the Windows PC with the RTX 5070**

  1. Install the NSIS artifact and pass SmartScreen with "More info", then "Run anyway".
  2. Expected:
     - The installer UI is in Chinese on a Chinese system.
     - The app opens at 1440 × 900 with the frame of Task 2.
     - The panel shows `Aji 版本 0.1.0 · Windows x86_64` on a Chinese Windows, or `Aji version 0.1.0 · Windows x86_64` on an English one. The word "版本" or "version" is how the interface language is checked by eye.
     - Switching Windows between dark and light mode recolours the window.
  3. Record any further prompts in the pull request description.

- [ ] **Step 6: Owner verifies on the MacBook Pro M5 (the development Mac)**

  1. Open the DMG, drag Aji to Applications, and allow it once under System Settings › Privacy & Security, "Open Anyway".
  2. Expected: the same checks as Step 5, with `macOS aarch64`. The language follows the first entry of System Settings › General › Language & Region. To check the Chinese interface without changing that, quit Aji and run `open -a Aji --args -AppleLanguages "(zh-Hans-CN)"`; the panel shows `Aji 版本 0.1.0 · macOS aarch64`.

M1 is done when Steps 4 to 6 pass. Phase 1 continues with M2 in the roadmap.
