# Phase 2 M4 Design, part 1: Engine Profiles and the Console

- Date: 2026-11-25
- Status: Approved by the owner on 2026-11-25. A builder check read it first; four of its questions are answered in the design as the author's calls, and the fifth (what the console is for) by the owner.
- Plan: [Phase 2 plan](../plans/2026-11-21-phase-2-roadmap.md), section 6, M4, and section 4.3 (the analysis cache)
- Mockup: [engine profiles and console](../../design/mockups/p2-m4/engines.html)
- Interface design: [aji-ui-design](2026-11-19-aji-ui-design.md)
- Markers follow the charter: **[Decided]** by the owner, **[Proposed]** by the author, **[To verify]**.

M4 is designed in three parts, one at a time, each with a mockup (agreed with the owner on 2026-11-25): this part (engines), then shortcuts and mouse bindings, then sessions. Visits along the hovered line, the coverage check, the acceptance walk and `v0.2.0` come after the three.

## 1. Intent

**[Decided]** The owner switches engines for two reasons: to compare kinds of network (for example b28 against zhizi b40 or b18), and to move to a newer network when one comes out. M4 makes both a one-click switch, and lets Aji run a KataGo, network and config the owner already has (audit P2-G1).

The engine log and a raw protocol console let an expert see what KataGo is doing and ask it things directly, as LizzieYzy's GTP console does. **[Decided]** The owner uses LizzieYzy's console to read the log and check the version, not to run searches.

Success: the owner keeps two or three networks side by side and switches between them during a review without opening settings, and a new network is downloaded or imported and used in a minute.

## 2. Goals, non-goals, anti-goals

**Goals**

- A list of engine profiles, each a KataGo build, a network and the thread count, or the owner's own three files.
- Switching in one click from the header, on desktop; a second tap on the phone is acceptable.
- Adding a profile: a network from the manifest, an imported network file, or one's own KataGo files.
- Renaming and removing profiles; deleting their files only when no other profile uses them.
- The engine log and a protocol console with input.
- The four backlog items in the engine code (section 9).

**Non-goals** **[Proposed]**

- Editing KataGo's config inside Aji. A profile of one's own files uses that config as it is; a managed profile uses the config Aji writes today.
- Two engines at once. LizzieYzy keeps separate engines for the estimate and for fast switching; Aji's profiles replace them with one engine at a time (plan, M4).
- Generic GTP engines, or engines other than KataGo (charter scope).
- A "new network available" notice. The manifest already lists the newest network; noticing it is left for later.
- The human-style network (`b18c384nbt-humanv0`). It is not a main network and needs a second model alongside one. It stays out of the profile list.

**Anti-goals**

- Results from one network shown as if they came from another (plan, review focus 4). Switching must never leave the old profile's winrates on the board, graph or swing list.
- A switch that silently loses analysis. Results stay in the cache under their own engine identity, and come back when the owner switches back.
- A console that breaks Aji's own analysis. Typing in the console must not end or confuse Aji's queries.

## 3. Constraints

- The interface talks to the engine side only through serialisable messages (charter 6.1). Paths are paths on the engine's machine, and file dialogs open there, as `setupImportNetwork` does today.
- The cache key is the position plus the engine identity: the network's digest and a hash of the config settings that change search results (plan 4.3). Thread counts do not count. Nothing migrates or wipes the cache.
- Every string goes through i18n, in `zh-CN` and `en`, with no middle dot.
- `aji-core` depends on no workspace crate.

## 4. What exists today

- The install record (`crates/aji-manager/src/install/record.rs`) already keeps several engine sets, each a build, a network, a config and threads (with benchmark speeds), and marks one `active`.
- Settings, Engine shows the active set, a benchmark row, Restart, Stop and Set up again, and a "Remove unused" row.
- "Remove unused" deletes everything the active set does not use (`unused.rs`). So a network the owner used last week counts as unused today.
- Installing another network (Set up again) creates a set and makes it active, reusing the build.
- `settings.json` may hold a `devEngine` (three paths) that takes precedence over the active set.
- The engine indicator (the dot) pauses and resumes on click, and its hover card shows the engine and network.

So profiles are mostly a name and a switch over sets the record already keeps, plus a new kind for one's own files.

## 5. Approaches

| Approach | Trade-off |
|---|---|
| **A. Profiles over the install record's sets, plus own-file profiles** (chosen) | Reuses installs, benchmarks and the cache identity as they are. "Unused" changes meaning: files no profile uses. |
| B. Profiles as a separate list in `settings.json`, each pointing at files | One shape for both kinds, but it duplicates what the record keeps and lets the two drift. |
| C. Only own-file profiles; managed installs stay single | Least work, but switching between downloaded networks, the owner's main use, needs the wizard each time. |

**[Proposed]** A. The owner's use is switching between downloaded networks, which the record already supports underneath.

## 6. What is built

### 6.1 What a profile is

- **Managed profile:** one set of the install record. It shows its name, the build (version and backend), the network and the thread count with its measured speed.
- **Own-files profile** (audit P2-G1): the paths of a KataGo binary, a network and a config on the engine's machine. Aji runs them as `devEngine` is run today: working folder at the config's folder, config by file name. Thread count and everything else come from the config.
- **Name:** by default the network's display name (as the card shows today), cut in the middle when long. The owner can rename it. Names need not be unique.
- **Current profile:** exactly one, or none before setup. It replaces the record's `active` as the single source of truth for what runs.
- **The developer override** **[Proposed]:** while `devEngine` is set in `settings.json`, it runs instead, as today. The switcher shows it as one locked entry, "开发引擎 (settings.json)", with the profiles greyed out.

### 6.2 Switching

- **Desktop:** a profile chip in the header, left of the engine dot, shows the current profile's name. A click opens a menu:
  - the profiles, the current one checked, each with its network and speed in a second, muted line;
  - a separator, then 添加引擎…, 引擎控制台, 管理引擎….
- **Phone** **[Proposed]:** the compact header has no room for the chip. The profiles show as a list with a check in Settings, Engine, where one tap switches. 引擎控制台 is reached from there too.
- **What a switch does:**
  - KataGo restarts with the new profile's files.
  - The board, the candidate list, the graph and the swing list show only results under the new engine identity. Positions this profile has analysed before show at once from the cache; the others are analysed as usual.
  - Switching back shows the earlier results again.
  - The graph, swing and estimate stores in the interface are reset on a switch and read again. The graph's store keeps whichever result is deeper, so without a reset an older profile's deeper result would stay.
  - **[Proposed]** Results imported from a file's `LZ` properties stay under the engine identity that was current when the file opened (P2 M2 design 5.11). After a switch they are not shown, and they come back on switching back. They are not lost, and they are never shown under a profile they were not filed under.
- **While whole-game analysis runs** **[Proposed]:** a switch first asks "切换引擎会停止整盘分析。仍然切换吗？" and stops the job on yes. The owner restarts it under the new profile.
- **A profile that fails to start:** the usual crash panel shows, with its stderr tail. The profile stays current, so the owner can read the console or switch back.
- **Commands:** `engine.profile.next` and `engine.profile.previous`, unbound by default, so the shortcut editor (part 2) can bind them.

### 6.3 Adding a profile

From 添加引擎… (the chip menu or Settings) a small dialog offers three ways:

1. **下载权重:** the manifest's network list, as the wizard's network step shows it. It runs the existing install job, which downloads the network only. The new set becomes a profile and the current one.
2. **导入权重文件:** the existing import, then a set, as today.

**Which build** **[Proposed]:** the current profile's build, or, when the current profile is an own-files one, the newest installed build. The dialog names it ("使用 KataGo 1.16.4（Metal）").

**Threads** **[Proposed]:** a new profile starts with the thread count of the profile it was added from, and no measured speed. Measuring takes minutes and works against using a new network in a minute. The profile's row in Settings offers 测速, and the menu's second line shows a speed only once measured.
3. **使用自己的 KataGo:** three fields for the binary, network and config, each with a Browse button that opens the file dialog on the engine's machine. Aji checks the files before saving:
   - each file exists;
   - the binary runs `katago version`;
   - the engine identity can be read.

   A failed check names the file and the reason. On success the profile is added and becomes current.

When there is no build yet (no managed profile), 下载权重 and 导入权重文件 open the wizard instead.

### 6.4 Managing profiles

- Settings, Engine lists the profiles. Each row shows the name, the network and the build (or "自己的文件" with the binary's path), the speed, and a menu with 重命名 and 移除.
- **Removing** **[Proposed]:**
  - the current profile cannot be removed; switch first;
  - removing a profile takes it off the list, with no confirmation, since nothing is deleted yet;
  - its files count as unused only when no other profile uses them.
- **The unused row:** "Remove unused" now deletes files no profile uses, with the existing confirmation and size. Own-file profiles point outside Aji's folders and are never deleted.
- The benchmark row measures the current profile, as today. An own-files profile has no benchmark row; its threads come from its config.
- Restart, Stop and Set up again stay.
- **A newer KataGo** **[Proposed]:** Set up again with a newer build adds a profile, as it adds a set today. Existing profiles keep their build, which counts as unused only once no profile uses it.

### 6.5 The engine console

- **Where:** a panel kind, 引擎控制台, in the panel registry. It is in no preset by default. 引擎控制台 in the chip menu adds it to the current layout (or shows it if it is there) at the right column's bottom. On the phone it opens as a full-height sheet over the panel area.
- **What it shows:** one scrolling list of lines, newest at the bottom, each with a time and a kind:
  - **日志:** KataGo's stderr;
  - **Aji:** Aji's own notes, such as "started" with the profile and files, the exit code, a switch;
  - **发送** and **接收:** the analysis protocol's JSON, the queries Aji sends and KataGo's replies.
- **Filters:** 全部, 日志, 协议. Plus 暂停滚动, 复制, 清空.
- **Long lines:** a reply over 400 characters shows its first 400, with 展开 to see it whole.
- **Input:** a one-line field at the bottom takes a JSON query and sends it on Enter.
  - Aji fills in `id` as `console-<n>` when it is missing, and routes replies to `console-` ids to the console only.
  - **[Proposed]** Only queries with an `action` are sent, such as `query_version`, `query_models` or `clear_cache`. A search query (one without an `action`) is refused with a line saying why. Aji's own analysis holds the engine (`numAnalysisThreads = 1`, a query of practically unlimited visits), so a search would wait until analysis is paused, and the owner does not need it (section 1).
  - **[Proposed]** Aji refuses `terminate_all`, and `terminate` for an id that is not a console id, with a line saying why: they would end Aji's own analysis.
  - Up and down recall earlier input.
- **Cost** **[Proposed]:**
  - stderr and Aji's notes are always kept: the last 1,000 lines, which also feed the crash panel's tail;
  - protocol lines are kept only while a console is open in some client: the last 5,000 lines, each cut at 64 KB.
  - So the console starts showing traffic when it opens, and the analysis path pays nothing while it is closed.
- **Through the transport:** a request opens or closes the console's subscription, and another returns the kept lines. An event carries new lines, batched at most every 100 ms. Another request sends a console query. A remote client sees the same console.

## 7. Protocol

Requests and replies, camelCase, with ts-rs bindings regenerated. **[Proposed]** The names are the builder's to adjust:

- `engineProfiles` → the list and which is current, or that `devEngine` overrides.
- `engineProfileSwitch { id }`, `engineProfileRename { id, name }`, `engineProfileRemove { id }`.
- `engineProfileAddOwn { katago, model, config }`, refused with a reason per file.
- `setupPickFile { purpose }` → a path chosen on the engine's machine, or none.
- `engineConsoleOpen { open }`, `engineConsoleLines`, `engineConsoleSend { query }`, and the event `engineConsoleLines { lines }`.
- New error codes in `ErrorCode` and both locales: for example `engineProfileCurrent` (removing the current profile), `engineFileMissing`, `engineFileNotKatago`, `engineConsoleRefused`.

`setupInstalled` and `setupRemoveUnused` keep their names. Their meaning of "unused" changes as in 6.4.

## 8. Storage

**[Proposed]** The profile list lives in the install record, which `aji-manager` owns. The record stays on schema 1 and only gains fields with defaults:

- a name on each set;
- a list of own-file profiles beside the sets;
- `current`, the current profile, beside `active`.

`active` keeps its shape and always names the current managed set, or the last one used while an own-files profile is current. A record from v0.1.0 reads as one profile per set, with the active set current.

Why not a new schema number: `parse_installed` renames a record with any other schema to `installed.json.bad-<time>` and starts empty. An older Aji would then look uninstalled and lose the profiles. With added fields, an older Aji ignores them and runs the active set.

## 9. Backlog items in this code

- **M2 N1 (re-check first):** after a kill, Aji waits for a KataGo that does not die with no deadline. Wait at most a few seconds, then report the engine as crashed with a reason that says it would not exit, and go on.
- **M5 minor 7:** Restart and Stop are disabled while KataGo starts, so a KataGo hanging at start cannot be stopped. Enable both while starting.
- **M5 minor 10:** the wizard's offer after a declined licence uses the recommendation's backends, while the server offers default plus fallbacks, and neither skips a backend that needs the same licence. Use one list for both, and skip backends that need a licence already declined.
- **M5 minor 11:** `remove_unused` holds the jobs lock while deleting, and `import_network` copies without it, so the two can race. Profile changes, import, install and removal all go through one lock on the record. Removal reads the list of unused files inside that lock.

## 10. Left to the builder

- The exact protocol names and payloads (section 7).
- How a profile id is formed (the set key for managed profiles is natural).
- How the menu shows a long list of profiles (a scroll past about eight).
- The batching and paging of console lines.

## 11. Exit check

On the Mac, in `pnpm tauri dev`, both themes, desktop and phone width:

- download a second network from 添加引擎, switch between the two from the header, and see each one's results come back from the cache;
- switch while whole-game analysis runs, and see the question;
- add an own-files profile pointing at the Homebrew KataGo, a network and its config; break one path and see the check name it;
- remove a profile and see its network listed as unused, then delete it;
- open the console, see stderr and protocol lines, send `{"action":"query_version"}` and see the reply, and see `terminate_all` and a search query refused;
- the four backlog items, each with a test.

## 12. Built

Built on 2026-11-26 as designed; the plan's Status has the checks, the review and what is outstanding. Where the build differs from the sections above:

- **6.2.** Choosing the profile already running does nothing, from the chip, the list or a command. A switch or an add is refused while an install or benchmark job runs, before any whole-game job is stopped, and one lock covers the record write and the hand-off to KataGo.
- **6.3.** Adding one's own KataGo asks no question while a whole-game job runs; it is the user's explicit choice, and the job's results are kept.
- **6.5.** A query typed with its own id goes out as `console-<id>`, so no reply reaches Aji's queries. The interface keeps 1,000 log and 5,000 protocol lines, like the backend. A refused query is noted in the console only, as an Aji line. The list is not virtualised.
- **8.** Removing unused files keeps any file of Aji's that an own-files profile uses (its top-level entry in Aji's folders); files outside Aji's folders are never touched.
- **9.** M2 N1 was already met by the engine giving up 5 s after a kill; the new process-level deadline is a backstop.
