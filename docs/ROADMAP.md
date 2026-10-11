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

### 1. A Cancel button in the panel *(do this first)*

The route exists (`POST /dsh-dev-env/api/jobs/cancel`) and kills the whole process tree with
`taskkill /T /F`, then reports its cleanup boundary. There is **no button**, so a slow `winget install`
— JMeter's Apache mirror, for instance — cannot be stopped from the UI at all. That is the exact
complaint that produced this list.

Done when: a running job can be cancelled from its row, the row ends as `cancelled`, and the log says
whether our own partial files were removed or an external installer's cache was left alone.

### 2. Extra roots: `paths.js`

`%DSH_DEV_ENV_ROOTS%` currently reads only the environment variable, which needs `setx` **and a DSH
restart**. Let the expansion accept a merged list instead.

### 3. Extra roots: `index.js`

- `import { mergeRoots, loadRoots, saveRoots, addRoot, removeRoot, describeProbeHint } from './roots.js'`
- `GET` / `POST` / `DELETE /dsh-dev-env/api/roots`
- feed `mergeRoots(process.env.DSH_DEV_ENV_ROOTS, loadRoots(file))` into the scan
- expose `describeProbeHint(entry)` per item as `hint`, **null for non-`pathList` entries**

That import is also what makes the self-check demand `roots.js` in `files[]` — the same guard that was
missing when `1.1.0` shipped without `describe.js`.

Done when: adding a root changes the inventory on the next scan **without restarting DSH**.

### 4. Extra roots: `client.js`

- show `已经安装？选择对应文件夹` next to a missing entry's install button, **only when `hint` is
  non-null**
- pick a folder with `uiWorkspace.pickDirectory()` (client service, confirmed present)
- on failure show `explainVerdict(entry, verdict)`, which names the condition that actually failed
- list the added roots with a remove action, so a wrong pick is undoable

### 5. `npm test` guards

Create `apache-jmeter-9.9.9` in a temp directory and assert that a picked root makes the probe match,
and that picking the parent folder reports the right missing condition.

### 6. Wire the download engine

`downloads.js` is written and verified against a real download (its output was byte-identical to the
published tarball), but **nothing imports it**, so it is inert. Wiring it needs
`plansFor` / `choosePlan` / `startJob` to grow a `download` plan mode, and that mode needs catalog
entries with **verified direct file URLs** — otherwise it is a code path nobody walks. So: census the
`install.page` URLs first (the checker used for this is `tools/probe-pages.mjs` in the workspace, kept
deliberately outside the plugin), then wire.

Once wired, pause/resume and a real speed/ETA display become possible — but only for files we fetch
ourselves. `winget` / `pip` / `npm` stay cancel-only: their progress output is hidden when stdout is
not a terminal, and pausing an installer mid-write is worse than cancelling it.

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
