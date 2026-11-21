# M8 Acceptance and v0.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and run the Phase 1 acceptance on the PC and the Mac, publish the signed manifest and public release candidates, and tag `v0.1.0`.

**Architecture:** Three small code fixes (SGF decoding hint, the catching-up fade, licence-text fallback in the notices), a release job in CI driven by a tested Node script, and documents (checklist, backlog; the README with the record after the walk). Then owner-gated operations: pushes, the manifest workflow, tags and the walk itself.

**Tech Stack:** Rust (`aji-core`, chardetng 1.0.0, encoding_rs 0.8.44), React + Vitest, Node 24 scripts, GitHub Actions, `gh`.

**Spec:** [M8 design](../specs/2026-11-21-m8-acceptance-release-design.md), approved by the owner on 2026-11-21.

**Status:** Done on 2026-11-21.
- **Tasks 1–5** were built natively. A fresh review of the whole branch found nothing critical and two important issues, each fixed with a test that failed first and folded into its commit: a manual CI run started from a tag could publish a release, and the Fox hint turned damaged UTF-8 into GB18030. Nine minor findings are in the backlog or settled by the record.
- **Task 6:** the rehearsal run 44874364736 was green, and its dry run listed exactly the three installers and `SHA256SUMS.txt`. The coremltools notice was checked, and the owner confirmed the WenKai reading.
- **Task 7:** `aji-manifest` needed one more fix (`df8978a`), because `deploy-pages` could not see the Pages upload made in its own job. The manifest is live at sequence 1795244252, the app uses it, and a tampered cache falls back to the bundled copy.
- **Task 8:** the branch was merged into `main` (`dbf6bb7`), and `v0.1.0-rc.1` was published and checked on the Mac.
- **Tasks 9 and 10:** the owner walked both machines, and both passed. `v0.1.0` is the `rc.1` commit with `rc.1`'s files. The owner's walk suggested the side-to-move disc view, which is the first item after `v0.1.0`.

## Global Constraints

- **Everything from M1 to M7 still holds:** English in the repository, interface text through i18n in `zh-CN` and `en` in the same commit, dependency licences compatible with AGPL-3.0-or-later, Conventional Commits, `aji-core` depends on no workspace crate and does no I/O, the protocol rules.
- **No git worktrees**, for subagents too. Work in `/Users/zepher/personal/Aji` on `feat/m8-acceptance` (from `main` at `ccb3108`; the design is its first commit).
- **Outward actions wait for the owner's go-ahead, each time:** pushing any branch of either repository, running a workflow, creating a tag, merging into `main`, publishing a release.
- **Checks before every commit:** `cargo fmt --check`; `cargo clippy --workspace --all-targets -- -D warnings`; `cargo test --workspace`; `pnpm lint`; `pnpm typecheck`; `pnpm test`. A change to `scripts/third-party-notices.mjs` also runs `node scripts/third-party-notices.mjs --check`.
- **Values fixed by the design:**
  - Release files: `*-setup.exe`, `*.dmg`, `*.AppImage`, plus `SHA256SUMS.txt`.
  - Tags: `v0.1.0-rc.N` publishes a public pre-release; `v0.1.0` publishes the release with the assets of the release candidate on the same commit.
  - The tag's version without its suffix equals `package.json`'s `version` (`0.1.0`).
  - The PC default stays CUDA 13.2 unless the walk shows it failing, or the owner picks DirectML from measured numbers (design 5.2).
- **Not in M8:** Linux checks, the PC scripts, the app icon, signing.

## Review Focus

1. **A Taiwanese Big5 record with `RU[Chinese]`**: still reads as Big5. A `cn` hint from `RU[Chinese]` misread 380 of 380 Big5 name pairs in a probe, so `RU` gives no hint (Task 1).
2. **A Korean record**, with or without `RU[Korean]`: still reads as EUC-KR. A `cn` hint for every file misread 380 of 380 Korean pairs (Task 1).
3. **A tag whose version disagrees with `package.json`**, such as `v0.2.0` on a 0.1.0 tree: the release job fails before anything is published (Task 4).
4. **`v0.1.0` pushed on a commit with no release candidate**, or with one only on an older commit: the job fails rather than shipping unwalked files (Task 4).
5. **A future dependency whose licence has no vendored text** and no licence file: the notices generator fails with the package name, rather than printing "(no licence file; …)" (Task 3).

---

### Task 1: Short Fox records read as GBK

**Files:**
- Modify: `crates/aji-core/src/sgf/decode.rs`
- Test: `crates/aji-core/src/sgf/decode.rs` (its `#[cfg(test)]` module)

**Interfaces:**
- Produces: `fn tld_hint(bytes: &[u8]) -> Option<&'static [u8]>` (private), used by `decode`.

Background (design section 6, from a probe with chardetng 1.0.0 on 380 name pairs per case). With no hint, chardetng reads 234 of 5,700 short GBK records (two Chinese names, no `CA`) as EUC-KR. A `cn` hint fixes those, but given to every file it reads every Korean record as GBK. Taken from `RU[Chinese]` it reads every Big5 record as GBK, and `jp` or `kr` taken from `RU` misread most GBK records with those rules. Fox exports are always GBK and carry `AP[foxwq]` (see `tests/fixtures/sgf/fox-chinese.sgf`), so that is the only marker that gives a hint. With it, the Fox pairs read 380 of 380 as GBK.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn short_fox_names_read_as_gbk() {
    // Without a hint chardetng reads this pair as EUC-KR.
    let bytes = gbk("(;GM[1]FF[4]SZ[19]PB[黑方]PW[柯洁]KM[375]RU[Chinese]AP[foxwq];B[pd])");
    let d = decode(&bytes);
    assert_eq!(d.encoding, "GBK");
    assert!(d.text.contains("柯洁"));
}

#[test]
fn big5_with_chinese_rules_stays_big5() {
    let s = "(;GM[1]FF[4]SZ[19]PB[周俊勳]PW[林海峰]RU[Chinese];B[pd])";
    let (bytes, _, _) = encoding_rs::BIG5.encode(s);
    assert_eq!(decode(&bytes).encoding, "Big5");
}

#[test]
fn fox_beats_japanese_rules() {
    let bytes = gbk("(;GM[1]FF[4]SZ[19]PB[黑方]PW[柯洁]KM[0]HA[0]RU[Japanese]AP[foxwq];B[pd])");
    assert_eq!(decode(&bytes).encoding, "GBK");
}

#[test]
fn korean_records_stay_euc_kr() {
    for header in ["RU[Korean]", ""] {
        let s = format!("(;GM[1]FF[4]SZ[19]PB[신진서]PW[박정환]{header};B[pd])");
        let (bytes, _, _) = encoding_rs::EUC_KR.encode(&s);
        assert_eq!(decode(&bytes).encoding, "EUC-KR", "header {header:?}");
    }
}

#[test]
fn fox_name_pairs_read_as_gbk() {
    // 20 names, 380 ordered pairs, each in a Fox header with no CA.
    const NAMES: [&str; 20] = ["柯洁", "申真谞", "朴廷桓", "芈昱廷", "辜梓豪", "杨鼎新", "丁浩",
        "李轩豪", "党毅飞", "连笑", "陈浩", "陆敏全", "邱峻", "孔杰", "古力", "黑方", "白方",
        "棋友", "於之莹", "唐嘉雯"];
    let mut misread = 0;
    for a in NAMES { for b in NAMES { if a == b { continue; }
        let s = format!("(;GM[1]FF[4]SZ[19]PB[{a}]PW[{b}]KM[375]RU[Chinese]AP[foxwq];B[pd])");
        if decode(&gbk(&s)).encoding != "GBK" { misread += 1; }
    }}
    assert_eq!(misread, 0, "{misread} of 380 misread");
}
```

- [ ] **Step 2: Run** `cargo test -p aji-core sgf::decode`. Expected: FAIL on `short_fox_names_read_as_gbk`, `fox_beats_japanese_rules` and `fox_name_pairs_read_as_gbk`. `big5_with_chinese_rules_stays_big5` and `korean_records_stay_euc_kr` pass already and must keep passing.

- [ ] **Step 3: Implement `tld_hint` and pass it to `detector.guess(hint, Utf8Detection::Allow)`**
  - Scan the raw bytes the way `declared_charset` does: every `AP[` not preceded by an uppercase ASCII letter, since Fox writes `AP` twice. A value containing `foxwq`, case-insensitive, gives `Some(b"cn")`. Anything else gives `None`. `RU` is not read.
  - The hint applies only to the chardetng guess. BOM, valid UTF-8 and a declared multi-byte `CA` still come first, unchanged.

- [ ] **Step 4: Run** `cargo test -p aji-core`. Expected: PASS, including the fixture tests in `crates/aji-core/tests/` (`shift-jis.sgf`, `euc-kr.sgf` and the GBK fixtures read as before).

- [ ] **Step 5: Commit** `fix(sgf): read short Fox and Chinese-rules records as GBK`.

### Task 2: The catching-up fade and header only while the engine is analysing

**Files:**
- Modify: `src/analysis/useShownCandidates.ts`
- Test: `src/panel/CandidateTable.test.tsx`, `src/panel/WinrateBar.test.tsx`

**Interfaces:**
- Consumes: `useEngineStore((s) => s.engine)`, an `EngineState | null` (generated type, `state` field).
- Produces: `Shown.fading` is true only when `engine?.state === 'analysing'` and `catchingUp(current)`.

- [ ] **Step 1: Write the failing tests**
  - `CandidateTable.test.tsx`, `a paused search shows its own total, not the catching-up header`: mount with `analysis({ rootVisits: 640, previousVisits: 1000 })` and the engine store's `engine` set to `{ state: 'paused', version: '1.18.2' }`. Expect the header to read the `analysis.table.total` text for 640 visits, no element with `data-catching-up`, and rows at opacity 1.
  - Same file, `a restarting engine does not keep the catching-up header`: as above with `{ state: 'starting' }`.
  - `WinrateBar.test.tsx`, `the bar is not faded while paused`: the same update with `paused`; the bar's style has opacity 1.
  - The existing catching-up tests set `{ state: 'analysing', version: '1.18.2' }` if they do not already, and keep passing.
- [ ] **Step 2: Run** `pnpm vitest run src/panel/CandidateTable.test.tsx src/panel/WinrateBar.test.tsx`. Expected: the three new tests FAIL.
- [ ] **Step 3: Implement** the condition in `useShownCandidates`. The board's `catchingUp` prop (`MainFrame.tsx`) follows, since it reads the same field.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(analysis): fade a search catching up only while the engine analyses`.

### Task 3: Licence text for crates and packages that ship no licence file

**Files:**
- Create: `scripts/licence-texts/MIT.txt`, `scripts/licence-texts/BSD-3-Clause.txt`, `scripts/licence-texts/MPL-2.0.txt`, `scripts/licence-texts/README.md`
- Modify: `scripts/third-party-notices.mjs`, `src/assets/notices/third-party.txt` (regenerated)
- Test: `scripts/third-party-notices.test.mjs`

**Interfaces:**
- Produces, exported from `scripts/third-party-notices.mjs`:
  - `chooseLicence(expression: string): string[]`: the SPDX ids whose texts are printed.
  - `fallbackText(pkg: { name: string, licence: string, authors: string[] }): string`.
- The script runs its main body only when executed directly (`import.meta.url === pathToFileURL(process.argv[1]).href`), so the test can import it.

The packages with no licence file today carry nine expressions (`MIT`, `BSD-3-Clause`, `MPL-2.0`, `Apache-2.0/MIT`, `MIT/Apache-2.0`, `MIT OR Apache-2.0`, `Apache-2.0 OR MIT`, `Zlib OR Apache-2.0 OR MIT`, `MIT OR Apache-2.0 OR LGPL-2.1-or-later`). Choosing MIT from every `OR` (and `/`, the old Cargo separator) means three texts cover all of them.

- [ ] **Step 1: Write the failing tests** (in `scripts/third-party-notices.test.mjs`)

```js
import { chooseLicence, fallbackText } from './third-party-notices.mjs';

it('an OR expression prints MIT when MIT is offered', () => {
  expect(chooseLicence('Zlib OR Apache-2.0 OR MIT')).toEqual(['MIT']);
  expect(chooseLicence('Apache-2.0/MIT')).toEqual(['MIT']);
  expect(chooseLicence('MIT OR Apache-2.0 OR LGPL-2.1-or-later')).toEqual(['MIT']);
});
it('an AND expression prints every part', () => {
  expect(chooseLicence('MIT AND BSD-3-Clause')).toEqual(['MIT', 'BSD-3-Clause']);
});
it('MIT text names the authors as copyright holders', () => {
  const text = fallbackText({ name: 'block2', licence: 'MIT', authors: ['Mads Marquart <m@example.org>'] });
  expect(text).toMatch(/^Copyright \(c\) Mads Marquart$/m);
  expect(text).toContain('Permission is hereby granted, free of charge');
});
it('a package with no authors is credited to its authors by name', () => {
  expect(fallbackText({ name: 'dlopen2', licence: 'MIT', authors: [] })).toMatch(/^Copyright \(c\) the dlopen2 authors$/m);
});
it('a licence with no vendored text fails with the package name', () => {
  expect(() => fallbackText({ name: 'x', licence: 'EUPL-1.2', authors: [] })).toThrow(/x.*EUPL-1\.2/);
});
it('the committed notices have no placeholder entries', () => {
  expect(readFileSync('src/assets/notices/third-party.txt', 'utf8')).not.toContain('(no licence file;');
});
```

- [ ] **Step 2: Run** `pnpm vitest run scripts/third-party-notices.test.mjs`. Expected: FAIL (no exports; placeholders present).
- [ ] **Step 3: Implement**
  - The three texts come from the SPDX licence list (`https://github.com/spdx/license-list-data`, `text/<id>.txt`, CC0-1.0). MIT and BSD-3-Clause have a `Copyright (c) {{copyright}}` line in place of the template's holder line; `README.md` records the source and commit.
  - `chooseLicence`: split on ` AND ` first; each part split on ` OR ` or `/`, taking `MIT` if offered, else the first id. Parentheses are stripped.
  - `fallbackText`: the texts of `chooseLicence(pkg.licence)` joined by a blank line, `{{copyright}}` replaced by the authors with any `<email>` removed and joined by `, `, or `the <name> authors` when there are none. An id with no file throws `Error(\`no licence text for ${name} (${id})\`)`.
  - Rust packages pass `p.authors` from `cargo metadata`; npm packages pass `entry.author` as a one-element list when present.
  - `render` uses `fallbackText(pkg)` where it now prints the placeholder.
- [ ] **Step 4: Run** `node scripts/third-party-notices.mjs`, then `pnpm vitest run scripts/third-party-notices.test.mjs` and `node scripts/third-party-notices.mjs --check`. Expected: PASS. Open the About page in `pnpm dev` and check that the notices still scroll and load.
- [ ] **Step 5: Commit** `fix(about): print the licence text for components that ship no licence file` (the regenerated `third-party.txt` in the same commit).

### Task 4: The release job

**Files:**
- Create: `scripts/release.mjs`, `scripts/release.test.mjs`, `.github/release-notes.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces, exported from `scripts/release.mjs`:
  - `parseTag(tag: string, packageVersion: string): { version: string, prerelease: boolean }`: throws when the tag is not `v<semver>` or `v<semver>-rc.<n>`, or when the version part differs from `packageVersion`.
  - `pickInstallers(names: string[]): string[]`: the names matching `*-setup.exe`, `*.dmg` or `*.AppImage`, sorted; throws unless exactly one of each kind.
  - `candidateFor(sha: string, releases: { tagName: string, sha: string }[]): string | null`: the newest `-rc.N` tag (highest N) whose commit is `sha`.
  - `resolveSource({ tag: string, prerelease: boolean, sha: string, releases: { tagName: string, sha: string }[] }): { kind: 'build' } | { kind: 'copy', from: string }`: `build` for a release candidate; for a release, `copy` from `candidateFor(…)`, and an `Error('no release candidate on this commit')` when that is `null`.
- CLI: `node scripts/release.mjs <tag> <artifacts-dir> [--dry-run]`. Uses `gh` for release lookups, downloads and `gh release create`. Writes `SHA256SUMS.txt` (`sha256sum` format) next to the files.

- [ ] **Step 1: Write the failing tests** (`scripts/release.test.mjs`)
  - `parseTag('v0.1.0-rc.1', '0.1.0')` is `{ version: '0.1.0', prerelease: true }`; `parseTag('v0.1.0', '0.1.0')` is `{ version: '0.1.0', prerelease: false }`.
  - `parseTag('v0.2.0', '0.1.0')` throws `/0\.2\.0.*0\.1\.0/`; `parseTag('v0.1.0-beta', '0.1.0')` and `parseTag('0.1.0', '0.1.0')` throw.
  - `pickInstallers(['Aji_0.1.0_x64-setup.exe', 'Aji_0.1.0_aarch64.dmg', 'Aji_0.1.0_amd64.AppImage', 'bundle_dmg.sh', 'Aji.app', 'Aji_0.1.0_amd64.AppImage.tar.gz'])` returns the first three, sorted; a list missing the `.dmg` throws.
  - `candidateFor('abc', [{ tagName: 'v0.1.0-rc.1', sha: 'abc' }, { tagName: 'v0.1.0-rc.2', sha: 'abc' }, { tagName: 'v0.1.0-rc.3', sha: 'def' }])` is `'v0.1.0-rc.2'`; with no tag on `abc`, `null`.
  - `resolveSource({ tag: 'v0.1.0', prerelease: false, sha: 'abc', releases: [{ tagName: 'v0.1.0-rc.3', sha: 'def' }] })` throws `/no release candidate on this commit/`; with `rc.1` on `abc` it is `{ kind: 'copy', from: 'v0.1.0-rc.1' }`; `prerelease: true` is `{ kind: 'build' }` whatever the releases.
- [ ] **Step 2: Run** `pnpm vitest run scripts/release.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `scripts/release.mjs`.** CLI flow:
  1. `parseTag(tag, version from package.json)`.
  2. A release candidate: `pickInstallers` over the downloaded artifacts (searched recursively), write `SHA256SUMS.txt`, `gh release create <tag> --prerelease --title "Aji <tag>" --notes-file <notes> <files>`.
  3. The release: list releases (`gh release list --json tagName`, then `git rev-list -n 1 <tag>` for each), `resolveSource` with `GITHUB_SHA`. For `copy`, `gh release download <rc> --dir <dir>`, check the downloaded `SHA256SUMS.txt` against the files, and create `<tag>` without `--prerelease` from those files, so the walked files ship.
  4. `--dry-run` does every read (including the release candidate's download and checksum check), prints the tag kind, the source, the files, their checksums and the notes, and creates nothing.
  - Notes: `.github/release-notes.md` with `{{tag}}` and `{{commit}}`. It says the installers are unsigned. Windows shows SmartScreen ("More info", then "Run anyway"). macOS needs System Settings → Privacy & Security → "Open Anyway" once. Linux is built but untested. Link `docs/acceptance/phase-1.md` on `main`.
- [ ] **Step 4: Change `ci.yml`**
  - Top level: `permissions: contents: read`.
  - `workflow_dispatch` gets an input `release-rehearsal` (string, default empty): a tag name to rehearse at the dispatched commit, such as `v0.1.0-rc.1` or `v0.1.0`.
  - `bundle`'s `if` becomes `github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch'`.
  - New job `release`: `needs: bundle`; `if: startsWith(github.ref, 'refs/tags/v') || inputs.release-rehearsal != ''`; `runs-on: ubuntu-24.04`; `permissions: contents: write`; checkout with `fetch-depth: 0` (tags for `git rev-list`); `actions/download-artifact` into `artifacts/`; `GH_TOKEN: ${{ github.token }}`. Dry-run is decided by the input, not the ref: with `release-rehearsal` set, run `node scripts/release.mjs "<input>" artifacts --dry-run`; on a tag push, `node scripts/release.mjs "${{ github.ref_name }}" artifacts`.
- [ ] **Step 5: Run** `pnpm test` and `pnpm lint` (Prettier covers the YAML). Expected: PASS. Run the CLI locally with `--dry-run` against a folder of empty files named like the three installers, with `GITHUB_SHA` set; expect the listing and no `gh release create`.
- [ ] **Step 6: Commit** `ci: publish the installers as a GitHub release on a version tag`.

### Task 5: The checklist and the backlog

**Files:**
- Create: `docs/acceptance/phase-1.md`, `docs/backlog/phase-1-deferred.md`
- Modify: `docs/superpowers/plans/2026-11-19-phase-1-roadmap.md` (M8 entry)

- [ ] **Step 1: Write `docs/acceptance/phase-1.md`**, from design 5.4:
  - A "versions under test" block (Aji tag and commit, KataGo version and backend, network, OS, GPU and driver), one per machine, left blank.
  - The setup of the walk: a new OS account on each machine; on the PC a Chinese account name such as 测试; the installer from the release-candidate page, downloaded with that account's browser.
  - Steps 1 to 9 of design 5.4 as a table: step, what to do, what passes, PC result, Mac result. Results are blank; "not walked" is allowed. Step 6 also carries audit G11: 100%, 150% and 200% scaling, and moving the window between screens of different scale.
  - What the PC sends back (design 5.1): the screenshot of the detection rows, the 测速 result, a failure panel with its stderr if any, and optionally DirectML's 测速.
  - A "not covered by Phase 1" section: Linux (built in CI, not run); the Metal build on macOS 13; a laptop whose integrated GPU is listed first; D1; the full R4 backend comparison.
- [ ] **Step 2: Write `docs/backlog/phase-1-deferred.md`.** Sources:
  - the Status blocks of the M1 to M7 plans;
  - the S5 audit's open item X1;
  - `.superpowers/sdd/2026-11-20-phase-1-m4-install-pipeline/`;
  - the author's notes from each final review, `/Users/zepher/.claude/projects/-Users-zepher-personal-Aji/memory/m1-…` to `m7-deferred-review-findings.md`.
  
  Group by area (engine and manager, SGF and board, analysis UI, wizard and settings, CI and tooling, release), and give each item its origin (for example "M6 minor 4"). Leave out what M8 fixes (design section 6) and what was already fixed (M6 minors 7, 8, 11, 12; M4 items taken into M5 that shipped, per the M5 plan's Status). The M5 plan counts sixteen minors and the notes list thirteen: look for the other three in the M5 plan, and otherwise write the gap down. Add the full R4 comparison and the PC capture script with its `pc_capture_gives_the_rtx5070` test, the Linux check and R3 (Phase 8), and the second half of M1 minor 7.
- [ ] **Step 3: Roadmap M8 entry.** Link this plan and the design. The Linux line becomes "moved to Phase 8 (owner, 2026-11-21)". Note that R3 moved to Phase 8 in section 7.
- [ ] **Step 4: Run** `pnpm lint` (Prettier checks Markdown). Expected: PASS.
- [ ] **Step 5: Commit** `docs: add the Phase 1 acceptance checklist and the deferred backlog`.

### Task 6: Push, rehearse the release, and the distribution checks (owner-gated)

- [ ] **Step 1:** Ask the owner to push `feat/m8-acceptance`.
- [ ] **Step 2:** Ask the owner to run CI by hand on the branch with `release-rehearsal` set to `v0.1.0-rc.1` (Actions → CI → Run workflow).
- [ ] **Step 3:** Read the run. Every job is green on all three OSes. The `release` log lists exactly one `.exe`, one `.dmg` and one `.AppImage`, their checksums and the rendered notes, and creates nothing.
- [ ] **Step 4:** Download that run's `.dmg` artifact and open it on the Mac once: it mounts, the app starts, and the About notices show no placeholder. `rc.1` is public, so this is the first look at a CI build before anyone else can download one.
- [ ] **Step 5:** Download the Metal engine zip from the `aji-manifest` release `katago-v1.18.2-metal`. Check that `THIRD-PARTY-LICENSES.txt` holds the `katagocoreml` section, whose NOTICE covers coremltools. Record the result in `docs/acceptance/phase-1.md` (design 5.8).
- [ ] **Step 6:** Ask the owner to confirm the WenKai reading (design 5.8). Steps 4 to 6 come before `rc.1`, as decision 5 requires.

### Task 7: Publish the signed manifest (owner-gated)

- [ ] **Step 1:** Ask the owner to push `aji-manifest` `main` (two commits: `1773945`, `b6f32d8`).
- [ ] **Step 2:** Ask the owner to run `manifest.yml` with `aji_ref` = `feat/m8-acceptance`. Read the run: `generate`, `sign` and `deploy` pass, and the deploy job's check against Aji's trusted keys passes.
- [ ] **Step 3:** `curl -sf https://reallxuan.github.io/aji-manifest/v1/manifest.json | jq .sequence` prints a number above the bundled `1795103730`, and `manifest.json.minisig` is served beside it.
- [ ] **Step 4:** `cargo run -p aji-manager --bin aji-setup-report -- --fetch`. The output's `manifest.source` is the fetched copy, and `rejected` is empty.
- [ ] **Step 5:** The M3 tamper check, on a scratch data folder (`AJI_DATA_ROOT`): change one byte of the cached copy, and the report falls back to the bundled copy with one `rejected` line.
- [ ] **Step 6:** Compare the fetched manifest's first main network and newest versions with the bundled copy's, and write any change down for the owner. The walk installs whatever the fetched copy preselects.

### Task 8: Merge and the first release candidate (owner-gated)

- [ ] **Step 1:** Ask the owner whether to merge into `main` (as M5 to M7) or `dev`. Merge locally with `--no-ff`, then run the checks on the merged result.
- [ ] **Step 2:** Ask the owner to push `main`, then to tag `v0.1.0-rc.1` on it and push the tag.
- [ ] **Step 3:** Read the tag's CI run. The pre-release `v0.1.0-rc.1` exists with the three installers and `SHA256SUMS.txt`, and downloading the `.dmg` in a browser works without signing in.
- [ ] **Step 4:** Install that `.dmg` on the Mac (the author's own account), start `/Applications/Aji.app/Contents/MacOS/aji` from a terminal, and check that the log reads `aji: manifest Fetched sequence <n>` with the published sequence (design 5.7).

### Task 9: The walk and its record (owner)

- [ ] **Step 1:** The owner walks `docs/acceptance/phase-1.md` on the Mac and on the PC, from new accounts, and sends back the results and screenshots.
- [ ] **Step 2:** Fill in the checklist from the report, word for word for system prompts. A step nobody performed is "not walked".
- [ ] **Step 3:** Apply design 5.2:
  - CUDA ran: put the 测速 number (and DirectML's, if measured) into a working copy of the charter 6.3 text for Task 10.
  - DirectML is close: ask the owner which default to use.
  - CUDA failed: Task 9a.
- [ ] **Step 4:** For every failed step, apply design section 6's last rule: fix in M8 (Task 9a) or add it to the backlog. The owner can overrule.

### Task 9a: Fix rounds (only if Task 9 found failures)

- [ ] **Step 1:** Branch `fix/m8-<topic>` from `main`. Turn the failure into a test that fails first. A PC stderr becomes a classifier fixture in `aji-manager`, and if the cause is the driver, it also settles the `gpuDriverTooOld` pattern.
- [ ] **Step 2:** Fix, run the checks, commit, and merge with the owner's go-ahead.
- [ ] **Step 3:** The owner pushes and tags `v0.1.0-rc.<n+1>`. Re-walk the failed steps, plus the install path when the fix touched setup.

### Task 10: v0.1.0 and the record (owner-gated)

- [ ] **Step 0:** Rehearse the copy path in CI first (design 7). Ask the owner to run CI by hand on `main` at the accepted candidate's commit with `release-rehearsal` set to `v0.1.0`. The `release` log names the accepted `rc` tag, downloads its three installers and verifies their checksums, and creates nothing. This proves the checkout has the tags and the token can read the release before the real `v0.1.0` push.
- [ ] **Step 1:** Ask the owner to tag `v0.1.0` on the accepted release candidate's commit. Read the run. The release uses the candidate's files, and its `SHA256SUMS.txt` matches the candidate's.
- [ ] **Step 2:** Branch `docs/m8-record` from `main`, then:
  - commit the filled-in `docs/acceptance/phase-1.md`;
  - README: replace the status line with "**Status: Phase 1 (v0.1.0): engine setup, opening game records, and live analysis on the board.**", then one paragraph on what was checked by hand (Windows and macOS on Apple Silicon, per the record), that Linux is built but not checked, that the installers are unsigned, and a link to `docs/acceptance/phase-1.md`;
  - charter 6.3: replace "The NVIDIA defaults are provisional until R4's benchmarks on the RTX 5070 arrive" with the measured numbers, marked as measured by the app's 测速 on the default only;
  - charter section 8: Phase 1 done on that date, with the tag;
  - roadmap: M8's Status, section 7 (R4 answered for the default, R3 moved to Phase 8);
  - this plan's Status.
- [ ] **Step 3:** Merge with the owner's go-ahead. Update the author's notes: retire the M1 to M7 deferral notes that the backlog file now holds, and keep one pointer to the backlog file.
