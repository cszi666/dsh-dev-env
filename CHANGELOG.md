# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/cszi666/dsh-dev-env/releases/tag/v1.0.0
