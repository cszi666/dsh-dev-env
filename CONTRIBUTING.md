# Contributing to dsh-dev-env

Thanks for helping. This document covers the parts of the codebase that are easy to get wrong: adding
a catalog entry, the portability rule, which probe kind to pick, and how to test your change.

Repository: <https://github.com/cszi666/dsh-dev-env>

## Layout

| Path | Role |
| --- | --- |
| `catalog.js` | The data: 82 entries across 5 categories, each with a `probe` and an `install` declaration. This is where almost every contribution goes. |
| `paths.js` | Portable path resolution: `%ENV_VAR%` expansion, the `%DRIVES%` and `%DSH_DEV_ENV_ROOTS%` pseudo-variables, `~`, and non-recursive single-segment globbing. |
| `index.js` | The host half: probes, the inventory cache, install plans and jobs, the `/dsh-dev-env/api/*` routes, and the three agent tools. |
| `client.js` | The browser half: the sidebar icon and the panel. It only consumes the HTTP API. |
| `scripts/check.mjs` | `npm test`. No dependencies, spawns nothing. |
| `cordis.patch.yml` | The bundle patch that mounts the plugin into a DSH profile. |
| `locale/*.json` | Display metadata for the Plugin Manager card. |

## Run the tests

```powershell
npm test        # node scripts/check.mjs
npm run check   # the same thing
```

The self-check validates the catalog shape, that every regex compiles, that no path hardcodes a drive
letter or a user profile, unit-tests the path resolver, and cross-checks `package.json` against the
bundle patch, the client entry and `files[]`. It needs no dependencies and spawns nothing, so it runs
anywhere plain Node runs.

It also fails while `package.json` still carries the `cszi666` publish placeholder, and warns for
each Markdown file that contains it.

CI additionally runs `node --check` on `index.js`, `client.js`, `catalog.js`, `paths.js` and
`scripts/check.mjs` before `npm test`, on `windows-latest` across Node 18, 20 and 22.

## Add a catalog entry

Append an object to `CATALOG` in `catalog.js`, in the section for its category. The smallest useful
entry has an id, a name, a category, a probe and at least one install strategy:

```js
{ id: 'ripgrep', name: 'ripgrep (rg)', category: 'tool',
  probe: { kind: 'argv', argv: ['rg', '--version'], pattern: 'ripgrep ([\\d.]+)' },
  install: { winget: 'BurntSushi.ripgrep.MSVC', page: 'https://github.com/BurntSushi/ripgrep/releases' } },
```

An archive or SDK that has no version command uses a candidate list instead. `%DRIVES%` covers the
common "installed on whatever drive the user had room on" case, and `%DSH_DEV_ENV_ROOTS%` covers "the
user unzipped it into a folder of their own":

```js
{ id: 'example-sdk', name: 'Example SDK', category: 'tool',
  probe: { kind: 'pathList', file: 'version.txt', pattern: 'v?([\\d.]+)',
    paths: ['%ProgramFiles%\\Example\\sdk-*', '%USERPROFILE%\\sdk\\example-*', '%DRIVES%\\Example'] },
  install: { page: 'https://example.com/download' } },
```

Rules the self-check enforces, so you find out before CI does:

- `id` is unique and matches `^[a-z][a-z0-9-]*$`.
- `category` is one of the ids in `CATEGORIES`.
- Every `pattern` and `registry.match` compiles.
- Every probe carries the fields its kind requires.
- At least one of `install.winget` / `install.npm` / `install.pip` / `install.page` is present.
- **No path hardcodes a drive letter or a user profile.** See below.

Add `essential: true` only for tools that most development machines need — it feeds the "essential
gaps" counter, and marking too much makes the counter useless.

## Portability rule

**No catalog entry may hardcode a drive letter or a user path.** `npm test` walks every probe and
fails on anything matching `^[A-Za-z]:[\\/]` without a `%`, or containing `\Users\<name>`.

Use one of:

- `%ANY_ENV_VAR%` — case-insensitive. A candidate whose variable is unset is dropped rather than
  guessed, so `%CATALINA_HOME%` reports "not installed" instead of probing a nonsense directory.
- `%DRIVES%` — expands to the system drive plus any existing `D:`–`H:` drive. The upper bound is
  deliberate; probing every letter can block for seconds on a disconnected network mapping.
- `%DSH_DEV_ENV_ROOTS%` — expands to the roots the user listed in the `DSH_DEV_ENV_ROOTS` environment
  variable (semicolon separated, trailing separators trimmed, empty entries dropped); an unset
  variable contributes zero candidates, so nothing is guessed. It is the escape hatch for a tool the
  user unzipped into a folder of their own, and the reason a false negative usually does not need a
  code change at all. It is currently a candidate for JMeter, Tomcat 9 and 11, ZenTao and Jenkins —
  add it to a new archive-style entry the same way.
- `~` — the user home directory.
- Single-segment `*` and `?` wildcards. Expansion is one directory at a time and deliberately
  non-recursive, so an entry can never turn a scan into a disk crawl.

If a tool genuinely lives in a fixed system location, prefer the uninstall registry (`registry`
probe) or an environment variable the installer sets.

## Choosing a probe kind

Pick the narrowest kind that answers the question.

| Kind | Use it when |
| --- | --- |
| `argv` | The tool has a version command whose output contains the version. Cheapest and most precise. |
| `registry` | A GUI installer registers itself in the Windows uninstall registry. Best for IDEs and desktop apps; the version is the registry's `DisplayVersion`, which for some vendors is a build number rather than a marketing version. |
| `pathList` | The tool is an archive, an extracted SDK, or writes a version file. Also the only option when there is no executable on `PATH`. |
| `pip` | The tool is a Python package. |
| `npmGlobal` | The tool is a global npm package. |
| `versionFile` | Exactly one file path is known and stable. Use `pathList` when that is not true. |
| `dir` | Presence is the only signal; no version is available. |

For `pathList`, `pattern` applies to the file content when `file` is set and to the matched path's
basename otherwise; the first capture group is the version. Keep `paths` ordered from most to least
likely, and keep the list short — every candidate costs filesystem lookups on every scan.

Two extra options turn a match from "the folder name looks right" into "the contents are right", which
matters whenever several versions live side by side:

- `requires: ['bin\\javac.exe']` — every listed relative path must exist inside the matched folder.
  Use it to exclude lookalikes: a JRE's `release` file also says `1.8`, but it has no `javac`.
- a version-pinning `pattern`, e.g. `JAVA_VERSION="(1\\.8[^"]*)"` rather than
  `JAVA_VERSION="([^"]+)"`. The loose form matches *any* JDK in the folder, so `jdk8` would happily
  report a JDK 17 as installed.

Adding a new kind means three edits: the `switch` in `probeItem` in `index.js`, the `PROBE_KINDS` set
in `scripts/check.mjs`, and the required-fields check in the same file. All three are enforced.

## Style

The code style is what the repository actually uses. Match it.

- **Plain ESM JavaScript.** No TypeScript, no JSX, no build step, no transpiler. `node --check` must
  pass on every file.
- **No dependencies, at runtime or at development time.** The self-check uses only `node:fs`,
  `node:os`, `node:path` and `node:url`. The browser half takes React from the DSH module table via
  `require('react')` and nothing else.
- Two-space indent, single quotes, no semicolons, trailing commas, `const` by default.
- Comments explain **why**, not what. The existing comments exist to record non-obvious constraints:
  why `.cmd` shims need `cmd.exe` and `windowsVerbatimArguments`, why `%DRIVES%` stops at `H:`, why
  glob expansion is not recursive, why the panel must wait for `webServer`. A comment that restates
  the next line should be deleted.
- Keep the host half and the browser half separate. `client.js` must not duplicate business logic: it
  talks to `/dsh-dev-env/api/*` and renders. If an operation is needed by both a tool and a panel
  button, implement it once in `index.js` and expose it twice.
- The browser half must not import DSH client packages. It uses React and the `--dsw-alias-*` theme
  tokens, and nothing else; a renamed token degrades the appearance instead of breaking rendering.

## Working on the plugin locally

Install your working copy into a profile with the `plugin_manager` tool (`action: install_bundle`,
`target` set to this directory) or `dsh plugin --profile <profile> add <this directory>`.

**Host-side code is imported once and cached.** `index.js`, `catalog.js` and `paths.js` are loaded
when DSH starts. After editing them you must **restart DSH** to see the change — disabling and
re-enabling the plugin re-runs `apply()` but does not re-import the module, and neither does renaming
the file or removing and reinstalling the bundle. Do not trust a stale result: if your new entry does
not show up, that is usually why.

The browser half is revisioned by file mtime and size, so a page refresh is enough for `client.js`.

`ctx.get('webServer')` at apply time is a trap that has already caused one shipped bug: the plugin can
activate before that service exists, the call returns `undefined`, the routes are never registered,
and you get a panel that renders while every API request answers `404`. Wait for the service with
`ctx.inject(['webServer'], (scope) => ...)`. See the Pitfalls section of [README.md](README.md).

## Pull requests

- One concern per pull request. A catalog addition and a probe-engine refactor are two pull requests.
- Say how you verified the change. "`npm test` passes" is necessary but not sufficient for a probe
  change — describe the machine you tested on and what the panel showed.
- If you change behaviour a user can see, update both `README.md` and `README.zh-CN.md`. They mirror
  each other.
- Do not add a dependency, and do not add a `peerDependencies` entry. The absence of peer
  dependencies is deliberate: it keeps DSH's pre-install version-compatibility gate from blocking the
  plugin.

## License

By contributing you agree that your contribution is licensed under GPL-3.0-or-later, the license of
this project. See [LICENSE](LICENSE).
