# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.3.x | Yes |
| 1.2.x | No |
| 1.1.x | No |
| 1.0.x | No |

The plugin is at 1.3.0 and has no released security history. Fixes land on `main` and are released as
a patch version. **Do not use 1.1.0**: its tarball was missing `describe.js`, so it cannot activate.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub Security Advisories:

<https://github.com/cszi666/dsh-dev-env/security/advisories/new>

Do not open a public issue for a security problem. Include what you did, what happened, what you
expected, the DSH and plugin versions, and — if the problem involves an install job — the exit code
and log the panel showed. You can expect an acknowledgement within a few days.

## What the plugin does on your machine

This is a local developer-tooling plugin. To do its job it deliberately touches system state, so its
behaviour is worth stating precisely rather than leaving to inference.

**It reads.** The plugin reads three Windows uninstall-registry hives
(`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`,
`HKLM\SOFTWARE\WOW6432Node\...\Uninstall`, `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`)
through a one-shot `powershell.exe -NoProfile -NonInteractive` call that projects `DisplayName`,
`DisplayVersion` and `InstallLocation` to JSON. It also reads the Machine and User `Path` values from
the registry, and checks whether specific files and directories named in the catalog exist.

**It executes local binaries.** For `argv` probes it runs the tool's own version command — `java
-version`, `gcc --version`, `python -m pip show <module>`, `npm root -g`, and similar. This is how it
learns exact versions. What those binaries do is outside the plugin's control; they are the user's
own installed tools.

**It installs software, on request.** When the user clicks one-click install in the panel (or an
agent calls `dev_env_install` on the user's explicit request), the plugin runs one of `winget install
--id <id> -e --accept-source-agreements --accept-package-agreements --disable-interactivity`,
`npm install -g <pkg>`, or `python -m pip install <pkg>`. These change the machine, require network
access, and may raise a UAC elevation prompt. The panel streams the process output into a job list.

**It opens pages.** The `page` strategy and `POST /dsh-dev-env/api/open` open an `http(s)` URL in the
default browser.

**It writes nothing to disk and talks to nothing.** The plugin creates no files, keeps job logs in
memory only (capped at 300 lines per job, 40 jobs), and sends no telemetry. Its only outbound network
activity is what `winget`, `npm` and `pip` do after the user asks for an install. The browser half
talks to the DSH web server it was served from and to no other origin.

## Privileges and sandboxing

The host half runs inside the DSH host process, **with the privileges of that process**. It is not
confined by the DSH workspace file policy — that policy governs tool-mediated file access, not code
loaded as a plugin. A plugin therefore has whatever the DSH process has, which is typically the
user's own privileges; install commands that need elevation will prompt for UAC.

Consequences worth being explicit about:

- Installing this plugin is equivalent to trusting it to run commands in the DSH host process. Read
  the source before installing a fork.
- The HTTP API under `/dsh-dev-env/api/` is served by DSH's own web server on its loopback port and
  adds no authentication layer of its own. Anything that can reach that port can start an install.
  Treat the DSH web port as trusted-local, and do not expose it to a network you do not control.

## Threat model for the install executor

The install executor never runs a string supplied by the caller. This is structural, not a filter:

1. A request carries an `id` and a `mode`. The `id` is matched against `CATALOG` — an unknown id
   returns `404` and no plan is built.
2. The command line comes from that entry's own `install` declaration (`winget` / `npm` / `pip`),
   which is a constant in `catalog.js`. There is no field anywhere in the API or the tools that lets
   a caller supply a command, an installer id, a package name or an argument.
3. `mode` selects among the plans the entry already declares; a mode that matches none returns `400`.
   The values are plan modes, not free-form input.
4. `POST /dsh-dev-env/api/open` is the one endpoint that accepts caller-supplied text. It is
   validated against a strict `http(s)` URL pattern before use and is only ever handed to
   `cmd.exe /d /s /c start "" "<url>"`, which opens a browser. It cannot execute a program.

So the worst a caller can do through the API is install a catalog entry — something the UI offers as
a button. The trust boundary is the catalog file, which is why catalog changes deserve the review
attention described in [CONTRIBUTING.md](CONTRIBUTING.md).

Two residual risks are accepted and documented rather than mitigated:

- The plugin trusts whatever `winget`, the npm registry and PyPI serve. That is the user's existing
  package-manager trust relationship, with the same supply-chain properties.
- A catalog entry can name a package that a maintainer believes is the right one and that turns out
  to be wrong. Entries are reviewed like any other change; the self-check validates shape and
  portability, not whether a package id points at the intended vendor.
