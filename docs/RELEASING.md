# Releasing

Maintainer checklist, in order. Everything here has been done once on the reference machine
(Windows, DSH 0.2.0-rc.2); the commands are exactly what was run.

## 0. Prerequisites

- A GitHub account that will own the repository.
- An npm account, if you also want the `dsh plugin add dsh-dev-env` path. The name `dsh-dev-env` was
  free when this was written; check with
  `npm view dsh-dev-env version` (an `E404` means it is still available).
- Git on `PATH`. (`winget install --id Git.Git` — the panel can do this for you.)
- A way to run a plugin install. The `dsh plugin ...` commands on this page need the `dsh` CLI
  (`@deepseek-ai/dsh`, which exposes `bin: { dsh: lib/bin.js }`). The **desktop build bundles it
  inside the app and does not put it on `PATH`**, so on a desktop-only machine use one of:

  - the Web UI: **Settings → Plugins**, then paste the same spec, or
  - an agent session: the `plugin_manager` tool with `action: install_bundle`, or
  - `npx @deepseek-ai/dsh plugin --profile <profile> add <spec>`.

## 1. Identity is already set — check it

This repository ships with the maintainer's identity filled in (`cszi666`,
`樱色是最好的 <cszi666@users.noreply.github.com>`). Nothing has to be replaced before the first release.

**If you forked it**, substitute your own identity first:

```powershell
cd plugins/dsh-dev-env

# every place the upstream account appears
Select-String -Path .,README.md,README.zh-CN.md,CONTRIBUTING.md,SECURITY.md,CHANGELOG.md,package.json `
  -Pattern 'cszi666' -List

# author.name / author.email / author.url in package.json, plus homepage / repository / bugs
```

Then pick your own package name: `dsh-dev-env` is taken on npm from the moment the upstream release is
published, so a fork must either publish under a scope (`@your-scope/dsh-dev-env`) or rename. Renaming
means updating `package.json` `name`, the `cordis.patch.yml` row, the `id:` passed to
`__ModuleLoader__.load` in `client.js` (it must equal the package name), and the HTTP route prefix in
both halves.

`scripts/check.mjs` fails on a leftover `GITHUB_USER` template token, on a missing `author`, and on a
`repository` URL that is not a real repository, and it warns for the Markdown files. A half-finished
substitution therefore cannot be published by accident. A clean run prints
`all checks passed (82 catalog entries)`.

## 2. Verify the plugin in DSH before anyone else sees it

The catalog and path resolver were refactored for portability, and host-side JavaScript is imported
once per process, so:

1. **Restart DSH.** Editing `index.js` / `catalog.js` / `paths.js` never takes effect without it.
2. Open the sidebar panel and confirm the inventory looks right on your machine.
3. If one of your tools lives in an unusual folder (a JMeter or Tomcat you unzipped yourself), point
   the scanner at it instead of editing the catalog:

   ```powershell
   setx DSH_DEV_ENV_ROOTS "D:\Java\tools;E:\sdk"
   ```

   Then restart DSH so the host process sees the variable.
4. Click a gap and confirm the job list streams output. Prefer a small, safe package for the smoke
   test — Git is a good choice.

## 3. Create the repository and push

Create an **empty** repository on GitHub named `dsh-dev-env`: no README, no `.gitignore`, no license
file, or the first push will conflict.

```powershell
# Only if these are empty: `git commit` refuses to run without an identity.
# Your existing global values (if any) are what your commits will be attributed to — they do not
# have to match `author` in package.json, which is the published package metadata.
git config --global user.name "your name"
git config --global user.email "you@example.com"

cd plugins/dsh-dev-env
git init -b main
git add .
git commit -m "feat: dsh-dev-env 1.0.0 — inventory the local toolchain and fill the gaps"
git remote add origin https://github.com/cszi666/dsh-dev-env.git
git push -u origin main
```

## 4. Test the GitHub install path

Use a **separate DSH profile** for this. The maintainer's own profile already has the plugin installed
as a `link:` to the working copy, and installing from GitHub would replace it.

How you install depends on who you are:

- **Desktop app, ordinary user.** Ask the agent — paste `Install the DSH plugin
  github:cszi666/dsh-dev-env` into a session — or use **Settings → Plugins**. An npm-installed `dsh`
  CLI *cannot* manage the `desktop` profile, which is Electron-owned; only the Desktop build's own
  bundled command can.
- **`dsh` CLI, another profile.** `dsh plugin --profile <profile> add github:cszi666/dsh-dev-env`.
  `dsh plugin` forwards its arguments to pnpm inside the profile directory, so any pnpm spec works.
  `<profile>` cannot be `desktop`.

DSH checks the repo with `git ls-remote` before installing, so a typo in the account or repository name
fails fast and clearly.

Then confirm the panel appears **and returns data**. A panel that renders but answers `404` on
`/dsh-dev-env/api/*` means the `webServer` injection did not run — see the Pitfalls section of
[../README.md](../README.md). Check the install result's `application` field rather than just the
appearance of a row: a row can be selected while its plugin failed to activate.

## 5. Publish to npm

```powershell
npm login
npm test                  # last guard before the irreversible step
npm publish --access public
```

`npm publish` is append-only: a version can be unpublished only within 72 hours and the name is then
gone forever. If something is wrong, publish a patch version instead of unpublishing.

Sanity-check the tarball first if you changed `files[]`:

```powershell
npm pack --dry-run
```

It should list 16 files and no `.github/` directory.

## 6. Tag the release

Set up npm publishing **before** pushing the tag, otherwise the tag triggers a workflow run that fails
on a missing secret. Create an npm automation token, then store it as the repository secret `NPM_TOKEN`
(Settings → Secrets and variables → Actions → New repository secret), and only then:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

That publishes the package through `.github/workflows/release.yml`, and gives the link at the bottom of
`CHANGELOG.md` (`releases/tag/v1.0.0`) something to resolve to.

Prefer publishing by hand? Run `npm publish --access public` first and push the tag afterwards. The
workflow refuses to publish a version that is already on the registry, so the tag run becomes a no-op —
but without `NPM_TOKEN` it still reports red, so create the secret either way.

**State as of 1.0.0: the package is not on npm yet.** The GitHub spec
(`github:cszi666/dsh-dev-env`) is the only install path that works today.

## 7. Finish the repository settings

- Add a screenshot at `docs/screenshot.png` (the README points at that path) and reference it.
- Add repository topics so people can find it: `dsh`, `dsh-plugin`, `deepseek-harness`,
  `developer-tools`, `winget`, `windows`.
- Set the repository description to the `package.json` description.
- Enable *Private vulnerability reporting* under Settings → Security, which `SECURITY.md` relies on.

## 8. Shipping an update later

```powershell
# edit code / catalog
npm test
npm version patch        # bumps package.json and creates the tag
git push --follow-tags
npm publish --access public
```

Users pick it up with `dsh plugin --profile <profile> add dsh-dev-env@<version>` or by reinstalling
the bundle. Remember that anyone running a plugin from a git spec receives the new commit only when
they reinstall it.

## A note on GPL-3.0

This project is `GPL-3.0-or-later`: anyone who distributes a modified version must release their
source under the same license. That is a deliberate choice, and it makes some corporate users
uncomfortable. If broad adoption matters more to you than copyleft, MIT or Apache-2.0 would be the
swap — change `license` in `package.json`, replace `LICENSE`, and update this file and the README.
