/**
 * Portable path resolution for the catalog.
 *
 * Kept in its own module (rather than inlined into the host half) so it can be unit
 * tested directly and reused, and so the "no hardcoded paths" rule has exactly one
 * implementation to review.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Read a text file without throwing; null when unreadable. */
export function safeRead(file, limit = 512 * 1024) {
  try {
    const text = readFileSync(file, 'utf8')
    return text.length > limit ? text.slice(0, limit) : text
  } catch {
    return null
  }
}

let cachedDrives = null

/**
 * Drives that `%DRIVES%` expands to: the system drive plus D:–H: when they exist.
 *
 * The upper bound is deliberate. Probing every letter can block for seconds on a
 * disconnected network mapping, and a toolchain scan must never do that; the system
 * drive plus the usual data letters covers how these tools are actually installed.
 */
export function availableDrives(fileExists = existsSync) {
  if (fileExists === existsSync && cachedDrives) return cachedDrives
  const system = (process.env.SystemDrive || process.env.SYSTEMDRIVE || 'C:').replace(/[\\/]+$/, '')
  const drives = [system]
  for (const letter of ['D', 'E', 'F', 'G', 'H']) {
    const candidate = `${letter}:`
    if (drives.some((drive) => drive.toLowerCase() === candidate.toLowerCase())) continue
    try {
      if (fileExists(`${candidate}\\`)) drives.push(candidate)
    } catch {
      /* unreadable drive: skip it */
    }
  }
  if (fileExists === existsSync) cachedDrives = drives
  return drives
}

/**
 * Extra roots the user points at with `DSH_DEV_ENV_ROOTS` (semicolon separated).
 *
 * This is the escape hatch for tools someone unzipped into a folder of their own:
 * setting the variable is a one-line fix, no code edit and no recursive disk crawl.
 * The panel is the other escape hatch — see `configuredRoots` for how the two combine.
 */
export function envRoots(env = process.env) {
  const raw = env.DSH_DEV_ENV_ROOTS ?? env.dsh_dev_env_roots
  if (!raw) return []
  return String(raw)
    .split(';')
    .map((entry) => entry.trim().replace(/[\\/]+$/, ''))
    .filter(Boolean)
}

/**
 * Where the panel's picked folders are remembered.
 *
 * `DSH_DEV_ENV_ROOTS_FILE` wins when set, which is what makes the store testable and lets an
 * unusual install put it elsewhere. Otherwise it goes under the DSH profile
 * (`<profile>/dsh-dev-env/roots.json`), falling back to `DSH_HOME`. The plugin's own directory
 * would be the obvious place and is the wrong one: a globally installed plugin shares one folder
 * across all profiles and workspaces, and its files must not be written to at runtime.
 */
export function rootsFile(env = process.env) {
  const custom = env.DSH_DEV_ENV_ROOTS_FILE
  if (custom && String(custom).trim()) return String(custom).trim()
  const base = env.DSH_PROFILE_DIR || (env.DSH_HOME ? path.join(env.DSH_HOME, 'profiles', 'default') : null)
  if (!base) return null
  return path.join(base, 'dsh-dev-env', 'roots.json')
}

/**
 * Does this candidate string contain the `%DSH_DEV_ENV_ROOTS%` placeholder?
 *
 * Matched without building a RegExp from user input, so a root containing regex metacharacters can
 * never affect the decision.
 */
export const ROOTS_VAR = '%DSH_DEV_ENV_ROOTS%'
export const mentionsRoots = (text) => String(text).toLowerCase().includes(ROOTS_VAR.toLowerCase())

/** A path segment that stands for a tool's own folder rather than a fixed name. */
const segmentLooksLikeTool = (segment, pattern) => {
  if (!segment) return false
  if (segment.includes('*') || segment.includes('?')) return true
  if (!pattern) return false
  try {
    return new RegExp(pattern, 'i').test(segment)
  } catch {
    return false
  }
}

/**
 * The second place to start looking, for a candidate that began at `%DSH_DEV_ENV_ROOTS%`.
 *
 * A user picking a folder cannot know whether the plugin wants the tool's own directory or its
 * parent: the panel tells them to choose the tool's directory (that is the "smallest thing that
 * identifies it"), while the catalog writes candidates as `<root>\<tool-folder-pattern>`. Appending
 * the pattern to an already-complete tool folder yields `…\apache-jmeter-5.6.3\apache-jmeter-*`,
 * which exists nowhere — the pick would look broken.
 *
 * So when the expansion's last segment is the tool folder itself (a wildcard, or something the
 * probe's own pattern matches), drop that segment and offer the directory above it too. Returns
 * null when there is nothing to drop, which keeps every other candidate exactly as it was.
 */
export function parentDirStartingPoint(expanded, probe = {}) {
  if (typeof expanded !== 'string' || !expanded) return null
  const trimmed = expanded.replace(/[\\/]+$/, '')
  const segments = trimmed.split(/[\\/]+/)
  if (segments.length < 3) return null // a drive root plus one segment has no parent worth trying
  const last = segments.pop()
  if (!segmentLooksLikeTool(last, probe.pattern)) return null
  const parent = segments.join(path.sep)
  return parent && parent !== trimmed ? parent : null
}

/**
 * The extra roots a scan should use: the environment variable plus whatever the user picked in the
 * panel, merged and deduplicated.
 *
 * `storedRoots` defaults to the file recorded by `rootsFile()`. `expandEnv` deliberately does not
 * go through this default — a unit test that expands `%DSH_DEV_ENV_ROOTS%` must not read whatever
 * happens to be on the machine running it.
 */
export function configuredRoots(env = process.env, storedRoots = undefined) {
  const stored = storedRoots === undefined ? loadStoredRoots(rootsFile(env)) : storedRoots
  return mergeRootList(envRoots(env), stored)
}

/**
 * Merge two lists of roots: case-insensitive deduplication, first list first.
 *
 * `roots.js` has the full store (add/remove/persist) and is the one the panel uses. This smaller
 * copy exists so `paths.js` can stay the single module that knows how a root becomes a candidate,
 * and so the merge can be tested without a filesystem. Keep them agreeing on one thing: a root is
 * compared case-insensitively, because Windows paths are.
 */
export function mergeRootList(primary = [], secondary = []) {
  const merged = []
  const seen = new Set()
  for (const candidate of [...primary, ...secondary]) {
    if (typeof candidate !== 'string') continue
    const clean = candidate.trim().replace(/[\\/]+$/, '')
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(clean)
  }
  return merged
}

/**
 * Read the picked folders without ever throwing: a missing, empty or corrupt file means "the user
 * has not picked anything", which is not an error worth failing a scan over.
 */
export function loadStoredRoots(file) {
  if (!file) return []
  try {
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.roots) ? parsed.roots : []
    return list.filter((entry) => typeof entry === 'string' && entry.trim())
  } catch {
    return []
  }
}

/**
 * Pseudo-variables that stand for more than one path.
 * `%DRIVES%` covers the usual install drives; `%DSH_DEV_ENV_ROOTS%` is user configured.
 *
 * `DSH_DEV_ENV_ROOTS` is carried in by `expandEnv` rather than read out of `env` here, so that
 * expanding the placeholder uses exactly the merged list the caller already decided on (and never
 * silently touches the filesystem).
 */
const MULTI_VALUE_VARS = [
  ['DRIVES', (env, fileExists) => availableDrives(fileExists)],
  ['DSH_DEV_ENV_ROOTS', (env, fileExists, roots) => roots],
]

function expandMultiValue(text, env, fileExists, roots, depth = 0) {
  if (depth > 3) return []
  for (const [name, produce] of MULTI_VALUE_VARS) {
    const re = new RegExp(`%${name}%`, 'i')
    if (!re.test(text)) continue
    const variants = []
    for (const value of produce(env, fileExists, roots)) {
      variants.push(...expandMultiValue(text.replace(re, () => value), env, fileExists, roots, depth + 1))
    }
    return variants
  }
  return [text]
}

/**
 * Expand `%VAR%` (any environment variable, case-insensitive), `%DRIVES%`,
 * `%DSH_DEV_ENV_ROOTS%` and a leading `~`.
 *
 * May return several candidates, because a pseudo-variable stands for more than one path.
 * Returns [] when a referenced variable is unset, so an unset `%CATALINA_HOME%` never
 * degrades into a bogus relative path. That is the difference between "Tomcat is not
 * installed" and "the scanner looked in a nonsense directory".
 *
 * `storedRoots` is only consulted when the input actually contains `%DSH_DEV_ENV_ROOTS%`. When it
 * does and no list is passed, the environment variable and the panel's store are merged; passing
 * `[]` keeps the expansion free of any filesystem access.
 */
export function expandEnv(input, env = process.env, fileExists = existsSync, storedRoots = undefined) {
  if (typeof input !== 'string' || !input.trim()) return []
  let text = input.trim()
  if (text === '~' || text.startsWith('~\\') || text.startsWith('~/')) text = os.homedir() + text.slice(1)

  const roots = mentionsRoots(text)
    ? (storedRoots === undefined ? configuredRoots(env) : mergeRootList(envRoots(env), storedRoots))
    : []

  const expanded = []
  for (const variant of expandMultiValue(text, env, fileExists, roots)) {
    let unresolved = false
    const resolved = variant.replace(/%([^%]+)%/g, (_all, name) => {
      const value = env[name] ?? env[String(name).toUpperCase()]
      if (value === undefined || value === '') {
        unresolved = true
        return ''
      }
      return value
    })
    if (!unresolved) expanded.push(resolved)
  }
  return expanded
}

/** Turn one path segment containing `*` / `?` into an anchored, case-insensitive RegExp. */
export function globSegmentToRegExp(segment) {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
}

/**
 * Expand single-segment `*` / `?` wildcards, one directory at a time.
 *
 * Deliberately non-recursive: the cost stays proportional to the number of wildcard
 * segments, so a catalog entry can never turn a scan into a disk crawl.
 */
export function expandGlob(absolutePath, fileExists = existsSync) {
  if (!absolutePath.includes('*') && !absolutePath.includes('?')) {
    return fileExists(absolutePath) ? [absolutePath] : []
  }
  const root = path.parse(absolutePath).root
  if (!root) return []
  const segments = absolutePath.slice(root.length).split(/[\\/]+/).filter(Boolean)
  let current = [root]
  for (const segment of segments) {
    const next = []
    for (const base of current) {
      if (!segment.includes('*') && !segment.includes('?')) {
        next.push(path.join(base, segment))
        continue
      }
      let entries
      try {
        entries = readdirSync(base, { withFileTypes: true })
      } catch {
        continue
      }
      const re = globSegmentToRegExp(segment)
      for (const entry of entries) if (re.test(entry.name)) next.push(path.join(base, entry.name))
    }
    current = next
    if (!current.length) break
  }
  return current.filter((candidate) => fileExists(candidate))
}
