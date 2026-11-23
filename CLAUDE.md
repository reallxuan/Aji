# Aji: rules for coding agents

Aji is a cross-platform KataGo GUI built with Tauri 2 (Rust core, TypeScript and React interface). The project charter is the source of truth for scope, architecture and roadmap: `docs/superpowers/specs/2026-11-19-aji-project-charter-design.md`. Read it before planning any work.

## Language

- Write everything in the repository in English: commit messages, documentation, code, comments, identifiers, branch names, pull request titles and descriptions, issue text.
- Use Chinese only for Chinese interface text: the `zh-CN` locale files, and Chinese UI labels quoted from other software (for example a LizzieYzy menu name) when the original wording matters.
- This rule covers what goes into the repository and onto GitHub. In conversation, reply to the maintainer in the language they write in.

## Internationalisation

- The interface ships in Simplified Chinese (`zh-CN`) and English (`en`). More languages are added later.
- Every user-visible string goes through the i18n layer. Do not hard-code interface text in components, in either language.
- When adding or changing a string, update both `zh-CN` and `en` in the same change.
- Never use the middle dot "·" as a separator in interface text, in any language. Use a space, a comma or parentheses instead. A test in `src/i18n/parity.test.ts` checks the locale files.

## Git workflow

- Never commit directly to `main`. Branch from `main`, and merge through a pull request.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` and so on).
- Keep history tidy: fold a correction into the unpushed commit it belongs to (amend or rebase) instead of adding a fix-up commit. Never rewrite commits that are already on `main`.
- Commits use the repository-local git identity. Do not change git configuration.
- Push and open pull requests only when the maintainer asks.

## Scope rules

- KataGo is the only supported engine. Do not add other engines or generic GTP engine support.
- Board sync is read-only. Do not implement automatic move placement into online game clients, or two-way sync.
- LizzieYzy is GPL-3.0 and is a feature reference only. Do not copy or translate its code.

## License

- Aji is licensed under AGPL-3.0-or-later. Only add dependencies whose licenses are compatible with it (MIT, BSD, Apache-2.0, MPL-2.0, LGPL and GPL-3.0 are; proprietary and non-commercial licenses are not).
- Do not paste code from other projects without checking its license and recording where it came from.

## Architecture rules

- The interface never assumes the engine runs on the same machine. It talks to the engine side only through serialisable messages behind the transport interface (Tauri IPC locally, WebSocket remotely). See charter section 6.1.
- `aji-core` depends on no other crate in the workspace.
