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
 */
export function configuredRoots(env = process.env) {
  const raw = env.DSH_DEV_ENV_ROOTS ?? env.dsh_dev_env_roots
  if (!raw) return []
  return String(raw)
    .split(';')
    .map((entry) => entry.trim().replace(/[\\/]+$/, ''))
    .filter(Boolean)
}

/**
 * Pseudo-variables that stand for more than one path.
 * `%DRIVES%` covers the usual install drives; `%DSH_DEV_ENV_ROOTS%` is user configured.
 */
const MULTI_VALUE_VARS = [
  ['DRIVES', (env, fileExists) => availableDrives(fileExists)],
  ['DSH_DEV_ENV_ROOTS', (env) => configuredRoots(env)],
]

function expandMultiValue(text, env, fileExists, depth = 0) {
  if (depth > 3) return []
  for (const [name, produce] of MULTI_VALUE_VARS) {
    const re = new RegExp(`%${name}%`, 'i')
    if (!re.test(text)) continue
    const variants = []
    for (const value of produce(env, fileExists)) {
      variants.push(...expandMultiValue(text.replace(re, () => value), env, fileExists, depth + 1))
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
 */
export function expandEnv(input, env = process.env, fileExists = existsSync) {
  if (typeof input !== 'string' || !input.trim()) return []
  let text = input.trim()
  if (text === '~' || text.startsWith('~\\') || text.startsWith('~/')) text = os.homedir() + text.slice(1)

  const expanded = []
  for (const variant of expandMultiValue(text, env, fileExists)) {
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
