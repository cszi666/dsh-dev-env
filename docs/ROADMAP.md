# Roadmap

What is done, what is next, and why in that order. Written so a session (or a person) with no
memory of the previous one can continue without re-deriving anything.

## Where things stand

- **npm**: `@cszi666/dsh-dev-env@1.1.1` is live. `1.1.0` is **broken** — its tarball was missing
  `describe.js`, so it could not activate. `1.0.0` works but predates everything below.
- **The installed plugin is a `link:` to this working tree**, so whatever is in the tree is what DSH
  loads. Client-side changes need a page refresh; Host-side changes need a **DSH restart** (the Host
  module is imported once at startup).
- `main` is green: `npm test` passes, `prepublishOnly` runs the same checks.

## Decisions already made (do not reopen)

- **The package stays `@cszi666/dsh-dev-env` until the next release.** The unscoped name
  `dsh-dev-env` is available again (its 24-hour cooldown expired), so the next release renames to it
  and ships as **1.1.2**. The four places the rename touches are listed in
  [RELEASING.md](RELEASING.md) under *Package name*.
- **Nothing is published until the remaining work is done and has been exercised by hand.**
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

The three URLs above are still to be wired, plus a live check of `downloads.js`'s speed/ETA maths
against the 86 MB JMeter zip — the gap noted below.

### 7. Release 1.1.2

Rename to `dsh-dev-env`, update `CHANGELOG.md` / `SECURITY.md` / `RELEASING.md`, run `npm pack
--dry-run` and read the file list, then publish. The unpublish cooldown for the unscoped name has
already expired.

## Known gaps and unverified paths

- **"Let DSH explain this tool"** was verified working by hand (the question arrived in the session).
- **The download engine's speed/ETA maths** is covered by unit tests with synthetic samples, not by a
  long real download — a small file finishes in one chunk. Verify it during step 6 with a real entry.
- **`winget` gives no size or speed when its output is piped.** The panel shows an indeterminate bar
  and the elapsed time instead of inventing a number.
- **A cancelled `winget` install cannot have its downloaded cache removed** — it is opaque and not
  ours to delete. The job records `external-cache-untouched` so the boundary is visible rather than
  implied.
- `docs/screenshot.png` is referenced by the README and does not exist yet.
