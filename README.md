# dsh-dev-env

[English](README.md) | [简体中文](README.zh-CN.md)

A DSH plugin that inventories the development and testing toolchain installed on this machine, shows
it inside the DSH Web UI, highlights the gaps, and fills them with one click.

**Windows only.** The plugin reads the Windows uninstall registry and drives `winget`. It does not
run on macOS or Linux.

A screenshot belongs at `docs/screenshot.png`; the maintainer should add it.

## What you get

### Sidebar panel

A global panel in the DSH Web UI: a `sidebar.panellist` entry with id `dev-env`, backed by the
matching `main` key. It groups the catalog into five categories and shows, per entry, the detected
version and the path it was found at — or the reason it was not found. Gaps are highlighted, and each
gap carries:

- **one-click install** — runs the selected install plan and streams the result into a job list;
- **download page** — opens the vendor's official page in the default browser;
- **copy command** — copies the exact command line to the clipboard.

Under every row sits a one-line description of what that tool actually is, written for someone who has
never heard of it, and a `↗` button that asks what to do next: **let DSH explain it**, or **open the
tool's official page**. The DSH path posts the question to `/dsh-dev-env/api/explain`, which puts it
into your most recently active session, so the answer lands in the conversation — where the agent can
also say what that tool's state is on this machine. The descriptions live in `describe.js`, keyed by
entry id; `npm test` requires every catalog entry to have one in both languages.

Chips at the top summarise installed / missing / essential-missing / total plus the scan time, and the
job list below shows live status with the tail of each install's output. Styling uses theme tokens
(`--dsw-alias-*`) only, so light and dark themes both work.

**Installs report progress.** Each job carries a phase (`Downloading` / `Verifying` / `Installing` /
`Done`), the last line the installer printed, and a byte figure when it prints one; the row draws a
progress bar that is determinate when a percentage can be parsed out of the output and indeterminate
otherwise — the panel does not invent a number it does not have. Elapsed time ticks once a second, and
the entry being installed shows its phase inline with its buttons disabled for the whole job rather
than just for the click. While a job runs the job list is polled once a second instead of every two.
A job row stays one line: **Details** expands the download and install progress, the current activity
line, the exit code and the log tail, and **Delete** — or **Clear finished** — takes jobs out of the
list so a failed install cannot occupy the panel forever.

The panel header carries a language toggle and **starts in Chinese**. The button always names the
language it would switch to, written in that language (`English` while in Chinese, `中文` while in
English), and the choice is remembered per browser. Panel chrome, category names and entry names all
follow it. It is deliberately independent of the DSH locale: the plugin ships both dictionaries.

### Agent tools

| Tool | Purpose | Arguments |
| --- | --- | --- |
| `dev_env_inventory` | The full inventory plus the gap list and the command that would fill each gap. | `refresh` (boolean, bypass the 60s cache), `only` (`all` \| `missing` \| `installed`), `category` (`language` \| `ide` \| `test` \| `data` \| `tool`), `verbose` (boolean, list every entry in the text result) |
| `dev_env_install` | Fill one gap. It changes the machine, so call it only on an explicit request. | `id` (required), `mode` (`auto` \| `winget` \| `npm` \| `pip` \| `page` \| `command`) |
| `dev_env_job` | Status, exit code and recent log lines of an install job. | `jobId` (omit to list recent jobs), `tailLines` (default 30) |

`mode: "command"` on `dev_env_install` is a dry run: it returns the candidate commands and executes
nothing.

### HTTP API

The panel is a consumer of the host half, exactly like the tools are:

| Method | Path | Input | Result |
| --- | --- | --- | --- |
| `GET` | `/dsh-dev-env/api/inventory` | `?refresh=1` to bypass the cache | the full inventory: `items`, `categories`, `summary` |
| `GET` | `/dsh-dev-env/api/jobs` | – | install jobs, newest first |
| `POST` | `/dsh-dev-env/api/install` | `{ "id": "gcc", "mode": "auto" }` | the started job and the entry's available plans |
| `POST` | `/dsh-dev-env/api/open` | `{ "url": "https://example.com" }` | opens the URL in the default browser |
| `POST` | `/dsh-dev-env/api/jobs/delete` | `{ "id": "44ee61f9" }` or `{ "scope": "finished" }` | the remaining jobs; `400` if that job is still running |
| `POST` | `/dsh-dev-env/api/explain` | `{ "id": "gcc", "lang": "zh" }` | puts a question about that tool into the most recently active session, via `sessionController.prompt` |

The endpoint answers `404` for an unknown entry id, `400` when no plan matches the requested `mode`
(or the URL is not `http(s)`), and `405` for the wrong method. `mode: "command"` is tool-only; the
HTTP endpoint accepts `auto` or one of the plan modes. `explain` answers `503` when the running DSH has
no `sessionController` and `409` when no session can take a prompt, so a caller can tell "this build
cannot do it" apart from "it can, but there is nowhere to put the answer".

## Requirements

- Windows 10 or 11. Verified on Windows 11 with DSH 0.2.0-rc.2.
- Node.js 18 or newer (see `engines` in `package.json`).
- No runtime dependencies. The plugin declares no peer dependencies on purpose, so DSH's pre-install
  version-compatibility gate never blocks it.
- `winget` for winget-based installs — the panel lists `winget` itself as a catalog entry, and the
  download-page fallback works without it.
- Python and/or Node.js only if you want the `pip` / `npmGlobal` probes or the `pip` / `npm` install
  strategies for individual entries.

## Install

Both channels are live. Pick either spec.

**npm — no prerequisites at all.** No `git`, no Node, nothing to install first:

```
dsh-dev-env
```

**GitHub — tracks the default branch**, but needs `git` on the machine: DSH verifies the repository
with `git ls-remote` before installing, and pnpm fetches it over git.

```
github:cszi666/dsh-dev-env
```

> Until 1.1.2 the npm package was scoped as `@cszi666/dsh-dev-env`. That name still resolves for the
> older versions, but new installs should use the unscoped one.

### In the DSH desktop app (no CLI needed)

The desktop build bundles its CLI inside `app.asar` and does not put `dsh` on `PATH` — and the
`desktop` profile is Electron-owned, so an npm-installed `dsh` CLI refuses to manage it. Install it
from inside DSH instead:

- **Ask the agent.** Paste this into any session:

  ```
  Install the DSH plugin dsh-dev-env
  ```

  The agent calls `plugin_manager` with `action: install_bundle` and that spec, and the install is
  applied to your live profile. Approve the request when it is asked for — `plugin_manager` needs
  `danger-full-access` or a per-call approval. If your agent preset does not expose that tool, use the
  panel below.
- **Or use the panel.** **Settings → Plugins**, and paste the same spec.

If the sidebar entry does not show up afterwards, refresh the page; if the panel appears but its API
answers `404`, restart DSH once (see [Pitfalls](#pitfalls)).

### Upgrading an installed copy

**Installing over an existing copy is not an upgrade.** DSH keeps the old bundle row, and if the new
generation fails to load you get

```
dsh: warning: 1 entry did not activate dev-env (@cszi666/dsh-dev-env): failed to import
```

which reads as a broken application rather than a broken plugin. `1.1.0` shipped exactly that way, so
the order below matters. Paste this into a session:

```
I have an older @cszi666/dsh-dev-env installed and I want dsh-dev-env@1.2.0.

Do this in order, without skipping steps:
1. Use plugin_manager list_bundles to tell me which name and version is installed right now.
2. remove_bundle it first. Do not install over it: DSH keeps the old bundle row, and if the new one
   fails to load it reports "1 entry did not activate dev-env: failed to import", which looks like
   the whole application is broken.
3. install_bundle dsh-dev-env@1.2.0 — pinned, so the result can be checked.
4. list_bundles again and confirm it shows dsh-dev-env at 1.2.0, then report the application status.
5. If it is restart-required, tell me; do not restart the client yourself.
```

**1.1.2 renamed the package**, so this is a change of name and not only of version: the npm package
used to be `@cszi666/dsh-dev-env` and is now the unscoped `dsh-dev-env`. The old name still resolves
for the versions published under it (up to 1.1.1), which is why step 1 asks for the name as well as
the version, and why step 4 checks both. If you installed the old name as a local `link:`, do not use
step 2 — see [Package name](docs/RELEASING.md#package-name) for the link case.

Step 4 is not ceremony: a bundle row existing is not the same as a plugin having activated. The same
sequence works by hand — uninstall in **Settings → Plugins**, then add the pinned spec.

### With the `dsh` CLI (npm-managed profiles)

```powershell
npm install -g @deepseek-ai/dsh        # only if you do not have it yet
dsh plugin --profile <profile> add dsh-dev-env
```

`dsh plugin` forwards its arguments to pnpm inside the profile directory, so every pnpm spec works:
`@scope/name`, `github:owner/repo`, `https://github.com/owner/repo`, a `.tgz` URL, or a version range.
`<profile>` is whichever profile you run — it **cannot be `desktop`**, which belongs to the Electron
app.

The npm package is the unscoped **`dsh-dev-env`**. It was scoped as `@cszi666/dsh-dev-env` from 1.0.0
to 1.1.1 because the unscoped name was inside npm's post-unpublish cooldown; 1.1.2 moved back. The old
name still resolves for the versions published under it, so an existing install keeps working, but new
installs should use the unscoped spec above. Only the npm spec was affected — the GitHub spec and the
repository name never changed.

For a GitHub repo DSH checks reachability with `git ls-remote` before installing, so a typo in the
account or repository name fails immediately instead of half-way through.

## How it works

### The catalog

`catalog.js` is the single source of truth: 82 entries across five categories, each declaring how to
detect a tool and how to install it.

| Category id | Entries | What it covers |
| --- | --- | --- |
| `language` | 23 | Languages and runtimes: JDK, Python, Node.js, .NET, Go, Rust, GCC/Clang, … |
| `ide` | 20 | IDEs and editors: the JetBrains family, VS Code, Visual Studio, Eclipse, DevEco Studio, … |
| `test` | 16 | Testing tools: JMeter, ZenTao, Postman, pytest, Selenium, Playwright, Appium, … |
| `data` | 10 | Databases, middleware and CI: MySQL, PostgreSQL, MongoDB, Tomcat, Jenkins, Docker, … |
| `tool` | 13 | Build and CLI tools: Git, CMake, Ninja, Maven, Gradle, winget, Scoop, … |

Entries marked `essential: true` (11 of them) are counted separately in the "essential gaps" summary,
so a missing compiler does not get lost among missing optional extras.

### Probe kinds

| `probe.kind` | What it does | Fields |
| --- | --- | --- |
| `argv` | Runs a command and extracts the version from `stdout` + `stderr` with `pattern`. | `argv`, optional `pattern` |
| `versionFile` | Reads one exact file and extracts the version with `pattern`. | `path`, optional `pattern`, `prefix`, `suffix` |
| `pathList` | Takes the first existing candidate from an ordered, env-expanded, glob-aware list. | `paths`; optional `file`, `pattern`, `requires`, `prefix`, `suffix`, `version` |
| `dir` | A file or directory exists at the env-expanded path. | `path` |
| `pip` | Runs `python -m pip show <module>` and reads `Version:`. | `module` |
| `npmGlobal` | A package directory under the global npm root (`npm root -g`). | `name` |
| `registry` | A Windows uninstall-registry entry, matched case-insensitively against `DisplayName`; the version is `DisplayVersion`. | `match` |

`npm test` enforces exactly this set. The current catalog uses `argv`, `pathList`, `registry`, `pip`
and `npmGlobal`; `versionFile` and `dir` are supported but unused.

For `pathList`, `pattern` is applied to the file content when `file` is set, and to the matched
path's basename otherwise. The first capture group becomes the version. Two options make a match
*content-validated* rather than name-matched, which is what keeps a shared folder full of different
JDKs honest:

```js
// JDK 8 that someone unzipped into a folder of their own — registered nowhere, so only its
// own `release` file can identify it. `pattern` pins the major version, `requires` proves it
// is a JDK and not a JRE (a JRE's release file also says 1.8, but it has no bin\javac.exe).
probe: { kind: 'pathList', file: 'release', pattern: 'JAVA_VERSION="(1\\.8[^"]*)"',
  requires: ['bin\\javac.exe'], paths: ['%JAVA_HOME%', '%DRIVES%\\Java\\*', ...] }
```

Pick the narrowest kind that answers the question: `argv` when the tool has a working version
command, `registry` for GUI installers that register themselves, `pathList` for archives and
extracted SDKs, `pip` / `npmGlobal` for package-managed tools.

### Portable paths

No catalog entry hardcodes a drive letter or a user path — `npm test` fails if one does. A path goes
through one of:

- `%ANY_ENV_VAR%`, case-insensitive, including `%ProgramFiles(x86)%` and friends. A candidate whose
  variable is unset is **dropped**, not guessed, so an unset `%CATALINA_HOME%` reports "not installed"
  instead of looking in a nonsense directory.
- `%DRIVES%` — a pseudo-variable that expands to the system drive plus any existing `D:`–`H:` drive.
  The upper bound is deliberate: probing every letter can block for seconds on a disconnected network
  mapping.
- `%DSH_DEV_ENV_ROOTS%` — the user-configured escape hatch, for a tool unzipped into a folder of its
  own. It expands to the roots listed in the `DSH_DEV_ENV_ROOTS` environment variable (semicolon
  separated, trailing separators trimmed, empty entries dropped); an unset variable contributes zero
  candidates, so nothing is guessed. This is the documented fix for a false negative without editing
  code:

  ```powershell
  # make a JDK/IDE/tool archive you unzipped somewhere discoverable
  setx DSH_DEV_ENV_ROOTS "D:\Java\tools;E:\sdk"
  ```

  The value is read at scan time, so there is nothing to rebuild — but it has to be in the DSH host
  process's environment, and `setx` only reaches processes started afterwards, so restart DSH once.
- `~` for the user home directory.
- Single-segment `*` and `?` wildcards, expanded one directory at a time. Expansion is non-recursive
  by design, so a catalog entry can never turn a scan into a disk crawl.

### Install plans

An entry's `install` declaration is translated into executable plans in this priority order:

```js
install: {
  winget: 'Git.Git',                          // winget install --id Git.Git -e --accept-* --disable-interactivity
  npm: 'pnpm',                                // npm install -g pnpm
  pip: 'pytest',                              // python -m pip install pytest
  page: 'https://git-scm.com/download/win',   // open the official download page
  note: 'Shown under the row in the panel.',
}
```

`winget` comes first, then `npm`, then `pip`; opening the official download page is the
always-available fallback. `mode: "auto"` picks the first non-`page` plan. Every catalog entry must
declare at least one strategy, and `npm test` enforces that too.

### Scanning behaviour

- Probes run 8 at a time; every command has a 12-second timeout; the whole inventory is cached for 60
  seconds. `refresh: true` (tool) or `?refresh=1` (HTTP) forces a rescan.
- The uninstall registry is read once per scan (all three hives) and reused for every `registry`
  entry.
- The global npm root is asked for once per scan, and falls back to the usual `%APPDATA%` /
  `%ProgramFiles%` locations when `npm root -g` cannot answer.
- Windows `.cmd` / `.bat` shims (`npm`, `pnpm`, `gradle`, `tsc`, …) are resolved to their real path
  and run through `cmd.exe`, because Node 18.20+ no longer executes them directly. The generated
  command line is passed verbatim to `cmd`, so the inner quotes survive.
- The `PATH` a process starts with is frozen. After a successful install the plugin re-reads the
  Machine and User `Path` from the registry (and refreshes it at most every 20 seconds during scans),
  so a freshly installed tool is detected without restarting DSH.
- A missing entry carries a `debug` object — the probe used, the command actually executed, the exit
  code and an output snippet — so a false negative can be explained instead of guessed at.

## Measured behaviour

On the reference machine (Windows 11, DSH 0.2.0-rc.2), with the 68-entry catalog that shipped at the
time:

- 41 entries detected as installed, all with exact versions.
- 27 entries detected as missing, 2 of them essential.
- `winget install --id Git.Git`, started from the panel, ran to completion with exit code 0 and
  streamed its log into the job list.

The catalog has since grown to 82 entries, so a scan on a new machine reports a larger total. The
exact numbers depend on what is installed.

## Pitfalls

These are DSH behaviours this plugin ran into. Contributors will hit them too.

**Host-side code is imported once and cached.** `index.js`, `catalog.js` and `paths.js` are imported
when DSH starts. Editing them requires a **full DSH restart** to take effect — disabling and
re-enabling the plugin re-runs `apply()` but does not re-import the module, and neither does renaming
the file or removing and reinstalling the bundle. The browser half (`client.js`) is different: its
bundle is revisioned by file mtime and size, so a page refresh is enough.

**Never read `webServer` with a one-shot `ctx.get('webServer')` at apply time.** The plugin can
activate before that service exists, so the call returns `undefined` and never retries: the panel
renders, but every `/dsh-dev-env/api/*` request answers `404`. It works when the plugin is installed
into a running DSH and breaks on the next cold start, which makes it painful to diagnose. Wait for
the service instead:

```js
ctx.inject(['webServer'], (scope) => {
  const dispose = scope.webServer.register({ kind: 'exact', path: '/x', handler })
  return () => dispose()
})
```

**`winget` behaves differently under a restricted shell.** In DSH's own host process it works — the
reference run installed Git through it. Under a sandboxed or non-interactive shell the MSIX alias can
fail immediately with an internal error code. The panel always shows the exit code and the log, and
the download-page fallback is unaffected.

**Installer output is not line-based, and assuming it is destroys the progress.** Progress bars are
drawn by rewriting the same line with a bare carriage return. Splitting installer output on `\n` only —
which is the obvious thing to do — glues every redraw into one very long line, so the percentage the
installer was reporting is captured but unreadable. Split on `\r` as well, strip ANSI control
sequences, and let consecutive progress lines overwrite each other instead of accumulating. A child
process whose `stdio` is a pipe is also *not* a terminal, so most installers hide their animated bar
entirely and print only phase lines: that is why the panel shows an indeterminate bar unless a
percentage can actually be parsed, and why the phase and the elapsed time carry the "is it still
working" signal.

## Limitations

- **Windows only.** There is no macOS or Linux probe.
- **One-click installs change the machine** and may raise a UAC prompt. The plugin asks through the
  UI; an agent should only call `dev_env_install` on an explicit request from the user.
- A GitHub install spec is checked with `git ls-remote` for reachability, but the bundle contents are
  validated after they are fetched, not before.
- The catalog covers the common toolchain (82 entries). A tool installed somewhere unusual may need an
  extra candidate path in `catalog.js`, or a new entry. Try the no-code option first: list the folder
  in `DSH_DEV_ENV_ROOTS` and it becomes a candidate for the entries that use `%DSH_DEV_ENV_ROOTS%`
  (JMeter, Tomcat 9 and 11, ZenTao, Jenkins).
- Versions come from whatever the tool prints. When a program only registers a build number in the
  uninstall registry (JetBrains IDEs, for example), that build number is what the panel shows.

## Development

```powershell
npm test        # node scripts/check.mjs — catalog, path resolver and packaging
npm run check   # the same thing
```

`npm test` needs no dependencies and spawns nothing. It validates the catalog shape, that every regex
compiles, that no path hardcodes a drive letter or a user profile, unit-tests the path resolver,
cross-checks `package.json` against the bundle patch, the client entry and `files[]`, and refuses to
pass while `package.json` still carries the `cszi666` publish placeholder. It prints
`all checks passed (82 catalog entries)` when everything is green.

CI runs `node --check` on each JavaScript file and then `npm test`, on `windows-latest` across Node 18,
20 and 22.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a catalog entry.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
