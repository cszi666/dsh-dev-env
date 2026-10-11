# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Download a tool ourselves, with a real speed, ETA and resume.** `downloads.js` was written and
  verified but nothing imported it, so it was inert. It is now wired for `jmeter`, the entry whose
  install stalled in the first place. A managed installer (`winget` / `pip` / `npm`) reports no size
  and no rate when its output is piped and offers no resume, so "progress like a browser" is only
  possible for a file we fetch ourselves: the job now carries `receivedBytes`, `totalBytes`,
  `bytesPerSecond` and `etaSeconds`, and the panel shows the rate and the remaining time. Cancelling
  interrupts the transfer and deletes the `.part` file and its metadata, so the cancel route's
  `partial-removed` branch finally has something to clean.
- **Download URLs are discovered, not pinned.** Apache's mirror keeps only the current release and its
  filename carries the version, so a hardcoded URL starts rotting at the next release — silently, since
  a 404 looks exactly like an unreachable network. `install.download` therefore describes *where to
  look*; `resolveDownload()` reads the listing, takes the numerically newest match (`compareVersions`,
  so 5.10 beats 5.9), verifies it with the same probe a resume uses, and falls back to the archive only
  if the mirror yields nothing.
- **Point the scanner at a tool it cannot guess: extra roots, without restarting DSH.** Some tools
  are unzipped into a folder of the user's own — the registry has never heard of them and `PATH` does
  not contain them, so no fixed candidate list can find them. The escape hatch used to be the
  `DSH_DEV_ENV_ROOTS` environment variable, which needs `setx` **and a DSH restart**. The panel can
  now add a folder itself: `GET` / `POST` / `DELETE /dsh-dev-env/api/roots` remember it in the
  profile's `dsh-dev-env/roots.json` (`DSH_DEV_ENV_ROOTS_FILE` overrides the location) and merge it
  with the environment variable on the next scan. Adding or removing a root invalidates the scan
  cache, so the inventory reflects it immediately. `hint` is exposed per catalog entry — the sentence
  that says what a given tool needs to be recognised — and is `null` for `registry` / `argv` entries,
  where choosing a folder would achieve nothing.
- **A folder pick for a tool works whether the user picks the tool's own directory or its parent.**
  The catalog writes candidates as `<root>\<tool-folder-pattern>`, so picking the tool folder
  appended the pattern to an already-complete path (`…\apache-jmeter-5.6.3\apache-jmeter-*`, which
  exists nowhere) and the pick silently looked broken. The probe now also tries the directory above
  when the last path segment is the tool folder itself. Verified against a real JMeter install:
  after `POST /api/roots` the very next scan reports `installed: true, version: 5.6.3`.
- **“Already installed? Pick its folder” in the panel.** A missing entry that a folder could actually
  identify now offers the button next to its install action, together with the sentence saying what
  that tool needs. Picking one calls `uiWorkspace.pickDirectory()`, remembers the folder, and reports
  straight back whether the tool was recognised there — or what was still missing. The extra folders
  are listed with a Remove action, so a wrong pick is undoable. The button appears only for
  `pathList` entries (where a folder can help) and only when the client service is present, so there
  is never a control that cannot work.
- **A Cancel button on every running job.** The host route `POST /dsh-dev-env/api/jobs/cancel`
  existed and killed the whole process tree, but nothing in the panel ever called it, so a slow
  `winget install` — JMeter's Apache mirror, for instance — could not be stopped from the UI at all.
  The button now sits on the job's own row, disables itself and reads `取消中…` while the request is
  in flight, and the row ends as `cancelled`.
- **The cleanup boundary is shown, not implied.** On cancel the host records whether it removed its
  own partial files or left an external installer's cache alone; the job detail now says which one
  applied. A cancelled `winget` install reports that its downloaded cache is not ours to delete
  rather than letting a clean-looking "cancelled" imply a clean sweep.
- **Behavioural tests for the panel**, in `scripts/client-cancel.test.mjs`. The self-check has no
  dependencies by design, so this renders the real `client.js` against a minimal React/DOM shim
  written for it and clicks the actual buttons: the cancel POST, the in-flight lock, the `cancelled`
  row and its cleanup text, which rows offer a folder picker and which must not, the post-pick
  verdict, a cancelled pick writing nothing, and the remove action. A companion shape check fails if
  either half of the cancel wiring is removed.
- **Self-check coverage for picked folders**, against real temporary `apache-jmeter-9.9.9`-shaped
  folders: both pick levels reach the tool, a failed pick names the condition that failed, and a
  probe that reads a version out of a file genuinely needs the level above it. That last guard is
  written against a local fixture probe rather than a catalog entry, so it cannot rot with the
  catalog, and each was verified by mutating the code into failing.

### Changed

- **A finished job no longer animates as if it were still working.** The indeterminate progress bar
  is only drawn while a job is running; cancelled and failed jobs show a stopped bar instead of a
  sliding one.
- **`roots.js` is now wired up**, so the self-check's import guard demands it in `files[]`. That
  guard is the one whose absence shipped 1.1.0 without `describe.js`.

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

[1.1.1]: https://github.com/cszi666/dsh-dev-env/releases/tag/v1.1.1
[1.1.0]: https://github.com/cszi666/dsh-dev-env/releases/tag/v1.1.0
[1.0.0]: https://github.com/cszi666/dsh-dev-env/releases/tag/v1.0.0
