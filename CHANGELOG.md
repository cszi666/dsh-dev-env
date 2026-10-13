# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A project clause can be carried into a conversation, automatically or by hand.** The picker sits at
  `conversation.input.dock` — directly above the composer, in the row that already holds the todo, goal
  and queue entries. That slot is a **list** with `replaceRisk: none`, so a new id is added beside them.
  The blank-session Hero was rejected for this: all three of its seats are `single` and already occupied,
  so registering there would have replaced shipped UI to make room.
  - **Manual**: pick any project's clause and it is posted as this conversation's premise.
  - **Automatic**: `handoff.autoInject` loads this project's clause when a conversation starts. **Off by
    default**, because it spends tokens every time and a stale premise is worse than none. It is
    idempotent — one session tries once, so a refresh cannot post it twice — and it is a normal message,
    so it stays visible and revocable rather than hidden inside the context.
  - The clause has its own framing: `clausePrompt` presents it as *the project's standing premise* and
    asks the reader to flag anything stale, which is a different job from `handoffPrompt`'s "this summary
    replaced the history". Both keep the `<summary>` shape, so neither side needs a second vocabulary.
  - No tool accepts a path from the caller any more, and a guard checks each tool's parameters block. The
    project is always derived from the calling session, because a model writing a Windows path into a tool
    argument is what produced the `MALFORMED_RESPONSE` that discarded a whole turn.

### Added

- **The task list is editable, and DSH can read and change it.** Tasks became structured records
  (`{ id, text, done, tag }`) instead of plain strings, because reordering and deleting both need a
  stable identity: keyed by text, two tasks with the same wording collide, and keyed by index a drag
  invalidates every key. The right-hand column now supports **drag to reorder** (order is priority),
  add, delete and a per-task tick, and a renamed task keeps its place and its id. Dragging uses the
  native HTML5 events rather than a library, since this plugin has no dependencies and a single list is
  not worth the first one.
  - **`dev_env_tasks`** is the new agent tool: `list`, `add`, `update`, `move`, `remove`, `clear`. A
    conversation can ask what is left instead of asking the user again, and can record what it finds
    while working. The project comes from the calling session, never from an argument.
  - Old records keep working: a stored `['一件事']` is read as a task with a generated id and upgraded on
    the next save. Dropping those entries would have broken the promise that this area stays reproducible.
  - A ticked task moves out of **Next Steps** and into **Current State** in the generated summary, so a
    finished item no longer tells the next conversation to do it again — the failure the clause exists to
    prevent, in miniature.

### Changed

- **The 交接 tab is now 项目条例 (project clause), laid out as two columns.** The rename follows from what
  the record actually is: it belongs to the project and states what that project is about, so calling it
  a handover described only one of its three uses. The layout now separates the two questions it answers:
  the **left column is 需要提交的事** (the goal and constraints, what is already done, the lessons and
  traps, the next step) and the **right column is 任务清单**, the work still to do, **grouped by tag**.
  That distinction is not decoration — the left column is what is or will be handed over, the right is
  what remains — and grouping the right column by tag is what makes the tag list useful rather than
  cosmetic. On a narrow viewport the columns stack, because long text in a half-width column is hard to
  read.
  - The tab's explanatory line is now its own string rather than the task-list panel's, which was about
    handing a job list to a conversation and read as nonsense here. The unused key was deleted rather
    than left behind as dead copy.
- **A failed save carries its reason.** `saveRecords` returned a boolean, so "no storage path" and "the
  path could not be created" produced the same vague message — which is what sent the earlier
  investigation toward the environment variables while the path had in fact resolved correctly. It now
  returns `{ ok, error }`, and the reason names the path and the underlying cause.

### Changed

- **A handover record is keyed by project, not by conversation.** Keeping it per session was wrong for
  the way it is actually used: two of the three intended cases are cross-project — a branch needing the
  parent project's material, another project wanting its lessons — and a note private to one conversation
  cannot serve either. Content now belongs to *the work*: the identity is the project directory, so any
  conversation in that project reads and writes the same record, which is what makes it a shared chest
  rather than a private note. The project is resolved from the session's `cwd`; with no directory to key
  on, the record falls back to per-session and **says so in the UI** rather than silently merging every
  conversation into one bucket.
  - Each record now has three layers with different lifetimes: the project identity (top level), the user
    tags, and the content. Tags are a user action and arrive empty; the plugin never invents them.
  - **Files written by the previous version still load.** That format was `{ bySession: {…} }`, and a user
    may already have one on disk, so those entries are read, keyed as `session:<id>`, marked with their
    degraded scope, and migrated on the next save. Silently dropping someone's handover would have broken
    the one condition attached to this refactor.
  - `GET /api/handoff` without an identity now returns the **index of projects** — the entry point for
    fetching another project's material. Delivery is by `projectKey`, since what is sent is project
    material rather than one conversation's property.

### Changed

- **A handover is emitted as DSH's own compaction summary, not a private format.** The requirement was to
  stop making the model re-learn how to read a handover, so the format question was answered by reading
  DSH rather than by inventing markup: `DEFAULT_SUMMARY_PROMPT` (CompactionControl) asks for five numbered
  sections — *Task Overview, Current State, Important Discoveries, Next Steps, Context to Preserve* —
  wrapped in `<summary></summary>`, and states that the format exists so a conversation's history can be
  **replaced** by it. A handover does exactly that job, so it now emits the same shape: the section names
  are DSH's, in DSH's order, in English on both language paths, while the content stays in the writer's
  language. Arriving in a new conversation it is indistinguishable from history compacted there. It also
  covers more than the four fields did — scenario 2 and 3 material (requirements, features, interfaces,
  and the lessons and traps worth reusing) belongs in sections 3 and 5, which the old wording had no
  place for.
  - The first draft printed the content twice, once as prose and again inside the summary. That is the
    opposite of the requirement, since the reader would parse the same facts twice, so the preamble is now
    one sentence saying what the block is and how to use it, and the summary is the only copy.
  - A sparse handover still writes all five headings and marks the empty ones, because a missing section
    name weakens the "this is a compaction summary" signal the whole change rests on.

### Added

- **One-click fill, and a tag chooser.** The 交接 tab can now ask this conversation's model to write the
  handover itself, and tag it on demand.
  - **Fill works through a tool, not through reading a reply.** DSH's `prompt` is one-way: the model's
    answer is another message and a plugin cannot read it back, so "post a prompt and collect the
    summary" is not available. DSH's own compaction works the same way — it replaces a span of history
    rather than returning text — so the plugin registers `dev_env_handoff_write` and the prompt asks for
    that call. The content lands in the project record and the panel picks it up on its next poll.
  - **The tool takes its session from `exec.agent.id`, not from the initiator.** `execute(args, exec)`
    receives the run context, whose `agent` is the agent the call belongs to. Reading the initiator was
    the obvious-looking shortcut and it is wrong precisely in this flow, because the turn is started by
    the plugin: it would write the record under the wrong project, and another project would then read it
    as its own material. A guard asserts the tool never falls back to it.
  - **Choosing `compact` when compaction is unavailable reports an error instead of quietly using
    `current`.** The two differ in cost — compaction rewrites this conversation's history — so
    substituting one for the other would do something the user did not agree to.
  - A `GET /api/handoff/capability` probe reports what this deployment can actually do, so the page can
    say whether the compact route exists rather than offering a control that fails.
  - **Tags are chosen by the user, all or some, defaulting to all.** `handoff.tagOnGenerate` sets only the
    initial state of that choice; the plugin never writes a tag on its own. The candidate list lives in
    one place so the UI and the docs cannot drift apart.
- **A settings page for the plugin's own defaults**, registered at `settings.section` with its own id, so  it joins `account` / `general` / `models` / `plugins` / `agent-presets` instead of replacing any of them.
  Each row states what the setting *changes* rather than only its name, because a switch whose effect
  cannot be stated is worse than no switch. Saving is explicit and takes effect immediately — no restart —
  and the page re-renders from the values the host **read back** rather than the ones submitted, so a
  value rejected as the wrong type is visible instead of looking accepted.
  - `handoff.autoFillMethod` chooses how one-click fill summarises a conversation, defaulting to
    `current` as requested. `current` hands the content to this conversation's model: most accurate, but
    it spends exactly the context the user is short of. `compact` uses DSH's compaction service instead
    and does not spend the current conversation — but that service's contract is to **rewrite the
    conversation's history in place**, replacing a span of messages with one summary node, so it compacts
    as a side effect rather than only producing a portable record. The setting's explanation states that
    consequence outright, because a choice whose cost is hidden is not really a choice.
  - `download.preferOfficial` is not decorative: it is the one place a preference changes behaviour. With
    it off, an install that names no source picks a verified domestic mirror instead of the official
    origin — the difference between a download progressing and crawling when the origin is slow.
    `download.showMirrors` affects only what the picker lists; hidden mirrors stay in the catalog.
  - Stored at `<profile>/dsh-dev-env/settings.json` as plain, hand-editable JSON and **normalised** on
    every read: unknown keys are dropped and a wrong-typed value falls back to its default. That matters
    because `'false'` is truthy in JavaScript, so trusting the file would silently flip a setting while
    looking as though it had been applied.
- **A 交接 (Handover) tab beside 对话 and 轨迹, holding the lean state of the work.** A conversation
  always runs out of room eventually, and continuing in a new one needs the *state of the task* — what is
  left, what is in progress, what is done, what comes next — rather than a transcript, which is long and
  mostly noise. The tab stores that as a small structured record per conversation, deliberately bounded
  so it stays readable when it is read into the *beginning* of the next conversation, where a long
  handover would crowd out the room it is meant to save.
  - It is keyed by session, which is what makes it a multi-conversation feature rather than a global
    note: a new conversation starts with an empty handover because it has not done anything yet, while
    the old one stays readable for whoever picks the work up.
  - **投给当前对话** renders the record as the opening prompt of another conversation and injects it
    there, and the text tells the reader not to re-derive what is already listed as done — the specific
    failure a handover exists to prevent.
  - The tab lives at `conversation.view` (the seat whose occupants are exactly `chat` and `trajectory`)
    because that seat is **session-scoped** and supplies a session identity, while the plugin's own
    `main/dev-env` seat supplies none. Registering an id of our own adds a tab beside the shipped two
    instead of replacing either.
- **Hand a task list to a conversation, and choose which one.** The job list is the unified progress
  view; this is the passing. **交接给对话** in the jobs header reads the visible sessions and offers them
  by working directory, newest activity first, showing only the ones that can actually accept a prompt
  (a subagent session cannot, so it is not offered). Picking one posts a summary of *every* job — status,
  phase, progress, rate and error, plus the last log lines of each — to exactly that session, while
  "交给当前对话" omits the id so the host picks the most recently active one. The message says explicitly
  that it is context rather than a request to change anything: the recipient's job is to know what is
  happening, not to start fixing it. This is possible because DSH's `sessionController` exposes `list()`
  (with `running`, `cwd`, `parentSessionId`) and `prompt({ sessionId })`; the panel only chooses the
  destination and never decides it on the user's behalf.
- **More entries can be installed without winget, and a failed winget install offers the route.**
  `install.download` now also covers `maven`, `ant`, `python`, `nodejs` and `curl` — each one verified
  before being added. `curl` uses curl.se's rolling `latest.cgi` link, which never changes and so cannot
  rot; the others discover the version from a listing, so nothing is pinned. This matters because
  **winget adapts very differently across environments**: a machine with no Store, one where a policy
  disables the sources, and one without administrator rights all fail the same way from the user's point
  of view — a non-zero exit code with no explanation. When a `winget` job fails and the entry has another
  route, the panel now offers **改用另一条路** and the job log says why. It is not an automatic retry:
  switching mechanism still changes the machine, so it still takes a click.
- **A download-source picker on one-click install, with a five-second auto-start.** For the entries we
  fetch ourselves (jmeter, tomcat9, tomcat11) the install button now asks *which source* first: the
  official one plus the mirrors that were verified — `Apache 官方 (dlcdn)`, `清华 TUNA`, `阿里云`. The
  first entry is the default, and if nothing is chosen within five seconds it starts on its own, as
  asked for. That is only defensible because **every source is verified before the countdown begins**:
  the host resolves and probes each one, a mirror that cannot deliver is filtered out rather than shown
  as a dead option, and with nothing verified the countdown does not run and nothing is installed.
  Entries installed through `winget` / `pip` / `npm` show no picker at all — we do not choose how those
  fetch their packages, so listing sources for them would be a false choice. All six declared sources
  resolve to the same version of the same archive (jmeter 5.6.3, tomcat9 9.0.122, tomcat11 11.0.26), so
  switching one changes only who serves it.
- **“让 DSH 帮我解决” on a job that failed or is still running.** A failure used to end inside the
  panel: the detail area showed the log and the user was left holding it. The button hands the job to
  DSH — the same hand-off the tool explanations already use — and the host composes the message from
  the job's real state rather than from a description of it: status and phase, the command or source,
  the reported error, the download URL, the transferred and expected byte counts, the exit code, the
  note, and the last 30 log lines. It goes out with the tools that can verify it (`dev_env_inventory`,
  `dev_env_job`) and asks for a fix rather than a list of possibilities, because whoever clicks it has
  a real failure in front of them. A successful job deliberately offers nothing: there is nothing to
  solve, and the button would only be noise.
- **Uninstall an installed tool from the panel.** The panel's first destructive action, so it is
  deliberately conservative. `uninstall` is computed by the host per entry and is **null** when there
  is no honest way to remove the tool — the eleven install-by-hand entries (zentao, adb, junit,
  scoop, choco…) have no install record anywhere, so they get no button rather than a button that
  cannot work. Where a route exists it comes from the declaration the catalog already carries:
  `winget uninstall --id` for the 59 entries with a winget id, `npm uninstall -g` / `pip uninstall -y`
  for the ten package entries (marked experimental, since those only work when the package really is
  a global one), and **Windows' own `UninstallString`** for registry-probed entries — our own
  `UninstallString` from the registry rather than one we invent.
- **A confirmation step, because this one really deletes.** The button is red, nothing is sent until
  the user confirms, and the confirmation names the exact command plus the risks that apply: that it
  cannot be undone, that this is a core tool which DSH or the current project may depend on, that the
  uninstaller will open its own window, or that the route only works if the tool was installed that
  way. The two buttons carry distinct labels (`确认卸载` / `不卸载`) — an earlier revision used the
  same word for both, and clicking "the confirm button" landed back on the row button that had opened
  the panel, silently closing it.
- **The result is re-checked, not assumed.** A process exiting 0 is not evidence that a tool is gone:
  an interactive uninstaller often returns immediately, and `winget uninstall` can report success for
  something winget did not install. After the job ends, the host re-runs the scanner's own probe and
  records the verdict in `job.uninstall`, which the panel shows as either "it is no longer detected"
  or "it is still detected, so the uninstall may not have completed" — and a success that the re-check
  contradicts is turned into a failure.

### Fixed

- **Two ways a version could be silently wrong.** The first: `^node-(v[\d.]+)-x64\.msi$` captured
  `v24.21.0`, and since the panel renders the captured group as the version it read `vv24.21.0`. The
  second is the one that matters — **taking the numerically newest directory is not the same as taking
  the release the entry claims.** nodejs.org's newest version is v26.11.1 (Current) while its LTS is
  v24.21.0 two majors behind, and that entry's own winget id is `OpenJS.NodeJS.LTS`, so "newest wins"
  would have installed a different release line than the one the entry promises. It now uses the
  official LTS *alias* directory. Related: 清华's `nodejs-release` mirror carries all history and no
  alias, so mirroring Node was dropped — there, "newest directory" resolves to v24.1.0, a whole release
  line behind, and a mirror that silently serves stale versions is worse than no mirror. Both failure
  modes are now covered by guards over every declared source, because both are properties of a pattern
  rather than one-off mistakes.
- **A countdown that could never reach zero.** The picker's timer was cleared and re-armed on every
  render, and the panel re-renders about once a second for its job polling and clock — so the
  one-second tick was cancelled before it could fire past the first step, and the auto-start would
  never have happened. The timer now lives in a ref and is re-armed only when the countdown itself
  changes, and an "already started" guard keeps a render from starting a second install.
- **The picker was rendered inside a tab branch.** It renders at the panel root now: switching to the
  "All" tab with the picker open left the state updating but nothing drawn, so the countdown would have
  run out invisibly and installed something the user could not see.
- **A winget that cannot run is no longer offered as a plan.** On the development machine
  `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` is a 0-byte app-execution-alias stub (the Store
  never installed DesktopAppInstaller): it runs, prints nothing, and exits `0x8A150001`. `plansFor()`
  nonetheless offered `winget install` as the preferred plan for all 59 entries that declare a winget
  id, because the only test was `process.platform === 'win32'` — so every one-click install walked into
  a dead end. The check is now a health check (winget must answer `--version` with a version), and a
  negative result is not cached, so installing winget and rescanning brings the plans back. A plan that
  cannot run is worse than no plan: it reads as a broken plugin.
- **The Tomcat winget ids named packages that do not exist.** Apache's Tomcat package is unversioned
  (`Apache.Tomcat`), so `Apache.Tomcat.11` was never installable — that was the reported failure
  (`0x8A150014`, "找不到与输入条件匹配的程序包"). It could not be verified from here (winget is broken
  and github.com is unreachable), so rather than guess a plausible-looking id, both entries declare
  **no** winget id and carry a verified download source instead; `resolveDownload` learned to pick the
  newest version *directory* (`v11.0.26/`) with the archive inside `bin/`, which is how Apache lists
  Tomcat, so no version is pinned.
- **`MsiExec.exe /I` in an `UninstallString` is rewritten to `/X`.** Microsoft's convention is `/X`
  (uninstall), but `/I` (install/repair) really does appear there — MySQL Server and SQL Server
  LocalDB on the development machine both had it. Running it as written from an uninstall button
  would repair or reinstall the product, which is far worse than failing, so the one rewrite is
  applied and reported in the job log rather than done silently. Every other command shape is passed
  through untouched: guessing at an installer's arguments is what this feature refuses to do.

## [1.1.2] - 2026-10-11

**The panel can now do the three things 1.1.1 could not: stop a stalled install, point the scanner at
a tool it cannot guess, and show a real transfer rate.** The package also moves back to the unscoped
name `dsh-dev-env` (see *Changed*).

### Added

- **A Cancel button on every running job.** The host route `POST /dsh-dev-env/api/jobs/cancel`
  existed and killed the whole process tree with `taskkill /T /F`, but nothing in the panel ever
  called it, so a slow `winget install` — JMeter's Apache mirror waiting on an unreachable host — could
  not be stopped from the UI at all. The button sits on the job's own row, locks itself and reads
  `取消中…` while the request is in flight, and the row ends as `cancelled`. The detail view then names
  the cleanup boundary the host recorded (`partial-removed` vs `external-cache-untouched`), because a
  cancelled `winget` install cannot have its cache deleted and a clean-looking "cancelled" must not
  imply a clean sweep.
- **Download a tool ourselves, with a real speed, ETA and resume.** `downloads.js` was written and
  verified but nothing imported it, so it was inert. A managed installer reports no size and no rate
  when its output is piped and offers no resume, so progress like a browser's is only possible for a
  file we fetch ourselves: the job now carries `receivedBytes`, `totalBytes`, `bytesPerSecond` and
  `etaSeconds`, and the panel shows the rate and the remaining time. Cancelling interrupts the
  transfer and deletes the `.part` file and its metadata, which is what finally gives the cancel
  route's `partial-removed` branch something to clean.
- **Download URLs are discovered, not pinned.** Apache's mirror keeps only the current release and its
  filename carries the version, so a hardcoded URL starts rotting at the next release — silently, since
  a 404 looks exactly like an unreachable network. `install.download` therefore describes *where to
  look*; `resolveDownload()` reads the listing, takes the numerically newest match (`compareVersions`,
  so 5.10 beats 5.9 where text order would pick 5.9), verifies it with the same probe a resume uses,
  and falls back to the archive only if the mirror yields nothing.
- **Point the scanner at a tool it cannot guess: extra roots, without restarting DSH.** Some tools are
  unzipped into a folder of the user's own — the registry has never heard of them and `PATH` does not
  contain them, so no fixed candidate list can find them. The escape hatch used to be the
  `DSH_DEV_ENV_ROOTS` environment variable, which needs `setx` **and a DSH restart**. The panel can now
  add a folder itself: `GET` / `POST` / `DELETE /dsh-dev-env/api/roots` remember it in the profile's
  `dsh-dev-env/roots.json` (`DSH_DEV_ENV_ROOTS_FILE` overrides the location) and merge it with the
  environment variable on the next scan. Adding or removing a root invalidates the scan cache, so the
  inventory reflects it immediately. `hint` is exposed per catalog entry — the sentence saying what a
  given tool needs to be recognised — and is `null` for `registry` / `argv` entries, where choosing a
  folder would achieve nothing.
- **“Already installed? Pick its folder” in the panel.** A missing entry that a folder could actually
  identify now offers the button next to its install action, together with what that tool needs.
  Picking one calls `uiWorkspace.pickDirectory()`, remembers the folder, and reports straight back
  whether the tool was recognised there — or what was still missing. The extra folders are listed with
  a Remove action, so a wrong pick is undoable. The button appears only for `pathList` entries (where a
  folder can help) and only when the client service is present, so there is never a control that
  cannot work.

### Changed

- **The package is `dsh-dev-env` again, not `@cszi666/dsh-dev-env`.** The unscoped name came off npm's
  unpublish cooldown, so the scope is gone: `package.json` `name`, the `cordis.patch.yml` row,
  `client.js`'s `__ModuleLoader__.load` id, and the documented install specs all move together. The
  HTTP route prefix `/dsh-dev-env/api/*` deliberately does **not** change — the panel and the tools
  hardcode it, and it never had anything to do with the package scope.
- **A finished job no longer animates as if it were still working.** The indeterminate progress bar is
  only drawn while a job is running; cancelled and failed jobs show a stopped bar instead of a sliding
  one.

### Fixed

- **Picking a tool's own folder matched nothing.** Candidates are written as
  `<root>\<tool-folder-pattern>`, so choosing `…\apache-jmeter-5.6.3` — exactly what the panel's own
  hint tells the user to do — expanded to `…\apache-jmeter-5.6.3\apache-jmeter-*`, a path that exists
  nowhere, and the pick silently did nothing. The probe now also tries the level above when the last
  path segment is the tool folder itself, so either pick works.
- **A bare drive root was stored as a root.** `normaliseDir('D:\')` stripped to `'D:'` and was written
  to the store, contradicting the comment that claimed it was rejected. It now returns `null`.
- **`roots.js` and `downloads.js` are wired up**, so the self-check's import guard demands them in
  `files[]`. That guard fired for both during this release, exactly as designed — it is the one whose
  absence shipped 1.1.0 without `describe.js`.

### Tests

- **Behavioural tests for the panel**, in `scripts/client-cancel.test.mjs`. The self-check has no
  dependencies by design — that is the one thing guarding a release — so this renders the real
  `client.js` against a minimal React/DOM shim written for it and clicks the actual buttons: the cancel
  POST, the in-flight lock, the `cancelled` row and its cleanup text, which rows offer a folder picker
  and which must not, the post-pick verdict, a cancelled pick writing nothing, the remove action, and
  that only a job we downloaded ourselves claims a rate.
- **Self-check coverage for picked folders**, against real temporary `apache-jmeter-9.9.9`-shaped
  folders: both pick levels reach the tool, a failed pick names the condition that failed, and a probe
  that reads a version out of a file genuinely needs the level above it. The last one is written
  against a local fixture probe rather than a catalog entry, so it cannot rot with the catalog.
- **The transfer maths and the cancel cleanup are covered without a network**: a chunked transfer
  through `startDownload` with a time-stamped meter, asserting the rate and ETA are the numbers the
  bytes imply, and a cancelled in-flight transfer leaving no `.part` or metadata behind. Every guard in
  this release was verified by mutating the code into failing.

## [1.1.1] - 2026-10-10

**1.1.0 could not activate on any machine that installed it from npm.** Do not use 1.1.0; upgrade
straight to 1.1.1.

### Fixed

- **`describe.js` was not in the published tarball.** `index.js` imported it, `package.json`'s
  `files[]` did not list it, so npm packed 16 files and the import failed on every install with
  `1 entry did not activate dev-env (@cszi666/dsh-dev-env): failed to import`. The working tree always
  had the file, which is why nothing local noticed. `files[]` now lists it, and the tarball grew to 17
  files.
- **A missing descriptions file can no longer disable the plugin.** `index.js` now loads it through a
  `try`/`catch` dynamic import and falls back to an empty map, so the worst case is a panel without the
  one-line descriptions instead of a plugin that will not start. A cosmetic data file should never be
  able to brick activation, whatever packaging does.
- **The self-check now looks in the direction that would have caught this.** It previously verified
  that every path in `files[]` exists — the file was simply absent from that list, so the check had
  nothing to complain about. It now walks the relative imports of every shipped module, following them
  transitively, and fails with `index.js imports describe.js, which files[] does not pack`. That
  message doubles as a regression test: removing the entry makes `npm test` fail.

### Added

- **An upgrade path, written down.** `docs/RELEASING.md` now has an *Upgrading an installed copy*
  section, because "install the new version" is not obvious when a plugin is already present and a
  failed upgrade leaves the app reporting an entry that did not activate.

## [1.1.0] - 2026-10-10

Two things a first-time user could not get from 1.0.0: whether an install was progressing, and what
any of the 82 tools actually is.

### Added

- **A description under every row, in both languages.** `describe.js` holds one beginner-facing line
  per catalog entry — what the tool is and what you would use it for — so adding a probe no longer
  means editing a growing literal in `catalog.js`. `npm test` requires every entry to have both
  languages, rejects orphan keys, and caps the length so a line cannot overflow the row.
- **A chooser behind every row's `↗` button.** The one-line description is already on screen, so the
  button now asks what to do next: **let DSH explain it**, or **open the tool's official page**. The
  DSH path posts to `/dsh-dev-env/api/explain`, which puts a question into the most recently active
  session through `sessionController.prompt` and leaves the answer in the conversation, where the
  agent can also say what the tool's state is on this machine. Encyclopaedia links are gone: Baidu
  Baike has no entry for a good part of a developer toolchain, and landing a beginner on an empty
  entry page is worse than not linking at all.
- **Per-job Delete, a Clear-finished button, and a Details view.** A failed install used to sit in the
  list with its whole log inline. The row is now a one-line summary; `Details` expands the download
  and install progress, the current activity line, the exit code and the last 200 log lines, and
  `Delete` removes a finished job so the list stops growing without bound.
- **Live install progress.** Every job now carries a phase (`download` / `verify` / `install` /
  `done`), the last output line as an activity string, a byte figure when the installer prints one,
  and a percentage when one can be parsed.
- **A progress bar per job**, determinate when a percentage is known and indeterminate otherwise —
  the panel does not invent a number it does not have.
- **A ticking elapsed time**, and the row of the entry being installed shows its phase inline with
  its buttons disabled for the whole job, not just for the click.

### Fixed

- **Seven download pages that could not be reached.** Every `install.page` was checked with a real
  HTTP request. Four pointed at GitHub release pages (`neovim`, `ninja`, `allure`, `redis`), which are
  unreachable from a mainland network without an accelerator, and two at `developer.android.com`,
  which is blocked there too. They now point at the vendor's own site (`neovim.io`,
  `ninja-build.org`, `allurereport.org`, `redis.io`) and at Google's China mirror
  (`developer.android.google.cn`), all verified reachable. `notepad++` moved to its SourceForge page:
  `notepad-plus-plus.org` never answered within any sane timeout.
- **Install output was being concatenated into one unreadable line.** Installers draw a progress bar
  by rewriting the same line with a bare carriage return. The log split on newlines only, so every
  redraw was glued into one very long line and the progress it carried was lost — which is why the
  panel appeared to show no progress at all. Output is now split on `\r` as well, ANSI control
  sequences are stripped, and consecutive progress lines overwrite each other instead of piling up.
- **The job list is now polled once a second while a job runs** (every two seconds when idle, four
  after a failed poll) instead of a flat two seconds, so the bar advances visibly.

## [1.0.0] - 2026-10-10

The first public release. The entries under *Fixed* were defects found and corrected while building
it, and are recorded because they describe behaviour a user would otherwise hit.

### Added

- Sidebar panel in the DSH Web UI: a `sidebar.panellist` entry with id `dev-env` backed by the
  matching `main` key. It groups the catalog into five categories, shows the detected version and the
  path each entry was found at, highlights gaps, and gives every gap three actions — one-click
  install, open the official download page, copy the command.
- Live install-job list under the panel: status, exit code, error and the tail of each process's
  output, polled every 2 seconds. A job that finishes triggers an automatic rescan.
- Chinese/English switch in the panel header, defaulting to Chinese and remembered per browser. The
  button names the language it would switch to, in that language. Panel chrome, the five category
  names and any entry whose name is not Latin (`nameEn` in the catalog, enforced by `npm test`) follow
  it; the switch is independent of the DSH locale because both dictionaries ship with the plugin.
- Three agent tools: `dev_env_inventory` (60-second cache, `refresh` to bypass, `only` / `category` /
  `verbose` filters), `dev_env_install` (`mode`: `auto`, `winget`, `npm`, `pip`, `page`, or `command`
  for a dry-run preview), and `dev_env_job`.
- Host HTTP API for the panel, sharing the same functions as the tools: `GET
  /dsh-dev-env/api/inventory` (`?refresh=1`), `GET /dsh-dev-env/api/jobs`, `POST
  /dsh-dev-env/api/install` (`{ id, mode }`), `POST /dsh-dev-env/api/open` (`{ url }`).
- `catalog.js`: 82 entries across five categories, 11 of them marked `essential` and counted
  separately in the gap summary. Each entry declares a probe and at least one install strategy; the
  self-check enforces both.
- Content-validated `pathList` matching, so tools that live in a folder of their own are still found
  and lookalikes are not. `requires` demands extra files inside a match (`JDK 8` requires
  `bin\javac.exe`, which excludes a JRE whose `release` file also says `1.8`), and a `pattern` can pin
  a major version. `JDK 8` is found through `%JAVA_HOME%`, the usual installer folders, IntelliJ's
  `~/.jdks`, and hand-unzipped collections on any drive — a JDK copied into place is registered
  nowhere, so the version has to come from its own `release` file.
- Install plans translated from an entry's `install` declaration in priority order — `winget`, then
  `npm`, then `pip` — with opening the official download page as the always-available fallback. An
  optional `note` is shown under the row in the panel.
- `paths.js`: portable path resolution. `%ANY_ENV_VAR%` (case-insensitive, and a candidate whose
  variable is unset is dropped rather than guessed), the `%DRIVES%` pseudo-variable (the system drive
  plus any existing `D:`–`H:`), `~` for the user home, and non-recursive single-segment `*` / `?`
  globbing.
- A `debug` object on every missing entry: the probe used, the command actually executed, the exit
  code and an output snippet, so a false negative can be explained instead of guessed at.
- `scripts/check.mjs` (`npm test`): validates the catalog shape, that every regex compiles, that no
  path hardcodes a drive letter or a user profile, unit-tests the path resolver, and cross-checks
  `package.json` against the bundle patch, the client entry and `files[]`. No dependencies, spawns
  nothing.
- CI workflow on `windows-latest` across Node 18, 20 and 22: `node --check` on each JavaScript file,
  `npm test`, and a dependency-free parse of `cordis.patch.yml`.
- Documentation: this changelog, `README.md` with a `README.zh-CN.md` translation, `CONTRIBUTING.md`
  and `SECURITY.md`.

### Fixed

- Windows `.cmd` / `.bat` shims — `npm`, `pnpm`, `gradle`, `tsc` and friends — were reported as
  missing, because Node 18.20+ refuses to execute them through `execFile`. They are now resolved to
  their real path and run through `cmd.exe`, with the command line passed verbatim so the inner
  quotes survive.
- WSL was reported as installed on machines with no distribution: the probe matched a digit in the
  status text and produced the bogus version `0`. It now runs `wsl -l -v` and judges by exit status.
- A tool installed through the panel was invisible until DSH restarted, because a process's `PATH` is
  a startup snapshot. After a successful install the plugin now re-reads the Machine and User `Path`
  from the registry (and refreshes it at most every 20 seconds during scans).
- On a cold start the panel rendered while every `/dsh-dev-env/api/*` request answered `404`:
  `webServer` was read once with `ctx.get('webServer')` at apply time, before the service existed, and
  the lookup never retried. Route registration now waits with `ctx.inject(['webServer'], ...)`.
- Git's version was truncated to `2.55.0.` by a `[\d.]+` pattern that stopped at the `.windows.5`
  suffix. The probe now captures the whole token.

### Security

- The install executor builds command lines only from the catalog's own `install` declarations. No
  string supplied by a caller reaches a command line: a request carries an entry `id` that must match
  the catalog and a `mode` that must match an existing plan. `POST /dsh-dev-env/api/open` is the only
  endpoint that accepts caller text, it is validated as an `http(s)` URL, and it can only open a
  browser. See [SECURITY.md](SECURITY.md).

### Notes

- Windows only. The plugin reads the Windows uninstall registry and drives `winget`.
- No runtime dependencies, and no `peerDependencies` on purpose, so DSH's pre-install
  version-compatibility gate cannot block the plugin.

[1.1.2]: https://github.com/cszi666/dsh-dev-env/releases/tag/v1.1.2
[1.1.1]: https://github.com/cszi666/dsh-dev-env/releases/tag/v1.1.1
[1.1.0]: https://github.com/cszi666/dsh-dev-env/releases/tag/v1.1.0
[1.0.0]: https://github.com/cszi666/dsh-dev-env/releases/tag/v1.0.0
