#!/usr/bin/env node
/**
 * Self-check for the plugin, runnable anywhere with plain Node (no dependencies, no
 * spawning):  `npm test`
 *
 * It guards the two things that are easy to get wrong when adding catalog entries:
 *   1. every entry is well formed and its regexes compile;
 *   2. the catalog stays machine independent — no absolute path without `%ENV%` / `~`.
 *
 * It also unit-tests the path resolver, and cross-checks package.json against the
 * bundle patch and the client entry.
 */

import { mkdirSync, statSync } from 'node:fs'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CATALOG, CATEGORIES } from '../catalog.js'
import { DESCRIPTIONS } from '../describe.js'
import {
  createSpeedMeter,
  compareVersions,
  filesInListing,
  metaPathFor,
  partPathFor,
  resolveDownload,
  startDownload,
} from '../downloads.js'
import {
  availableDrives,
  expandEnv,
  expandGlob,
  globSegmentToRegExp,
  loadStoredRoots,
  mentionsRoots,
  mergeRootList,
  parentDirStartingPoint,
  rootsFile,
} from '../paths.js'
import { describeProbeHint } from '../roots.js'
import { __test } from '../index.js'
import { runClientCancelTests } from './client-cancel.test.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROBE_KINDS = new Set(['argv', 'versionFile', 'pathList', 'dir', 'pip', 'npmGlobal', 'registry'])
const INSTALL_TARGETS = ['winget', 'npm', 'pip', 'page']

let failures = 0
let warnings = 0

function check(name, fn) {
  try {
    const result = fn()
    if (result === false) {
      failures += 1
      console.error(`  FAIL  ${name}`)
    } else {
      console.log(`  ok    ${name}`)
    }
  } catch (error) {
    failures += 1
    console.error(`  FAIL  ${name}\n        ${error && error.message ? error.message : error}`)
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

/**
 * Run the whole self-check in a known environment.
 *
 * `DSH_DEV_ENV_ROOTS` is a documented user setting — it is how someone points the scanner at a tool
 * they unzipped themselves — and `expandEnv` merges it with the roots a caller passes. That merge is
 * the feature. It also means a check that expands `%DSH_DEV_ENV_ROOTS%` sees whatever the person
 * running `npm test` happens to have set, so the same commit passes on one machine and fails on
 * another. It did: a real `DSH_DEV_ENV_ROOTS` on one machine made a picked-folder guard resolve the
 * machine's own JMeter instead of the temp folder the guard had just created.
 *
 * Removing the variables here (they are restored at the end) is what makes "the same code gives the
 * same answer" true for this suite, and it is also the honest thing to assert against: a self-check
 * must not depend on the machine it runs on.
 */
const SANITIZED = ['DSH_DEV_ENV_ROOTS', 'DSH_DEV_ENV_ROOTS_FILE']
const savedEnv = new Map(SANITIZED.map((name) => [name, process.env[name]]))
for (const name of SANITIZED) delete process.env[name]

/** Put the environment back exactly as it was, so sourcing this file has no side effects. */
function restoreEnvironment() {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

/** One turn of the event loop, for the few checks that have to wait on real file/stream work. */
const drainOnce = () => new Promise((resolve) => setImmediate(resolve))

console.log(`\ndsh-dev-env self-check  (node ${process.version}, ${process.platform})\n`)

// ------------------------------------------------------------------ catalog shape
console.log('catalog')

check('entry ids are unique and slug-shaped', () => {
  const seen = new Set()
  for (const entry of CATALOG) {
    assert(typeof entry.id === 'string' && /^[a-z][a-z0-9-]*$/.test(entry.id), `bad id: ${JSON.stringify(entry.id)}`)
    assert(!seen.has(entry.id), `duplicate id: ${entry.id}`)
    seen.add(entry.id)
  }
})

check('every entry with a non-Latin name ships an English counterpart', () => {
  // The panel switches between Chinese and English, so a name that is not readable in the
  // English view has to carry a `nameEn`. This keeps the catalog honest as it grows.
  const cjk = /[\u3400-\u9FFF\uF900-\uFAFF]/
  const missing = CATALOG.filter((entry) => cjk.test(entry.name) && !entry.nameEn).map((entry) => entry.id)
  assert(missing.length === 0, `add nameEn for: ${missing.join(', ')}`)
  const empty = CATALOG.filter((entry) => entry.nameEn !== undefined && !String(entry.nameEn).trim()).map((entry) => entry.id)
  assert(empty.length === 0, `nameEn must not be empty: ${empty.join(', ')}`)
})

check('categories carry both display languages', () => {
  for (const category of CATEGORIES) {
    assert(typeof category.name === 'string' && category.name, `${category.id}: missing name`)
    assert(typeof category.nameEn === 'string' && category.nameEn, `${category.id}: missing nameEn`)
  }
})

check('every entry has a name and a known category', () => {
  const known = new Set(CATEGORIES.map((category) => category.id))
  for (const entry of CATALOG) {
    assert(typeof entry.name === 'string' && entry.name.length > 0, `${entry.id}: missing name`)
    assert(known.has(entry.category), `${entry.id}: unknown category ${entry.category}`)
  }
})

check('every entry declares a known probe kind', () => {
  for (const entry of CATALOG) {
    assert(entry.probe && typeof entry.probe === 'object', `${entry.id}: missing probe`)
    assert(PROBE_KINDS.has(entry.probe.kind), `${entry.id}: unknown probe kind ${entry.probe.kind}`)
  }
})

check('probes carry the fields their kind requires', () => {
  for (const { id, probe } of CATALOG.map((entry) => ({ id: entry.id, probe: entry.probe }))) {
    if (probe.kind === 'argv') {
      assert(Array.isArray(probe.argv) && probe.argv.length > 0, `${id}: argv must be a non-empty array`)
    }
    if (probe.kind === 'versionFile' || probe.kind === 'dir') {
      assert(typeof probe.path === 'string' && probe.path, `${id}: ${probe.kind}.path is required`)
    }
    if (probe.kind === 'pathList') {
      assert(Array.isArray(probe.paths) && probe.paths.length > 0, `${id}: pathList.paths must be non-empty`)
      for (const candidate of probe.paths) assert(typeof candidate === 'string' && candidate, `${id}: bad candidate`)
      if (probe.requires !== undefined) {
        assert(Array.isArray(probe.requires) && probe.requires.length > 0,
          `${id}: pathList.requires must be a non-empty array when present`)
        for (const relative of probe.requires) {
          assert(typeof relative === 'string' && relative, `${id}: pathList.requires entries must be non-empty strings`)
          assert(!/^([A-Za-z]:|[\\/])/.test(relative), `${id}: pathList.requires entries are relative to the match`)
        }
      }
    }
    if (probe.kind === 'pip') assert(typeof probe.module === 'string' && probe.module, `${id}: pip.module required`)
    if (probe.kind === 'npmGlobal') assert(typeof probe.name === 'string' && probe.name, `${id}: npmGlobal.name required`)
    if (probe.kind === 'registry') assert(typeof probe.match === 'string' && probe.match, `${id}: registry.match required`)
  }
})

check('every regex in the catalog compiles', () => {
  for (const entry of CATALOG) {
    if (entry.probe.pattern) new RegExp(entry.probe.pattern)
    if (entry.probe.kind === 'registry') new RegExp(entry.probe.match, 'i')
  }
})

check('every entry has at least one install strategy', () => {
  for (const entry of CATALOG) {
    const install = entry.install || {}
    assert(INSTALL_TARGETS.some((key) => typeof install[key] === 'string' && install[key]),
      `${entry.id}: needs one of ${INSTALL_TARGETS.join(' / ')}`)
  }
})

// ---------------------------------------------------------------- descriptions
console.log('\ndescriptions')

check('every catalog entry has a description in both languages', () => {
  for (const entry of CATALOG) {
    const text = DESCRIPTIONS[entry.id]
    assert(text, `${entry.id}: no description (add one to describe.js)`)
    assert(typeof text.zh === 'string' && text.zh.trim(), `${entry.id}: missing zh`)
    assert(typeof text.en === 'string' && text.en.trim(), `${entry.id}: missing en`)
  }
})

check('descriptions stay short enough for one row', () => {
  // The panel renders these on a single ellipsised line under each row.
  for (const [id, text] of Object.entries(DESCRIPTIONS)) {
    assert([...text.zh].length <= 30, `${id}: zh is ${[...text.zh].length} chars, cap is 30`)
    assert(text.en.length <= 64, `${id}: en is ${text.en.length} chars, cap is 64`)
  }
})

check('describe.js has no orphan or unsafe entries', () => {
  const ids = new Set(CATALOG.map((entry) => entry.id))
  for (const id of Object.keys(DESCRIPTIONS)) {
    assert(ids.has(id), `describe.js describes "${id}", which is not in the catalog`)
  }
  // These strings are pasted into single-quoted literals, so a quote or backslash would either
  // break the module or need escaping that a future edit is likely to get wrong.
  for (const [id, text] of Object.entries(DESCRIPTIONS)) {
    for (const [lang, value] of [['zh', text.zh], ['en', text.en]]) {
      assert(!value.includes('"'), `${id} (${lang}): use no ASCII double quote`)
      assert(!value.includes('\\'), `${id} (${lang}): use no backslash`)
      assert(!/[.。]$/.test(value), `${id} (${lang}): drop the trailing full stop`)
    }
  }
})

// ------------------------------------------------------- machine independence
console.log('\nmachine independence')

check('no catalog path hardcodes a drive letter or a user profile', () => {
  const offenders = []
  const walk = (value, where) => {
    if (typeof value === 'string') {
      // A path is portable when it goes through %ENV% (including the %DRIVES% pseudo-variable) or ~.
      if (/^[A-Za-z]:[\\/]/.test(value) && !value.includes('%')) offenders.push(`${where}: ${value}`)
      if (/\\Users\\[^\\%]/i.test(value)) offenders.push(`${where}: ${value}`)
      return
    }
    if (Array.isArray(value)) return value.forEach((item) => walk(item, where))
    if (value && typeof value === 'object') return Object.values(value).forEach((item) => walk(item, where))
  }
  for (const entry of CATALOG) walk(entry.probe, entry.id)
  assert(offenders.length === 0, `use %ENV% / %DRIVES% / ~ / the registry instead of:\n        ${offenders.join('\n        ')}`)
})

check('pathList candidates that cannot be resolved are skipped, not guessed', () => {
  // An unset variable must yield no candidates at all.
  assert(expandEnv('%DSH_DEV_ENV_DEFINITELY_UNSET%\\x').length === 0, 'unset variable produced a candidate')
})

// ------------------------------------------------------------------ resolver
console.log('\npath resolver')

check('expandEnv expands a set variable', () => {
  const [value] = expandEnv('%DSH_TEST_ROOT%\\bin', { DSH_TEST_ROOT: 'C:\\tools' })
  assert(value === 'C:\\tools\\bin', `got ${value}`)
})

check('expandEnv is case-insensitive', () => {
  const [value] = expandEnv('%dsh_test_root%\\bin', { DSH_TEST_ROOT: 'C:\\tools' })
  assert(value === 'C:\\tools\\bin', `got ${value}`)
})

check('expandEnv resolves ~ to the home directory', () => {
  const [value] = expandEnv('~\\appdata')
  assert(value === path.join(os.homedir(), 'appdata'), `got ${value}`)
})

check('expandEnv drops candidates with an unset variable', () => {
  assert(expandEnv('%NOPE_NOT_SET%\\x').length === 0, 'expected []')
})

check('%DRIVES% expands to the system drive, then the data drives that exist', () => {
  const system = (process.env.SystemDrive || 'C:').replace(/[\\/]+$/, '')
  // Strict probe: only the system drive counts as existing, so exactly one candidate is right on any
  // machine — a single-drive box included.
  const [first, ...rest] = expandEnv('%DRIVES%\\x', {}, () => false)
  assert(first === `${system}\\x`, `expected the system drive first, got ${first}`)
  assert(rest.length === 0, `a strict probe should yield one drive, got ${JSON.stringify(rest)}`)

  // Permissive probe: the candidate count must match the drive list the resolver itself reports,
  // rather than assuming this machine has a D:. Asserting ">= 2" passes on a two-drive developer box
  // and fails on a single-drive CI runner — the machine deciding the result instead of the code.
  const many = expandEnv('%DRIVES%\\x', {}, () => true)
  assert(many.length === availableDrives(() => true).length,
    `expected ${availableDrives(() => true).length} drives, got ${many.length}`)
  assert(many[0] === `${system}\\x`, `the system drive must still come first, got ${many[0]}`)
  assert(many.every((candidate) => /^[A-Z]:\\x$/.test(candidate)), `bad candidates: ${many.join(', ')}`)
})

check('%DRIVES% works inside a longer path', () => {
  const [value] = expandEnv('%DRIVES%\\HarmonyOS\\DevEco Studio', {}, () => false)
  const system = (process.env.SystemDrive || 'C:').replace(/[\\/]+$/, '')
  assert(value === `${system}\\HarmonyOS\\DevEco Studio`, `got ${value}`)
})

check('%DSH_DEV_ENV_ROOTS% expands to the configured roots', () => {
  // `[]` for the stored roots keeps this hermetic: without it, the expansion would merge whatever
  // the machine running the test happens to have picked in the panel.
  const values = expandEnv('%DSH_DEV_ENV_ROOTS%\\apache-jmeter-*', {
    DSH_DEV_ENV_ROOTS: 'D:\\Java\\tools; E:\\extra\\;',
  }, undefined, [])
  assert(values.length === 2, `expected 2 roots, got ${values.length}: ${values.join(', ')}`)
  assert(values[0] === 'D:\\Java\\tools\\apache-jmeter-*', `got ${values[0]}`)
  assert(values[1] === 'E:\\extra\\apache-jmeter-*', `trailing separator not trimmed: ${values[1]}`)
})

check('%DSH_DEV_ENV_ROOTS% contributes nothing when unset', () => {
  assert(expandEnv('%DSH_DEV_ENV_ROOTS%\\x', {}, undefined, []).length === 0, 'expected []')
})

check('a picked folder joins the environment roots and is deduplicated', () => {
  // This is the whole point of the picker: the folder the user chose has to reach the scan without
  // a DSH restart, and it must not duplicate a root the environment already provides.
  const values = expandEnv('%DSH_DEV_ENV_ROOTS%\\apache-jmeter-*', {
    DSH_DEV_ENV_ROOTS: 'D:\\Java\\tools',
  }, undefined, ['e:\\picked\\jmeter', 'D:\\JAVA\\TOOLS\\'])
  assert(values.length === 2, `expected 2 roots, got ${values.length}: ${values.join(', ')}`)
  assert(values[0] === 'D:\\Java\\tools\\apache-jmeter-*', `the environment root should come first, got ${values[0]}`)
  assert(values[1] === 'e:\\picked\\jmeter\\apache-jmeter-*', `the picked root should be appended, got ${values[1]}`)
})

check('a picked folder works with no environment variable at all', () => {
  const values = expandEnv('%DSH_DEV_ENV_ROOTS%\\apache-jmeter-*', {}, undefined, ['D:\\Java\\测试工具'])
  assert(values.length === 1, `expected 1 root, got ${values.length}: ${values.join(', ')}`)
  assert(values[0] === 'D:\\Java\\测试工具\\apache-jmeter-*', `got ${values[0]}`)
})

check('only an input that mentions the roots variable touches the store', () => {
  // The store is read lazily, on the inputs that can use it. Otherwise every catalog entry would
  // pull the user's roots file into a scan that cannot possibly need it.
  const values = expandEnv('%JAVA_HOME%\\bin', { JAVA_HOME: 'D:\\Java' }, undefined, ['D:\\picked'])
  assert(values.length === 1 && values[0] === 'D:\\Java\\bin', `got ${values.join(', ')}`)
})

check('rootsFile honours the override, then the profile, then DSH_HOME', () => {
  assert(rootsFile({ DSH_DEV_ENV_ROOTS_FILE: 'E:\\custom\\roots.json', DSH_PROFILE_DIR: 'C:\\p' }) === 'E:\\custom\\roots.json',
    'an explicit override must win')
  assert(rootsFile({ DSH_PROFILE_DIR: 'C:\\p' }) === path.join('C:\\p', 'dsh-dev-env', 'roots.json'),
    'the store belongs to the profile, not to the plugin folder')
  assert(rootsFile({ DSH_HOME: 'C:\\home' }) === path.join('C:\\home', 'profiles', 'default', 'dsh-dev-env', 'roots.json'),
    'DSH_HOME is the fallback')
  assert(rootsFile({}) === null, 'no base directory means no store rather than a relative path')
})

check('the stored roots file degrades to empty instead of throwing', () => {
  assert(loadStoredRoots(null).length === 0, 'no path is not an error')
  assert(loadStoredRoots(path.join(ROOT, 'definitely-not-here.json')).length === 0, 'a missing file is not an error')
  // A corrupt file must not take the whole scan down with it.
  const corrupt = path.join(os.tmpdir(), `dsh-dev-env-roots-${process.pid}.json`)
  writeFileSync(corrupt, '{ this is not json', 'utf8')
  try {
    assert(loadStoredRoots(corrupt).length === 0, 'corrupt JSON should degrade to []')
    writeFileSync(corrupt, JSON.stringify({ roots: ['D:\\Java', '', null, 7, 'E:\\sdk'] }), 'utf8')
    const list = loadStoredRoots(corrupt)
    assert(list.length === 2, `expected the two usable roots, got ${JSON.stringify(list)}`)
  } finally {
    rmSync(corrupt, { force: true })
  }
})

check('mergeRootList deduplicates case-insensitively and keeps the first spelling', () => {
  const merged = mergeRootList(['D:\\Java\\tools'], ['d:\\java\\tools\\', 'E:\\picked', 'E:\\picked\\'])
  assert(merged.length === 2, `got ${JSON.stringify(merged)}`)
  assert(merged[0] === 'D:\\Java\\tools', `first spelling should win, got ${merged[0]}`)
  assert(merged[1] === 'E:\\picked', `got ${merged[1]}`)
})

check('globSegmentToRegExp anchors and is case-insensitive', () => {
  const re = globSegmentToRegExp('apache-jmeter-*')
  assert(re.test('apache-jmeter-5.6.3'), 'should match')
  assert(re.test('APACHE-JMETER-5.6.3'), 'should match case-insensitively')
  assert(!re.test('apache-jmeter'), 'should not match without the dash')
  assert(!re.test('xapache-jmeter-1'), 'must be anchored')
})

check('globSegmentToRegExp escapes regex metacharacters', () => {
  const re = globSegmentToRegExp('a.b+c')
  assert(re.test('a.b+c'), 'literal dot and plus should match')
  assert(!re.test('axbbc'), 'metacharacters must not act as wildcards')
})

if (process.platform === 'win32') {
  check('expandGlob expands one wildcard segment against a real directory', () => {
    const matches = expandGlob(path.join(ROOT, '*.js'))
    const names = matches.map((match) => path.basename(match))
    for (const expected of ['catalog.js', 'client.js', 'index.js', 'paths.js']) {
      assert(names.includes(expected), `missing ${expected} in ${names.join(', ')}`)
    }
  })

  check('expandGlob returns [] for a non-matching wildcard', () => {
    assert(expandGlob(path.join(ROOT, 'definitely-not-here-*')).length === 0, 'expected []')
  })
}

check('expandGlob honours an injected existence check for literal paths', () => {
  const probe = (candidate) => candidate === 'C:\\fake\\present'
  assert(expandGlob('C:\\fake\\present', probe).length === 1, 'literal present path')
  assert(expandGlob('C:\\fake\\absent', probe).length === 0, 'literal absent path')
})

// ------------------------------------------------------------------ picked folders
console.log('\npicked folders')

/**
 * A picked folder that makes a real probe match.
 *
 * This is the automated form of the defect found by hand while wiring the picker: `roots.js` told the
 * user to choose the tool's own directory, while the catalog's candidate is
 * `<root>\<tool-folder-pattern>` — so the advertised pick expanded to
 * `…\apache-jmeter-5.6.3\apache-jmeter-*`, which exists nowhere, and the feature silently did
 * nothing. These checks build a throwaway JMeter-shaped folder and assert both pick levels work.
 *
 * The probe here is **written out in full rather than taken from the catalog**, and the catalog is
 * checked separately for continuing to declare the same candidate. That split is deliberate:
 * `probeItem` walks every candidate in order, so a probe carrying the real entry's other candidates
 * lets this machine's own JMeter satisfy the scan before the picker's candidate is ever reached —
 * the guard then measures the machine. That happened once, and the fix at the time (narrowing the
 * entry's candidates) still left the guard's behaviour dependent on a catalog entry. Spelling the
 * probe out removes that dependence entirely.
 */
check('a picked root makes the scan find the tool, whichever level was picked', async () => {
  const base = path.join(os.tmpdir(), `dsh-dev-env-pick-${process.pid}`)
  const toolDir = path.join(base, 'apache-jmeter-9.9.9')
  mkdirSync(toolDir, { recursive: true })
  try {
    // The shape under test, self-contained: one candidate, reached only through a picked root.
    const candidate = '%DSH_DEV_ENV_ROOTS%\\apache-jmeter-*'
    const probe = { kind: 'pathList', pattern: 'apache-jmeter-([\\d.]+)', paths: [candidate] }
    const pit = { id: 'fixture-jmeter', name: 'Fixture JMeter', probe }
    const state = { roots: [] }

    // The catalog must still declare that candidate, or this guard would be testing a shape that no
    // longer ships — that is what the `picked folders` section's first check is for.
    const entry = CATALOG.find((row) => row.id === 'jmeter')
    assert(entry, 'the catalog needs a jmeter entry for this guard')
    assert(entry.probe.paths.some((value) => mentionsRoots(value)),
      'the jmeter entry must still offer a %DSH_DEV_ENV_ROOTS% candidate for the picker to use')

    for (const picked of [toolDir, base]) {
      // Expansion #1: the user's root is substituted in.
      const expanded = expandEnv(candidate, { DSH_DEV_ENV_ROOTS: picked }, undefined, [picked])
      assert(expanded.length === 1, `one candidate expected for ${picked}, got ${JSON.stringify(expanded)}`)
      // Expansion #2: the last segment is a wildcard, expanded against the real filesystem.
      const starts = [expanded[0]]
      const parent = parentDirStartingPoint(expanded[0], probe)
      if (parent) starts.push(parent)
      const matches = starts.flatMap((start) => expandGlob(start))
      assert(matches.includes(toolDir),
        `picking ${path.basename(picked)} should reach ${toolDir}, got ${JSON.stringify(matches)}`)

      // And the scanner's own probe must agree, through the same code path a scan uses.
      const result = await __test.probeItem(pit, state, { roots: [picked] })
      assert(result.installed === true, `probe should report installed for ${picked}, got ${JSON.stringify(result)}`)
      assert(result.version === '9.9.9',
        `version should come from the folder name, got ${result.version}; where=${result.where}; ` +
          `candidates=${JSON.stringify(probe.paths)}; picked=${picked}`)
      assert(result.where === toolDir, `where should be the tool dir, got ${result.where}`)
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

check('a picked folder reports the specific condition it failed, not just "not found"', async () => {
  const base = path.join(os.tmpdir(), `dsh-dev-env-miss-${process.pid}`)
  const toolDir = path.join(base, 'apache-jmeter-9.9.9')
  mkdirSync(path.join(toolDir, 'bin'), { recursive: true })
  try {
    const entry = CATALOG.find((row) => row.id === 'jmeter')
    const matched = __test.probeAtDir(entry.probe, toolDir)
    assert(matched.ok === true, `expected a match, got ${JSON.stringify(matched)}`)
    assert(matched.version === '9.9.9', `got version ${matched.version}`)

    // A folder whose name does not match the pattern is the interesting failure: the message has to
    // name the pattern, because "pick the tool's own folder" is not actionable on its own.
    const wrongName = path.join(base, 'apache-jmeter')
    mkdirSync(wrongName, { recursive: true })
    const bad = __test.probeAtDir(entry.probe, wrongName)
    assert(bad.ok === false, 'a folder that does not match the pattern must not count')
    assert(bad.missing.some((text) => text.includes('apache-jmeter-([\\d.]+)')),
      `the failure should name the pattern, got ${JSON.stringify(bad.missing)}`)

    // The hint is what the panel shows before the user even picks; it must not contradict the rule.
    const hint = describeProbeHint(entry)
    assert(typeof hint === 'string' && hint.includes('上一级'),
      `the hint should say both levels work, got ${JSON.stringify(hint)}`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

check('a tool that needs a file inside the folder rejects the folder above it', async () => {
  // `probeAtDir` is what the panel's receipt says, so its negative path has to be trustworthy too.
  const base = path.join(os.tmpdir(), `dsh-dev-env-file-${process.pid}`)
  const toolDir = path.join(base, 'tool-1.2.3')
  mkdirSync(path.join(toolDir, 'bin'), { recursive: true })
  writeFileSync(path.join(toolDir, 'release'), 'JAVA_VERSION="1.2.3"', 'utf8')
  try {
    const probe = { kind: 'pathList', file: 'release', pattern: 'JAVA_VERSION="([^"]+)"', requires: ['bin'] }
    const good = __test.probeAtDir(probe, toolDir)
    assert(good.ok === true, `expected a match, got ${JSON.stringify(good)}`)
    assert(good.version === '1.2.3', `got version ${good.version}`)

    const above = __test.probeAtDir(probe, base)
    assert(above.ok === false, 'the parent of a tool folder must not count as the tool')
    assert(above.missing.some((text) => text.includes('release')), `got ${JSON.stringify(above.missing)}`)
    assert(above.missing.some((text) => text.includes('bin')), `got ${JSON.stringify(above.missing)}`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

check('a tool folder that carries a version file needs the level above it to be tried', async () => {
  // This is the case `parentDirStartingPoint()` exists for, and the one a naive "just append the
  // catalog's pattern to the picked root" implementation cannot handle: the catalog writes
  // `<root>\tool-<version>`, so picking `tool-1.2.3` itself yields `…\tool-1.2.3\tool-1.2.3`, which
  // exists nowhere. With a `file` probe there is no folder-name fallback to save it — the pick would
  // silently do nothing. Verified here without any catalog entry, so it cannot rot with the catalog.
  const base = path.join(os.tmpdir(), `dsh-dev-env-level-${process.pid}`)
  const toolDir = path.join(base, 'tool-1.2.3')
  mkdirSync(toolDir, { recursive: true })
  writeFileSync(path.join(toolDir, 'release'), 'JAVA_VERSION="1.2.3"', 'utf8')
  try {
    // A probe with a `file`: there is no folder-name fallback to save a wrong-level pick, which is
    // exactly why the level above has to be tried.
    const entry = {
      id: 'fixture-tool',
      name: 'Fixture Tool',
      probe: { kind: 'pathList', file: 'release', pattern: 'JAVA_VERSION="([^"]+)"', paths: ['%DSH_DEV_ENV_ROOTS%\\tool-*'] },
    }

    // Picking the tool's own folder: the candidate expands to a path that cannot exist …
    const naive = expandEnv(entry.probe.paths[0], {}, undefined, [toolDir])
    assert(naive[0] === path.join(toolDir, 'tool-*'),
      `the naive expansion is the defect: got ${naive[0]}`)
    assert(expandGlob(naive[0]).length === 0, 'the naively-appended path must not exist')

    // … and the real probe must still find the tool, because it also tries the level above.
    const fromToolFolder = await __test.probeItem(entry, {}, { roots: [toolDir] })
    assert(fromToolFolder.installed === true,
      `picking the tool folder must work, got ${JSON.stringify(fromToolFolder)}`)
    assert(fromToolFolder.version === '1.2.3', `got version ${fromToolFolder.version}`)
    // With a `file` probe, `where` is the file the version was read out of.
    assert(fromToolFolder.where === path.join(toolDir, 'release'), `got ${fromToolFolder.where}`)

    // Picking the parent must work too: that is the same expansion without the extra level.
    const fromParent = await __test.probeItem(entry, {}, { roots: [base] })
    assert(fromParent.installed === true, `picking the parent must work, got ${JSON.stringify(fromParent)}`)
    assert(fromParent.where === path.join(toolDir, 'release'), `got ${fromParent.where}`)

    // A literal last segment is never "a tool folder", so a level is never invented above it.
    const literal = expandEnv('%DSH_DEV_ENV_ROOTS%\\tools', {}, undefined, ['C:\\Tools'])
    assert(parentDirStartingPoint(literal[0], entry.probe) === null,
      `a literal last segment has no level above to try, got ${parentDirStartingPoint(literal[0], entry.probe)}`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------ download sources
console.log('\ndownload sources')

const JMETER_SOURCE = CATALOG.find((entry) => entry.id === 'jmeter')?.install?.download

check('the jmeter download source points at a listing, not a pinned file', () => {
  // A pinned URL carries the version (`…/apache-jmeter-5.6.3.zip`) and rots at the next release,
  // silently: a 404 is indistinguishable from an unreachable network until someone asks.
  assert(JMETER_SOURCE, 'the jmeter entry should declare install.download')
  const sources = Array.isArray(JMETER_SOURCE.sources) ? JMETER_SOURCE.sources : [JMETER_SOURCE]
  for (const source of sources) {
    assert(typeof source.listing === 'string' && !source.listing.includes('apache-jmeter-'),
      `expected a directory listing, got ${source.listing}`)
    assert(!source.direct, 'the current release must not be pinned')
    assert(typeof source.fileNamePattern === 'string' && source.fileNamePattern,
      'a listing needs fileNamePattern to pick the archive out of it')
    new RegExp(source.fileNamePattern) // must compile
  }
  // The default (first) source must carry the fallback: mirrors stand in for each other, but a mirror
  // cannot stand in for "the official listing has moved".
  assert(sources[0].fallback?.listing, 'the default source needs a fallback listing')
  // Named sources are what the picker offers, so the names and labels have to be usable.
  const names = sources.map((source) => source.name)
  assert(names.every((name) => typeof name === 'string' && name), `every source needs a name: ${JSON.stringify(names)}`)
  assert(new Set(names).size === names.length, `source names must be unique: ${JSON.stringify(names)}`)
  assert(sources.every((source) => typeof source.label === 'string' && source.label),
    'every source needs a label — the picker shows the label, not the name')
})

check('compareVersions orders numerically, not as text', () => {
  // Text order would pick 5.9 over 5.10 and quietly install an older release.
  assert(compareVersions('5.10', '5.9') > 0, '5.10 is newer than 5.9')
  assert(compareVersions('5.6.3', '5.6.2') > 0, 'patch bump')
  assert(compareVersions('5.6.3', '5.6.3') === 0, 'equal')
  assert(compareVersions('11.0.2', '9.9.9') > 0, 'major bump')
})

check('filesInListing resolves hrefs and ignores everything else', () => {
  const html = `
    <a href="apache-jmeter-5.6.3.zip">zip</a>
    <a href="apache-jmeter-5.6.3.tgz">tgz</a>
    <a href="apache-jmeter-5.6.3.zip.sha512">checksum</a>
    <a href="../">up</a>
    <a href="https://elsewhere.example/absolute.zip">absolute</a>`
  const files = filesInListing(html, 'https://dlcdn.apache.org/jmeter/binaries/')
  assert(files.includes('https://dlcdn.apache.org/jmeter/binaries/apache-jmeter-5.6.3.zip'), `got ${JSON.stringify(files)}`)
  assert(files.includes('https://elsewhere.example/absolute.zip'), 'absolute hrefs must survive')
  assert(!files.some((url) => url.endsWith('.sha512')), 'checksums are not archives')
  assert(files.length === 3, `expected 3 archives, got ${JSON.stringify(files)}`)
})

check('resolveDownload picks the newest archive a listing offers, and verifies it', async () => {
  // No network: the fetch double answers the listing and the probe, so this guard is hermetic.
  const listingUrl = 'https://mirror.example/tool/binaries/'
  const listing = `
    <a href="tool-5.9.zip">old</a>
    <a href="tool-5.10.zip">new</a>
    <a href="tool-5.2.zip">older</a>
    <a href="tool-5.10.zip.sha512">checksum</a>`
  const probed = []
  const fetchImpl = async (url) => {
    if (url === listingUrl) return { ok: true, status: 200, text: async () => listing }
    return { ok: true, status: 500, text: async () => '' }
  }
  const probe = async (url) => {
    probed.push(url)
    return url.endsWith('tool-5.10.zip') ? { status: 200, total: 1234, etag: '"abc"', lastModified: null } : { status: 404, total: null }
  }
  const resolved = await resolveDownload({ listing: listingUrl, fileNamePattern: '^tool-([\\d.]+)\\.zip$' }, { fetchImpl, probe })
  assert(resolved, 'expected a resolution')
  assert(resolved.url === `${listingUrl}tool-5.10.zip`, `picked ${resolved.url}`)
  assert(resolved.version === '5.10', `version came out as ${resolved.version}`)
  assert(resolved.total === 1234, `size came out as ${resolved.total}`)
  assert(probed[0] === `${listingUrl}tool-5.10.zip`, 'the newest candidate must be verified first')
})

check('resolveDownload falls back, and reports failure instead of guessing', async () => {
  const primary = 'https://primary.example/binaries/'
  const secondary = 'https://archive.example/dist/binaries/'
  const spec = {
    listing: primary,
    fileNamePattern: '^tool-([\\d.]+)\\.zip$',
    fallback: { listing: secondary, fileNamePattern: '^tool-([\\d.]+)\\.zip$' },
  }
  const fetchImpl = async (url) => {
    if (url === primary) return { ok: true, status: 200, text: async () => '<a href="tool-9.0.zip">x</a>' }
    return { ok: true, status: 200, text: async () => '<a href="tool-8.0.zip">x</a>' }
  }

  // Primary answers but its file 404s → the fallback must be tried.
  const fallbackProbe = async (url) => (url.startsWith(secondary) ? { status: 200, total: 10 } : { status: 404 })
  const fromFallback = await resolveDownload(spec, { fetchImpl, probe: fallbackProbe })
  assert(fromFallback?.url === `${secondary}tool-8.0.zip`, `got ${JSON.stringify(fromFallback)}`)

  // Nothing verifies → null, so the caller reports "nothing to download" rather than a URL that
  // would fail mid-transfer.
  const nothing = await resolveDownload(spec, { fetchImpl, probe: async () => null })
  assert(nothing === null, `expected null, got ${JSON.stringify(nothing)}`)

  // An unreachable listing must not throw either.
  const offline = await resolveDownload(spec, {
    fetchImpl: async () => {
      throw new Error('fetch failed')
    },
    probe: async () => ({ status: 200, total: 1 }),
  })
  assert(offline === null, 'an unreachable listing must resolve to null')
})

check('a direct source needs no listing and is verified the same way', async () => {
  const url = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
  const resolved = await resolveDownload({ direct: url }, {
    fetchImpl: async () => {
      throw new Error('a direct source must not fetch a listing')
    },
    probe: async (probed) => (probed === url ? { status: 200, total: 7_700_000 } : { status: 404 }),
  })
  assert(resolved?.url === url, `got ${JSON.stringify(resolved)}`)
  assert(resolved.total === 7_700_000, 'the size must come through: it is what makes a speed and ETA possible')
})

check('a download reports monotonic progress, a rate and a finite ETA, then lands the file', async () => {
  // The engine's speed/ETA maths used to be covered only by synthetic samples. This drives a real
  // (if in-memory) transfer through startDownload: chunked, time-stamped, and then verified on disk.
  const CHUNK = 100_000
  const CHUNKS = 10
  const total = CHUNK * CHUNKS
  const dir = path.join(os.tmpdir(), `dsh-dev-env-dl-${process.pid}`)
  const file = path.join(dir, 'sample.bin')
  let tick = 0
  const clock = () => 1_700_000_000_000 + (tick += 200) // 200 ms between chunks
  const meter = createSpeedMeter({ windowMs: 8000 })
  // Feed the meter its own clock, so the rate is a real division of bytes by elapsed time.
  const originalSample = meter.sample.bind(meter)
  meter.sample = (received) => originalSample(received, clock())

  const stream = new ReadableStream({
    start(controller) {
      for (let index = 0; index < CHUNKS; index += 1) controller.enqueue(new Uint8Array(CHUNK))
      controller.close()
    },
  })
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(total) }),
    body: stream,
  })

  const snapshots = []
  try {
    const handle = startDownload({ url: 'https://example.test/sample.bin', file, total, fetchImpl, meter, onProgress: (s) => snapshots.push(s) })
    const result = await handle.promise

    assert(result.bytes === total, `downloaded ${result.bytes}, expected ${total}`)
    assert(existsSync(file) && statSync(file).size === total, 'the finished file should be on disk at full size')
    assert(!existsSync(partPathFor(file)) && !existsSync(metaPathFor(file)), 'no .part or metadata should survive success')

    assert(snapshots.length === CHUNKS, `expected ${CHUNKS} progress reports, got ${snapshots.length}`)
    for (let index = 1; index < snapshots.length; index += 1) {
      assert(snapshots[index].received >= snapshots[index - 1].received, 'progress must never go backwards')
    }
    const last = snapshots[snapshots.length - 1]
    assert(last.percent === 100, `the last report should be 100%, got ${last.percent}`)
    assert(last.total === total, `the total should be known, got ${last.total}`)

    // Rate and ETA are real numbers derived from the samples, not placeholders.
    const middle = snapshots[Math.floor(snapshots.length / 2)]
    assert(Number.isFinite(middle.liveBytesPerSecond) && middle.liveBytesPerSecond > 0,
      `a rate should be measurable, got ${middle.liveBytesPerSecond}`)
    assert(Number.isFinite(middle.etaSeconds) && middle.etaSeconds >= 0,
      `an ETA should be finite, got ${middle.etaSeconds}`)
    // 100 KB per 200 ms is 500 KB/s, so a half-finished transfer is a handful of seconds.
    assert(middle.expectedBytesPerSecond > 400_000 && middle.expectedBytesPerSecond < 600_000,
      `the rate should be about 500 KB/s, got ${middle.expectedBytesPerSecond}`)
    assert(middle.etaSeconds >= 1 && middle.etaSeconds <= 20, `a plausible ETA, got ${middle.etaSeconds}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

check('cancelling a download deletes the partial file and its metadata', async () => {
  // The promise the cancel button makes. Verified against a real transfer in tools/download-cancel-e2e.mjs;
  // this is the hermetic version, so a regression fails npm test rather than needing a network.
  const dir = path.join(os.tmpdir(), `dsh-dev-env-cancel-${process.pid}`)
  const file = path.join(dir, 'sample.bin')
  let pulled = 0
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1
      controller.enqueue(new Uint8Array(40_000))
    },
  })
  const handle = startDownload({
    url: 'https://example.test/sample.bin',
    file,
    total: 40_000_000,
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '40000000' }), body: stream }),
  })
  try {
    // Wait until bytes are actually on disk, so the cancel has something to clean up.
    for (let attempt = 0; attempt < 200 && !existsSync(partPathFor(file)); attempt += 1) await drainOnce()
    assert(existsSync(partPathFor(file)), 'the transfer should have created a .part file')
    handle.cancel()
    await handle.promise.catch(() => undefined)
    assert(!existsSync(partPathFor(file)), 'cancel must delete the .part file')
    assert(!existsSync(metaPathFor(file)), 'cancel must delete the metadata')
    assert(!existsSync(file), 'cancel must not leave a finished-looking file behind')
  } finally {
    handle.cancel()
    rmSync(dir, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------ uninstall
console.log('\nuninstall')

check('an MSI UninstallString that says /I is rewritten to /X', () => {
  // Microsoft's own convention is /X, but /I (install/repair) really does appear in UninstallString:
  // MySQL and SQL Server LocalDB on the development machine both had it. Running /I from an uninstall
  // button would repair or reinstall the product, which is worse than failing.
  const cases = [
    ['MsiExec.exe /I{17796717-E924-4198-BC42-BE20338FADA2}', 'MsiExec.exe /X{17796717-E924-4198-BC42-BE20338FADA2}'],
    ['MsiExec.exe /i {E5B3A478-C4C3-49E3-8384-A12D4B2008D4}', 'MsiExec.exe /X {E5B3A478-C4C3-49E3-8384-A12D4B2008D4}'],
    ['msiexec /I "C:\\pkg\\thing.msi"', 'msiexec /X "C:\\pkg\\thing.msi"'],
  ]
  for (const [input, expected] of cases) {
    const { command, adjusted } = __test.normaliseUninstallCommand(input)
    assert(command === expected, `expected ${expected}, got ${command}`)
    assert(adjusted, 'a rewrite must be reported, not applied silently')
  }
})

check('a normal uninstaller is passed through untouched', () => {
  // Only the /I case may be rewritten. Rewriting anything else would be guessing at an installer's
  // arguments, which is what this feature refuses to do everywhere else.
  for (const input of [
    'MsiExec.exe /X{17796717-E924-4198-BC42-BE20338FADA2}',
    '"C:\\Program Files\\Git\\unins000.exe" /SILENT',
    'D:\\android\\uninstall.exe',
    '"D:\\Tomcat\\Uninstall.exe" -ServiceName="Tomcat11"',
    '"C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\setup.exe" uninstall --installPath "D:\\C#"',
  ]) {
    const { command, adjusted } = __test.normaliseUninstallCommand(input)
    assert(command === input, `must not touch ${input}, got ${command}`)
    assert(adjusted === null, `must not report an adjustment for ${input}`)
  }
})

check('install-by-hand tools carry no uninstall route at all', () => {
  // These have no install record anywhere, so there is nothing honest to run. host returns null for
  // them and the panel renders no button; this pins that at the source, so a future catalog edit that
  // gives one of them a package-manager route is forced to revisit the uninstall rule too.
  for (const id of ['zentao', 'adb', 'junit', 'scoop', 'choco']) {
    const entry = CATALOG.find((row) => row.id === id)
    assert(entry, `${id} should be in the catalog`)
    const install = entry.install || {}
    assert(!install.winget && !install.npm && !install.pip,
      `${id} is expected to be install-by-hand; it now has a package-manager route, so revisit uninstall`)
    assert(entry.probe?.kind !== 'registry',
      `${id} unexpectedly probes the registry, which would give it an uninstall route`)
  }
})

// ------------------------------------------------------------------ asking DSH for help
console.log('\nasking DSH for help')

check('the help prompt carries what a diagnosis needs, and asks for a fix', () => {
  // A log that only shows up inside the panel leaves the user where they started. This prompt is the
  // hand-off, so it must contain the facts — and it must ask for a resolution rather than a list of
  // possibilities, because the person clicking it has a real failure in front of them.
  const job = {
    id: 'd3adbeef',
    itemId: 'jmeter',
    name: 'Apache JMeter',
    mode: 'download',
    label: '自己下载 Apache JMeter 的官方压缩包',
    status: 'failed',
    phase: 'download',
    error: '字节数不符：收到 12.3 MB，预期 86.4 MB',
    url: 'https://dlcdn.apache.org/jmeter/binaries/apache-jmeter-5.6.3.zip',
    receivedBytes: 12_900_000,
    totalBytes: 90_631_635,
    exitCode: null,
    note: '残片不可续传（ETag 已变化），已删除并重新下载',
    log: ['下载源：https://dlcdn.apache.org/jmeter/binaries/', '失败：字节数不符：收到 12.3 MB，预期 86.4 MB'],
  }
  const item = { id: 'jmeter', name: 'Apache JMeter', nameEn: 'Apache JMeter' }

  for (const [lang, needles] of [
    ['zh', ['Apache JMeter', 'jmeter', 'download', 'failed', '字节数不符', 'dlcdn.apache.org', '90631635', '下载源：', 'dev_env_job', '不要只罗列']],
    ['en', ['Apache JMeter', 'jmeter', 'failed', '字节数不符', 'dlcdn.apache.org', '90631635', 'dev_env_job', 'Do not just list']],
  ]) {
    const text = __test.jobHelpPrompt(job, item, lang)
    for (const needle of needles) {
      assert(text.includes(needle), `${lang} prompt is missing ${needle}`)
    }
    // Optional lines must not leave a blank line in the middle of the facts: a job with no exit code
    // used to render one between "transferred" and "note", which reads as a missing section.
    const factBlock = text.split(/\n\n/)[0]
    assert(!/\n\s*\n/.test(factBlock), `${lang} facts should be contiguous, got:\n${factBlock}`)
  }
})

// ------------------------------------------------------------------ winget availability
console.log('\nwinget availability')

check('a broken winget is not offered as a plan', () => {
  // On the development machine winget.exe is a 0-byte app-execution-alias stub (the Store never
  // installed DesktopAppInstaller): it runs, prints nothing, and exits 0x8A150001. Every winget plan
  // then fails and the user sees "one-click install did nothing", which reads as a broken plugin.
  const withWinget = { id: 'x', name: 'X', install: { winget: 'Vendor.Thing', page: 'https://example.test/' } }
  const downloadable = {
    id: 'tomcat11',
    name: 'Tomcat 11',
    install: { page: 'https://example.test/', download: { direct: 'https://example.test/a.zip' } },
  }

  const usable = __test.plansFor(withWinget, { wingetReady: true })
  assert(usable.some((plan) => plan.mode === 'winget'), 'a healthy winget should still be offered')

  const broken = __test.plansFor(withWinget, { wingetReady: false })
  assert(!broken.some((plan) => plan.mode === 'winget'),
    `a broken winget must not be offered, got ${JSON.stringify(broken.map((p) => p.mode))}`)
  assert(broken.some((plan) => plan.mode === 'page'), 'the download page should remain the honest option')

  const both = __test.plansFor(downloadable, { wingetReady: false })
  assert(both.some((plan) => plan.mode === 'download'), 'our own download route must survive')
})

check('resolveDownload picks the newest version directory when a listing holds directories', async () => {
  // Apache lists Tomcat as version *directories* (`v11.0.26/`) with the zip inside `bin/`, which the
  // plain file-listing path cannot express. Pinning one version instead would rot at the next release.
  const listing = 'https://mirror.test/tomcat-11/'
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => `
      <a href="v11.0.9/">old</a>
      <a href="v11.0.26/">new</a>
      <a href="v11.0.5/">older</a>
      <a href="../">up</a>`,
  })
  const probed = []
  const probe = async (url) => {
    probed.push(url)
    return url.includes('v11.0.26') ? { status: 200, total: 15_032_303 } : { status: 404 }
  }
  const resolved = await resolveDownload(
    { listing, directoryPattern: '^v(11\\.[\\d.]+)/$', subPath: 'v{version}/bin/apache-tomcat-{version}.zip' },
    { fetchImpl, probe },
  )
  assert(resolved, 'expected a resolution')
  assert(resolved.url === `${listing}v11.0.26/bin/apache-tomcat-11.0.26.zip`, `got ${resolved.url}`)
  assert(resolved.version === '11.0.26', `version came out as ${resolved.version}`)
  assert(probed[0].includes('v11.0.26'), 'the newest directory must be verified first')
})

check('the shipped tomcat entries declare a resolvable download source', () => {
  // Their winget ids were wrong -- Apache's Tomcat package is unversioned, so Apache.Tomcat.11 does
  // not exist -- and with winget broken on this machine there was no working route at all. The
  // download source is now the route, so it must stay shaped like the one resolveDownload understands.
  for (const id of ['tomcat9', 'tomcat11']) {
    const entry = CATALOG.find((row) => row.id === id)
    assert(entry, `${id} should be in the catalog`)
    const download = entry.install?.download
    assert(download, `${id} should declare install.download`)
    const sources = Array.isArray(download.sources) ? download.sources : [download]
    assert(sources.length >= 1, `${id} needs at least one source`)
    for (const source of sources) {
      assert(typeof source.listing === 'string' && !/apache-tomcat-[\d.]+\.zip/.test(source.listing),
        `${id} must point at a listing, not a pinned archive (got ${source.listing})`)
      assert(source.directoryPattern && source.subPath, `${id} needs directoryPattern and subPath`)
      assert(source.subPath.includes('{version}'), `${id} subPath must use {version}, not a fixed one`)
      new RegExp(source.directoryPattern)
    }
    // The mirror list is what the picker offers, so each entry has to be nameable and labelable.
    if (Array.isArray(download.sources)) {
      assert(download.sources.every((source) => source.name && source.label),
        `${id} sources need both name and label`)
      const names = download.sources.map((source) => source.name)
      assert(new Set(names).size === names.length, `${id} source names must be unique`)
    }
    assert(!entry.install.winget,
      `${id} must not carry a winget id until one is verified — an unverified one reads as a route`)
  }
})

// ------------------------------------------------------------------ packaging
console.log('\npackage wiring')


const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

check('package.json is publishable', () => {
  assert(pkg.private !== true, 'private:true blocks npm publish')
  assert(typeof pkg.license === 'string' && pkg.license, 'license is required')
  assert(existsSync(path.join(ROOT, 'LICENSE')), 'LICENSE file is missing')
})

check('the version is valid semver and every place that records it agrees', () => {
  // npm uses semver: `npm publish` refuses a four-part version such as 1.0.0.0 with
  // "Invalid version". Catching it here means a release fails in CI, not at publish time.
  const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
  assert(SEMVER.test(pkg.version),
    `package.json version ${JSON.stringify(pkg.version)} is not semver (three numeric parts; npm rejects a fourth)`)

  const escaped = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  assert(new RegExp(`^## \\[${escaped}\\]`, 'm').test(changelog),
    `CHANGELOG.md needs a "## [${pkg.version}]" section for the current version`)
  assert(changelog.includes(`releases/tag/v${pkg.version}`),
    `CHANGELOG.md should link releases/tag/v${pkg.version}`)

  // The supported-versions table in SECURITY.md is the third place a release touches.
  const security = readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf8')
  const minor = `${pkg.version.replace(/^(\d+)\.(\d+)\..*$/, '$1.$2')}.x`
  assert(security.includes(`| ${minor} | Yes |`),
    `SECURITY.md should list "| ${minor} | Yes |" in its supported-versions table`)
})

check('documented install specs are well formed and point at this repository', () => {
  // A malformed or stale spec in the docs is invisible until someone tries to install. Generic
  // examples such as `github:owner/repo` are fine; a spec that names this package must name the
  // repository's owner, and no spec may still contain placeholder angle brackets.
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url
  const match = /github\.com\/([^/\s]+)\/([^/\s#]+)/.exec(String(repo).replace(/^git\+/, ''))
  assert(match, `cannot read owner/repo out of ${repo}`)
  const owner = match[1]

  for (const doc of ['README.md', 'README.zh-CN.md', 'docs/RELEASING.md']) {
    const text = readFileSync(path.join(ROOT, doc), 'utf8')
    for (const found of text.match(/github:[^\s`)\]]+/g) || []) {
      assert(!/[<>]/.test(found), `${doc} documents a malformed spec: ${found}`)
      const parts = /^github:([^/]+)\/(.+)$/.exec(found)
      assert(parts, `${doc} documents a malformed spec: ${found}`)
      const name = parts[2].replace(/\.git$/, '')
      if (name === pkg.name) {
        assert(parts[1] === owner, `${doc} points ${name} at "${parts[1]}", expected "${owner}"`)
      }
    }
  }
})

check('docs/RELEASING.md tracks the current version', () => {
  // docs/RELEASING.md walks a maintainer through the release; a stale version there is a trap.
  const releasing = readFileSync(path.join(ROOT, 'docs/RELEASING.md'), 'utf8')
  assert(!/\b0\.1\.0\b/.test(releasing), 'docs/RELEASING.md still shows an old version')
  assert(releasing.includes(`v${pkg.version}`), `docs/RELEASING.md should mention v${pkg.version}`)
})

check('bundle patch exists and inserts this package row', () => {
  const patchPath = pkg.dsh?.bundle?.patch
  assert(typeof patchPath === 'string', 'dsh.bundle.patch is missing')
  const patch = readFileSync(path.join(ROOT, patchPath), 'utf8')
  assert(patch.includes(pkg.name), `patch does not mention ${pkg.name}`)
})

check('client half is declared and exported', () => {
  const client = pkg.dsh?.client
  assert(client && client.platform === 'web', 'dsh.client.platform must be "web"')
  const exported = pkg.exports?.['./client']
  assert(typeof exported === 'string' && existsSync(path.join(ROOT, exported)), 'exports["./client"] must point at an existing file')
})

check('client bundle registers a factory under the package name', () => {
  const source = readFileSync(path.join(ROOT, pkg.exports['./client']), 'utf8')
  assert(source.includes('__ModuleLoader__.load'), 'client.js must call window.__ModuleLoader__.load')
  assert(source.includes(`id: '${pkg.name}'`) || source.includes(`id: "${pkg.name}"`),
    `client factory id must equal the package name (${pkg.name})`)
})

check('the cancel button and the cancel route are wired to each other', () => {
  // The route existed for a while with nothing calling it: a slow `winget install` could not be
  // stopped from the panel at all. This check keeps the two halves joined — it fails if the button
  // goes away, and equally if a refactor moves the host route out from under the client.
  const client = readFileSync(path.join(ROOT, pkg.exports['./client']), 'utf8')
  assert(client.includes("'/jobs/cancel'"), 'client.js no longer posts to /jobs/cancel')
  assert(client.includes("t('cancelJob')"), 'client.js no longer renders a cancel button')

  const host = readFileSync(path.join(ROOT, 'index.js'), 'utf8')
  assert(host.includes("'/dsh-dev-env/api/jobs/cancel'"), 'index.js no longer registers the cancel route')
  // The route has to stay POST-only: it kills a process tree, so it must not be reachable by a
  // plain link or a prefetch.
  assert(/jobs\/cancel'[\s\S]{0,400}?POST only/.test(host), 'the cancel route must still reject non-POST requests')
})

check('files[] shipped by npm actually exist', () => {
  for (const entry of pkg.files || []) {
    if (entry.includes('*')) continue
    assert(existsSync(path.join(ROOT, entry)), `files[] lists a missing path: ${entry}`)
  }
})

check('every module the shipped code imports is itself shipped', () => {
  // The guard whose absence shipped 1.1.0 broken. `files[]` is what npm packs, so a relative import
  // that is not in it resolves in the working tree and nowhere else: every machine that installed
  // 1.1.0 got "failed to import" and lost the plugin entirely, because describe.js was in the repo
  // but not in the tarball. Checking that listed files exist (the check above) is the other
  // direction and cannot catch this.
  const patterns = (pkg.files || []).filter((entry) => !entry.endsWith('/'))
  const isShipped = (rel) =>
    patterns.includes(rel) ||
    patterns.some((pattern) => {
      if (!pattern.includes('*')) return false
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]*')
      return new RegExp(`^${escaped}$`).test(rel)
    })

  const queue = patterns.filter((entry) => /\.m?js$/.test(entry))
  const walked = new Set()
  const problems = []
  while (queue.length) {
    const rel = queue.shift()
    if (walked.has(rel)) continue
    walked.add(rel)
    const abs = path.join(ROOT, rel)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf8')
    // Static `from '…'`, side-effect `import '…'`, and dynamic `import('…')` all count.
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), match[1]))
      if (!/\.m?js$/.test(target)) continue
      if (!isShipped(target)) problems.push(`${rel} imports ${target}, which files[] does not pack`)
      else if (!walked.has(target)) queue.push(target)
    }
  }
  assert(problems.length === 0, problems.join('; '))
})

check('locale dictionaries parse and carry display metadata', () => {
  for (const locale of ['en', 'zh']) {
    const file = path.join(ROOT, 'locale', `${locale}.json`)
    if (!existsSync(file)) continue
    const dict = JSON.parse(readFileSync(file, 'utf8'))
    assert(typeof dict?.meta?.title === 'string' && dict.meta.title, `${locale}.json needs meta.title`)
  }
})

check('package.json carries a real author and repository', () => {
  const raw = readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  assert(!raw.includes('GITHUB_USER'), 'replace the GITHUB_USER template placeholder in package.json')
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author && pkg.author.name
  assert(typeof author === 'string' && author.trim().length > 0,
    'package.json needs an author (string, or an object with a name)')
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url
  assert(typeof repo === 'string' && /github\.com\/[^/\s]+\/[^/\s]+/.test(repo),
    'package.json repository must point at a real repository URL')
})

// Only files a user actually reads are scanned: docs/RELEASING.md necessarily shows the
// placeholder token as part of the instructions, so warning about it there would never go away.
for (const doc of ['README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md']) {
  const file = path.join(ROOT, doc)
  if (!existsSync(file)) continue
  if (readFileSync(file, 'utf8').includes('GITHUB_USER')) {
    warnings += 1
    console.warn(`  warn  ${doc} still contains the GITHUB_USER placeholder`)
  }
}

// ------------------------------------------------------------------ panel behaviour
// The parts of the panel that get behavioural tests rather than shape checks: cancel, and picking a
// folder for a tool the scanner cannot find. They render the real client.js against a minimal
// React/DOM shim and click the actual buttons. See that file for why the shim exists instead of a
// devDependency.
console.log('\npanel behaviour')

await runClientCancelTests({
  async check(name, fn) {
    try {
      await fn()
      console.log(`  ok    ${name}`)
    } catch (error) {
      failures += 1
      console.error(`  FAIL  ${name}\n        ${error && error.message ? error.message : error}`)
    }
  },
})

// ------------------------------------------------------------------ summary
restoreEnvironment()
console.log('')
if (warnings) console.log(`${warnings} warning(s)`)
if (failures) {
  console.error(`${failures} check(s) failed\n`)
  process.exit(1)
}
console.log(`all checks passed (${CATALOG.length} catalog entries)\n`)
