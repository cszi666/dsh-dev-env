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

import { mkdirSync } from 'node:fs'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CATALOG, CATEGORIES } from '../catalog.js'
import { DESCRIPTIONS } from '../describe.js'
import {
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

check('%DRIVES% expands to the system drive plus existing data drives', () => {
  const system = (process.env.SystemDrive || 'C:').replace(/[\\/]+$/, '')
  const [first] = expandEnv('%DRIVES%\\x', {}, () => false)
  assert(first === `${system}\\x`, `expected the system drive first, got ${first}`)
  const several = expandEnv('%DRIVES%\\x', {}, () => true)
  assert(several.length >= 2, `expected several drives with a permissive probe, got ${several.length}`)
  assert(several.every((candidate) => /^[A-Z]:\\x$/.test(candidate)), `bad candidates: ${several.join(', ')}`)
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
 */
check('a picked root makes the scan find the tool, whichever level was picked', async () => {
  const base = path.join(os.tmpdir(), `dsh-dev-env-pick-${process.pid}`)
  const toolDir = path.join(base, 'apache-jmeter-9.9.9')
  mkdirSync(toolDir, { recursive: true })
  try {
    const entry = CATALOG.find((row) => row.id === 'jmeter')
    assert(entry, 'the catalog needs a jmeter entry for this guard')

    const state = { roots: [] }
    // The candidate the catalog actually uses for a user-supplied root.
    const candidate = entry.probe.paths.find((value) => mentionsRoots(value))
    assert(candidate, 'the jmeter entry should have a %DSH_DEV_ENV_ROOTS% candidate')

    for (const picked of [toolDir, base]) {
      // Expansion #1: the user's root is substituted in.
      const expanded = expandEnv(candidate, { DSH_DEV_ENV_ROOTS: picked }, undefined, [picked])
      assert(expanded.length === 1, `one candidate expected for ${picked}, got ${JSON.stringify(expanded)}`)
      // Expansion #2: the last segment is a wildcard, expanded against the real filesystem.
      const starts = [expanded[0]]
      const parent = parentDirStartingPoint(expanded[0], entry.probe)
      if (parent) starts.push(parent)
      const matches = starts.flatMap((start) => expandGlob(start))
      assert(matches.includes(toolDir),
        `picking ${path.basename(picked)} should reach ${toolDir}, got ${JSON.stringify(matches)}`)

      // And the scanner's own probe must agree, through the same code path a scan uses. The root is
      // handed over explicitly so the guard cannot depend on this machine's own picked folders.
      const result = await __test.probeItem(entry, state, { roots: [picked] })
      assert(result.installed === true, `probe should report installed for ${picked}, got ${JSON.stringify(result)}`)
      assert(result.version === '9.9.9', `version should come from the folder name, got ${result.version}`)
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
console.log('')
if (warnings) console.log(`${warnings} warning(s)`)
if (failures) {
  console.error(`${failures} check(s) failed\n`)
  process.exit(1)
}
console.log(`all checks passed (${CATALOG.length} catalog entries)\n`)
