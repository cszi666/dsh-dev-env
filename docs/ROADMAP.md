# Roadmap

What is done, what is next, and why in that order. Written so a session (or a person) with no
memory of the previous one can continue without re-deriving anything.

## Where things stand

- **npm**: `@cszi666/dsh-dev-env@1.1.1` is the newest published version. `1.1.0` is **broken** — its
  tarball was missing `describe.js`, so it could not activate. `1.0.0` works but predates everything
  below. **1.1.2 is prepared in the tree but not published**: it renames the package back to the
  unscoped `dsh-dev-env`, which is free again (`npm view dsh-dev-env version` → `E404`).
- **Everything on the list below is implemented and green.** `npm test` runs 71 checks, and the
  human-only steps that remain are listed in *Known gaps* rather than in *Next*.
- **The installed plugin is a `link:` to this working tree**, so whatever is in the tree is what DSH
  loads. Client-side changes need a page refresh; Host-side changes need a **DSH restart** (the Host
  module is imported once at startup).
- **The `link:` still points at the scoped name**, so a DSH restart is needed for this release's
  routes and download mode to take effect, even before publishing.

## Decisions already made (do not reopen)

- **The rename to the unscoped `dsh-dev-env` happened in 1.1.2**, across the four places listed in
  [RELEASING.md](RELEASING.md) under *Package name*. The HTTP route prefix `/dsh-dev-env/api/*`
  deliberately did not move with it, nor did the repository name.
- **Nothing is published until the work is done and has been exercised by hand.** The publish itself is
  a human step: `npm test`, `npm pack --dry-run`, then `npm publish` (or a `v1.1.2` tag for the
  workflow).
- **Features that need several round trips are deliberately last**, after the single-shot ones are
  stable. That means `dev_env_add_root` and the "let DSH find the folder" hand-off come after the
  plain folder picker works.

## Next, in this order

### 1. A Cancel button in the panel — **done**

The route exists (`POST /dsh-dev-env/api/jobs/cancel`) and kills the whole process tree with
`taskkill /T /F`, then reports its cleanup boundary. There **was no button**, so a slow `winget
install` — JMeter's Apache mirror, for instance — could not be stopped from the UI at all. That is
the exact complaint that produced this list.

The button is now on the job's row, locks itself as `取消中…` while the request is in flight, and the
row ends as `cancelled`. The detail view names the cleanup boundary (`partial-removed` vs
`external-cache-untouched`). `scripts/client-cancel.test.mjs` renders the real `client.js` against a
dependency-free React/DOM shim and clicks the actual button; a shape check in `scripts/check.mjs`
fails if either half of the wiring is removed.

Done when: a running job can be cancelled from its row, the row ends as `cancelled`, and the log says
whether our own partial files were removed or an external installer's cache was left alone.
**Met by the tests; still to be exercised by hand in DSH before the release** (client-side change:
needs a page refresh, not a restart).

### 2. Extra roots: `paths.js` — **done**

`%DSH_DEV_ENV_ROOTS%` currently reads only the environment variable, which needs `setx` **and a DSH
restart**. Let the expansion accept a merged list instead.

Merging now lives in `paths.js`: `configuredRoots(env, stored)` combines `envRoots()` with the store,
`mergeRootList` deduplicates case-insensitively (first spelling wins, environment first), and
`rootsFile()` picks the store location — `DSH_DEV_ENV_ROOTS_FILE`, else `<DSH_PROFILE_DIR>/dsh-dev-env/roots.json`,
else under `DSH_HOME`. The store is read **lazily, only for inputs that actually mention the
placeholder**, so a machine's roots file can never leak into an unrelated expansion. `expandEnv`'s
default deliberately stays file-free; a test that expands the placeholder passes `[]` and stays
hermetic.

### 3. Extra roots: `index.js` — **done**

- `import { mergeRoots, loadRoots, saveRoots, addRoot, removeRoot, describeProbeHint } from './roots.js'`
- `GET` / `POST` / `DELETE /dsh-dev-env/api/roots`
- feed `mergeRoots(process.env.DSH_DEV_ENV_ROOTS, loadRoots(file))` into the scan
- expose `describeProbeHint(entry)` per item as `hint`, **null for non-`pathList` entries**

That import is also what makes the self-check demand `roots.js` in `files[]` — the same guard that was
missing when `1.1.0` shipped without `describe.js`. It fired exactly as documented the first time
`npm test` ran after the import was added.

Two things the plan did not anticipate, worth knowing before touching this again:

- **The merge has one implementation, not two.** Feeding the merged list into the *expansion* would
  have duplicated `paths.js`'s merge; instead `index.js` uses `configuredRoots(process.env, stored)`
  for what it reports, and `expandEnv`'s own default for what it searches. They agree because it is
  the same function.
- **Picking the tool's own folder used to fail.** Candidates are written as
  `<root>\<tool-folder-pattern>`, so a pick of `…\apache-jmeter-5.6.3` expanded to
  `…\apache-jmeter-5.6.3\apache-jmeter-*` — a path that exists nowhere — while `roots.js`'s own hint
  tells users to pick exactly that folder. `paths.js` gained `parentDirStartingPoint()` (also tried:
  the directory above, when the last segment is the tool folder itself) so either pick works. This is
  a "done when" fix, not a nicety: without it the feature's advertised instruction silently failed.

Done when: adding a root changes the inventory on the next scan **without restarting DSH**.
**Verified end to end** by `tools/roots-e2e.mjs`, which drives the real routes against the real
catalog probes with a throwaway store: `POST` a JMeter folder, then the next `GET /api/inventory`
reports `installed: true, version: 5.6.3`. It is a manual script (it needs a real JMeter on the
machine), not part of `npm test` — step 5 is the automated version.

### 4. Extra roots: `client.js` — **done**

- show `已经安装？选择对应文件夹` next to a missing entry's install button, **only when `hint` is
  non-null**
- pick a folder with `uiWorkspace.pickDirectory()` (client service, confirmed present)
- on failure show `explainVerdict(entry, verdict)`, which names the condition that actually failed
- list the added roots with a remove action, so a wrong pick is undoable

The service contract was read out of the live DSH rather than assumed
(`cordis_inspect_query`, platform `client`, provider `Service`, service `uiWorkspace`):
`pickDirectory(): Promise<string | null>` — **`null` means cancelled**, which is why cancelling is
silent here and needs no error handling. Access is optional (`ctx.get('uiWorkspace')`), and when the
service is absent the button is not rendered at all, so there is never a button that cannot work.

Two details worth keeping:

- The receipt is shown **on the row that was picked**, not as a page-level error. The user just acted
  on that row, so that is where the answer belongs.
- A successful pick triggers a rescan; a refusal does not. "Recognised it" changes the inventory,
  "still not recognised" cannot, and rescanning would only spend seconds showing the same answer.

`roots` entries gained `source` (`picked` / `env`) and `removable`, so Remove is offered only where
removing is possible. An environment-set root is listed with its origin and **no** button — the panel
cannot delete it, and a dead button is worse than an honest label.

### 5. `npm test` guards — **done**

Create `apache-jmeter-9.9.9` in a temp directory and assert that a picked root makes the probe match,
and that picking the parent folder reports the right missing condition.

Four guards now cover this, all against **real** temporary folders:

- a picked root makes `probeItem` find the tool from **either** level (the tool's own folder, or its
  parent), with the version read from the folder name;
- a picked folder reports the **specific** condition it failed (the pattern it did not match), not a
  generic "not found";
- a `pathList` probe with a `file` rejects the folder **above** the tool, naming the missing file and
  the missing `requires` entry;
- a probe that reads a version out of a file **needs** the level above to be tried: picking the tool
  folder expands to `…\tool-1.2.3\tool-*`, which exists nowhere, and only
  `parentDirStartingPoint()` saves it.

That last one is the important one, and it is deliberately written against a **local fixture probe**
rather than a catalog entry, so it cannot rot when the catalog changes. It was also the test that
exposed a blind spot: an earlier version of the first guard passed even with the parent fallback
disabled, because for the JMeter entry the exact path happens to match on its own. Mutating
`parentDirStartingPoint()` to return `null` now makes the suite fail — which is the only evidence
that a guard is a guard.

`index.js` exports a small `__test` surface (`probeItem`, `probeAtDir`, `scanRoots`, `rootsView`) so
the self-check can drive the scanner's real probing. The alternatives were exporting those under
ordinary names (widening the plugin's public surface for no user) or copying the logic into the test
(creating the second implementation this design exists to avoid). `probeItem` takes an optional
`{ roots }` for the same reason: without it a guard would depend on whatever folders the machine
running the tests happens to have picked.

### 6. Wire the download engine — **census done, and it changes the plan**

`downloads.js` is written and verified against a real download (its output was byte-identical to the
published tarball), but **nothing imports it**, so it is inert. Wiring it needs
`plansFor` / `choosePlan` / `startJob` to grow a `download` plan mode, and that mode needs catalog
entries with **verified direct file URLs** — otherwise it is a code path nobody walks. So: census the
`install.page` URLs first (the checker used for this is `tools/probe-pages.mjs` in the workspace, kept
deliberately outside the plugin), then wire.

Once wired, pause/resume and a real speed/ETA display become possible — but only for files we fetch
ourselves. `winget` / `pip` / `npm` stay cancel-only: their progress output is hidden when stdout is
not a terminal, and pausing an installer mid-write is worse than cancelling it.

#### What the census found (2026-10-11, this machine)

- 82 entries, **64 distinct hosts**. The `page` links are landing pages, not files.
- **`github.com` is unreachable from here** — `fetch` fails outright, and this is the same condition
  that made a `winget install apache-jmeter` look stuck (winget was waiting on GitHub).
- Only **13 entries have no winget/npm/pip at all**, so those are the only ones a download engine
  could ever serve. Of those, the ones with a **reachable, self-hosted, stable direct file URL** are:

  | entry | URL | verified |
  |---|---|---|
  | `adb` | `https://dl.google.com/android/repository/platform-tools-latest-windows.zip` | 200, 7.7 MB, `application/zip`, 186 ms |
  | `junit` | `https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/1.11.3/junit-platform-console-standalone-1.11.3.jar` | 200, 2.7 MB, `application/java-archive`, 856 ms |
  | `jmeter` | `https://dlcdn.apache.org/jmeter/binaries/apache-jmeter-5.6.3.zip` | 200, 86.4 MB, `application/zip`, 489 ms |

  `dlcdn.apache.org` also lists its own filenames (`…/jmeter/binaries/` → `apache-jmeter-5.6.3.zip`),
  so that URL can be discovered rather than hardcoded — Apache keeps only the current release there,
  and hardcoding a version would rot.

- Everything else is ruled out, each for a checkable reason:
  - **Adoptium (`java`/`javac`/`jdk8`)** — the API works and even reports size (`182.0MB`), but the
    asset `link` is a **GitHub release URL**: unreachable here. This is precisely the case where a
    download engine cannot help and winget cannot either.
  - **Tomcat** — the versioned directory on dlcdn lists only `.sha512`/`.asc`; the archives had moved.
    A hardcoded path 404s.
  - **`zentao`, `wechat-devtool`, `deveco*`** — HTML interstitials or Huawei's login-gated portal.
  - **`scoop`** — not an archive at all (a PowerShell install script).

**Conclusion:** a real download engine with speed/ETA is worth wiring for **three** entries, not for
the catalog. The user-visible complaint that started this (a stalled JMeter install) was fixed by the
cancel button, not by this: winget stalled on a blocked host, and fetching the file ourselves only
helps where *we* can reach it. Small, honest, and verified beats a general mechanism that mostly
cannot run.

#### Wired, for `jmeter` — **done**

`downloads.js` now owns URL resolution as well as transfer, because the catalog cannot hold a usable
URL for this entry: `dlcdn.apache.org` keeps only the current release and its filename carries the
version, so a pinned URL rots at the next release — silently, since a 404 is indistinguishable from an
unreachable network. So `install.download` says *where to look*:

```js
download: { listing: 'https://dlcdn.apache.org/jmeter/binaries/',
            fileNamePattern: '^apache-jmeter-([\\d.]+)\\.zip$',
            fallback: { listing: 'https://archive.apache.org/dist/jmeter/binaries/', … } }
```

`resolveDownload()` reads the listing, takes the **numerically** newest match (`compareVersions`, so
5.10 beats 5.9 where text order would pick 5.9), verifies it with the same HEAD/Range probe a resume
uses, and falls back only if the primary yields nothing. It returns the size, which is the whole point:
winget cannot report one when its output is piped, and without a size there is no honest speed or ETA.

`choosePlan` prefers a managed installer over `download` on purpose — winget owns upgrades and
uninstall, while a file we fetch does not. `download` is used when it is the only real option, or when
the user asks for it by name.

The download job reuses the same `job` object, so the panel and `dev_env_job` need no new concepts:
`receivedBytes`, `totalBytes`, `bytesPerSecond`, `etaSeconds` join `percent` and `activity`, and
`downloadCancels` maps a job id to a cancel closure that interrupts the transfer and deletes `.part`
plus metadata — so the cancel route's `partial-cleanup` branch finally has something to clean.

**Verified on this machine** (each step, with the real 86 MB archive):

| step | evidence |
|---|---|
| resolution | `apache-jmeter-5.6.3.zip`, `total: 90631635`, `etag`, from the listing, in 413 ms |
| transfer | 86.4 MB in 6.6 s; **downloaded size === Content-Length** exactly |
| rate / ETA | real numbers, 13–19 MB/s, ETA 1–5 s, matching the observed wall clock |
| cancel mid-transfer | at 4.8%: `.part` + metadata gone, `cleanup: partial-removed`, no leftovers |
| extraction | `tar -xf <zip> -C <dir>` → `<dir>\apache-jmeter-5.6.3` with `bin\jmeter.bat`, `lib\ext` |
| recognition | the same probe reports `installed: true, version: 5.6.3`; the folder is registered as an extra root |

Two things about verifying this are worth keeping:

- **The DSH sandbox blocks Node from spawning with piped stdio** (`spawn EPERM`). `npm test` still runs
  `run(['npm', …])` fine because the plugin host's own spawns use different stdio, but a *test process*
  cannot extract a zip. The extraction was therefore verified by running the byte-identical `tar`
  command in PowerShell, and the probe by pointing it at the real extracted folder.
- `tools/download-prepare.mjs` writes the 86 MB archive into `out/` (gitignored). Nothing in `npm test`
  touches the network.

`adb` (7.7 MB, `dl.google.com`) and `junit` (2.7 MB, Maven Central) resolve the same way and are the
obvious next two entries; the census above has their verified URLs.

### 7. Release 1.1.2 — **prepared, awaiting the human publish**

Rename to `dsh-dev-env`, update `CHANGELOG.md` / `SECURITY.md` / `RELEASING.md`, run `npm pack
--dry-run` and read the file list, then publish. The unpublish cooldown for the unscoped name has
already expired.

All of that is done in the tree:

- renamed in the four places, with `/dsh-dev-env/api/*` deliberately unchanged;
- `package.json` at `1.1.2`, `CHANGELOG.md` has a dated `[1.1.2]` section and its link, `SECURITY.md`
  says 1.1.2, `RELEASING.md` records the rename as done and tracks `v1.1.2`;
- `npm test` green (71 checks), `npm pack --dry-run` **20 files** — every module the code imports is
  in the tarball, including `roots.js` and `downloads.js`;
- `npm view dsh-dev-env version` → `E404`, so the name is free.

**What is left is only the publish**, which is a human step because it needs the npm session/2FA (and
because a published version number can never be reused — see the unpublish lesson in RELEASING.md):

```powershell
npm test
npm pack --dry-run          # read the list
npm publish --access public # or: git tag v1.1.2 && git push origin v1.1.2
```

One note for the machine this was developed on: `npm` needs a writable cache, and outside the sandbox
the default is fine. Inside it, `npm_config_cache` had to point somewhere writable, and `npm view` /
`npm pack` failed with `EPERM` until it did.

### 8. Uninstall — **done, unreleased**

Added after 1.1.2 shipped, at the user's request: the detail area should be able to remove an
installed tool, not only install one.

The census that decided the shape (`tools/census-uninstall.mjs`, read-only):

| route | entries |
|---|---|
| `winget uninstall --id` (catalog declares a winget id) | **59** |
| `npm uninstall -g` / `pip uninstall -y` | 10 |
| Windows' own `UninstallString` (registry probe) | 2 here, more on machines that have them |
| **install-by-hand, no route at all** | **11** — no button offered |

Two things the census changed:

- **Uninstall is offered per entry, never generically.** The host computes `uninstall` per item and
  returns `null` when there is no honest route, so the panel cannot render a dead button. The
  install-by-hand entries (zentao, adb, junit, scoop, choco…) have no install record anywhere, and
  deleting a folder we did not create is not a guess worth making.
- **The command is not always what the registry says.** Ten of the 23 registry-probed entries on this
  machine resolve to a command, and two of those are `MsiExec.exe /I{GUID}` — `/I` is install/repair,
  so executing it from an uninstall button would repair or reinstall the product.
  `normaliseUninstallCommand()` rewrites exactly that one form to `/X` and reports it; every other
  shape passes through untouched.

Deliberate boundaries, all of them visible in the UI rather than hidden:

- **A confirmation is mandatory** and names the exact command, that it cannot be undone, and any
  extra risk (core tool / interactive wizard / only-if-installed-that-way).
- **The result is re-checked with the scanner's own probe**, because exit code 0 is not evidence. A
  success the re-check contradicts becomes a failure.
- **Interactive uninstallers cannot be tracked.** 28 of 324 registry entries have a
  `QuietUninstallString`; the rest open a wizard of their own. Those jobs hand over, say so, and tell
  the user to rescan — with a 15-minute kill timer so a job cannot sit in `running` forever.
- **No agent tool for this yet.** Uninstalling is destructive enough that it should stay a deliberate,
  confirmed human action; a `dev_env_uninstall` tool would let a model do it in one call. Add it only
  if there is a real need, and with the same confirmation boundary.

Not yet exercised by hand: an actual uninstall of a real tool. The tests cover the plan, the
confirmation, the refusal to offer a dead button, the re-check display and the `/I` rewrite, but the
end-to-end "click it and the tool is gone" path needs one manual pass (git is a safe candidate).

### 9. Ask DSH for help from a job — **done, unreleased**

Also requested after 1.1.2: a failure only surfaced as a log inside the detail area, which leaves the
user exactly where they started. There is now a **让 DSH 帮我解决** button on a job that failed *or is
still running* (a hang is when help is most wanted; a succeeded job offers nothing).

It reuses the hand-off tool explanations already had, so there is one mechanism rather than two:
`POST /api/explain` with either `{ id }` (explain a tool) or `{ jobId }` (diagnose a job), both going
through `askDsh()`, which posts into the most recently active session.

The message is built from the job's **real state**, not a paraphrase of it — status, phase, command or
source, error, download URL, byte counts, exit code, note, and the last 30 log lines — and it names
`dev_env_inventory` / `dev_env_job` so DSH checks the machine instead of assuming. One line matters as
much as the facts: it asks for a resolution, not a list of possible causes. `npm test` guards that all
of that is present in both languages, and that no optional line collapses into a stray blank line (a
job without an exit code used to render one in the middle of the facts).

Still to exercise by hand: the round trip — click it, watch the question arrive in the session, and
confirm the answer is useful. The earlier "let DSH explain a tool" flow was verified that way.

### 10. Download-source picker — **done, unreleased**

Requested after 1.1.2: one-click install should offer a choice of download source, with the first
(most reliable) route starting on its own after five seconds if nothing is chosen.

Two things were verified before building it, because the request assumed them:

- **The mirrors work.** 清华 TUNA and 阿里云 resolve the same archives as Apache's own mirror, to the
  same versions (jmeter 5.6.3, tomcat9 9.0.122, tomcat11 11.0.26). 中科大 does not resolve Tomcat's
  directory layout and Huawei's Tomcat tree is not shaped like a version listing — both were left out
  rather than shipped as options that fail.
- **Latency, not throughput, is where a mirror helps.** A 512 KB sample puts all four within noise of
  each other (0.5–1.0 MB/s; domestic mirrors sync from upstream, so they are not a faster copy). What is
  measurably better is listing resolution — 253–360 ms for TUNA against 279–963 ms for dlcdn. The honest
  pitch is therefore *another reachable route*, which matters here because `github.com` is blocked.

**Auto-start is only safe because of the verification order.** The countdown does not begin until the
host has resolved and HEAD-probed every source; unverified mirrors are filtered out of the list, and if
nothing verifies the countdown never runs and nothing is installed. The default fires on a route that
was just proven, not on a hope. Entries whose packages come from `winget` / `pip` / `npm` show no picker
at all: we do not choose how those fetch, so a source list there would be a false choice.

Three defects were found while building it, two in the panel rather than the plumbing:

1. **The countdown could never reach zero.** Its timer was cleared and re-armed on every render, and the
   panel re-renders about once a second for job polling and the clock, so the one-second tick was
   cancelled before it could fire past the first step. It lives in a ref now.
2. **The picker was rendered inside the `tab === 'missing'` branch.** With the "All" tab selected the
   state updated and nothing was drawn: the countdown would have expired invisibly and installed
   something the user could not see. It renders at the panel root now.
3. **The test double could not have caught either.** Its `useEffect` had been simplified to "run once per
   slot" to dodge a false dependency loop, which made every dependency-driven effect untestable, and
   `advance()` fired timers without running the effects they scheduled, so a one-second interval
   advanced exactly once per call. Both are fixed — effects now compare dependencies the way React does,
   and `advance()` drains the effect queue between timers. Until those two were fixed, defect 1 was
   invisible to the suite.

## Known gaps and unverified paths

- **"Let DSH explain this tool"** was verified working by hand (the question arrived in the session).
- ~~**The download engine's speed/ETA maths** is covered by unit tests with synthetic samples…~~
  **Closed:** measured live on the real 86 MB JMeter archive (13–19 MB/s, ETA 1–5 s, matching the wall
  clock), and `npm test` now drives a chunked transfer through `startDownload` with a time-stamped
  meter and asserts the rate and ETA are real numbers.
- **Resume is implemented but has never been exercised on a real interrupted transfer.** `decideResume`
  and the `Range` path are unit-covered, `dlcdn.apache.org` does advertise `accept-ranges: bytes`, and
  the cancel path deletes partials — so the interesting case is "the network dropped mid-transfer and
  nobody cancelled it". Nothing here can simulate that (`clumsy` and `tc` are not installed; `netsh`
  could, but it is a machine-wide change). Verify by hand: start a download, cut the network, restart
  DSH, and check that the next attempt reports `从 … 处继续`.
- **`adb` and `junit` have verified direct URLs but no `install.download` yet.** Both were probed
  successfully (see step 6); only `jmeter` is wired, because that is the entry the complaint was about
  and the one whose URL needed discovery rather than a constant.
- **`winget` gives no size or speed when its output is piped.** The panel shows an indeterminate bar
  and the elapsed time instead of inventing a number.
- **A cancelled `winget` install cannot have its downloaded cache removed** — it is opaque and not
  ours to delete. The job records `external-cache-untouched` so the boundary is visible rather than
  implied.
- `docs/screenshot.png` is referenced by the README and does not exist yet.
