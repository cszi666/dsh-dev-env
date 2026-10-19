/**
 * dsh-dev-env — host 半边
 *
 * 职责：
 *   1) 扫描本机已安装的语言 / IDE / 测试工具 / 数据库 / 构建工具，给出精确版本；
 *   2) 对比目录（catalog），算出"缺什么"，并给出可执行的补齐命令；
 *   3) 把同一套能力同时暴露给两条调用路径：
 *        · Agent Tool —— dev_env_inventory / dev_env_install / dev_env_job /
 *                        dev_env_handoff_write / dev_env_tasks / dev_env_manual / dev_env_state
 *        · HTTP API  —— /dsh-dev-env/api/*（供 Client 面板使用）
 *      两者共用下面这些函数，不存在第二份逻辑。
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { CATALOG, CATEGORIES } from './catalog.js'
import { expandEnv, expandGlob, safeRead, rootsFile, envRoots, configuredRoots, mentionsRoots, parentDirStartingPoint } from './paths.js'
import { loadRoots, saveRoots, addRoot, removeRoot, normaliseDir, describeProbeHint, explainVerdict } from './roots.js'
import { startDownload, resolveDownload, formatBytes, loadHistory, saveHistory, recordSpeed, inspectPending } from './downloads.js'
import { normaliseRecord, emptyRecord, isHandoffEmpty, loadRecords, saveRecords, handoffPrompt, clausePrompt, projectKeyOf, deEscapePath, normaliseTask, normaliseTasks, clampText, parseSummary, recordFromSummary } from './handoff.js'
import { loadSettings, saveSettings, settingsView } from './settings.js'
import { manualText, manualView } from './manual.js'
import { assessPressure, renderAssessment, SYMPTOMS, PRESSURE_BANDS } from './state.js'

// describe.js 只是面板上的一句话文案。它缺失时必须降级成「没有说明」，而不是让整条目录
// 无法激活——1.1.0 正是因为 files[] 漏了它、npm 没把它打进包，导致每一台装了它的机器都
// "failed to import" 而彻底不可用。文案不值得让插件砖掉，所以这里刻意用动态 import 包起来：
// 静态 import 一旦解析失败，整个模块就加载不了，连降级的机会都没有。
let DESCRIPTIONS = {}
try {
  ;({ DESCRIPTIONS } = await import('./describe.js'))
} catch {
  DESCRIPTIONS = {}
}

export const inject = ['tools']

const WIN = process.platform === 'win32'
const CMD_EXT = /\.(cmd|bat)$/i

const CACHE_TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 12_000
const MAX_JOBS = 40
const MAX_LOG_LINES = 300
// 额外根目录的上限。每个根都会进入一部分 pathList 候选，理论上没上限也就没边界，
// 而这条链路上的一切都该有边界——存爆一张 JSON 不是用户能自己发现的故障。
const MAX_ROOTS = 20

// ----------------------------------------------------------------- process

/**
 * Windows 上很多工具是 .cmd / .bat 垫片（npm、pnpm、gradle、tsc…）。
 * Node 18.20+ 起 execFile/spawn 不再直接执行它们，必须先解析出真实路径再交给 cmd.exe。
 */
const pathCache = new Map()

// 进程启动时快照的 PATH 是死的：刚用 winget 装好的工具不会出现在里面。
// 所以额外从注册表读 Machine/User 的 Path 并合并，装完不重启也能立刻被认出来。
let effectivePathValue = null
let effectivePathAt = 0
const PATH_TTL_MS = 20_000

function lookupPath() {
  return effectivePathValue ?? process.env.PATH ?? ''
}

function childEnv() {
  const env = { ...process.env }
  if (effectivePathValue) {
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
    env.Path = effectivePathValue
  }
  return env
}

async function refreshPath(force = false) {
  const now = Date.now()
  if (!force && effectivePathValue && now - effectivePathAt < PATH_TTL_MS) return effectivePathValue
  try {
    const script =
      "[Environment]::GetEnvironmentVariable('Path','Machine') + [char]10 + '####' + [char]10 + " +
      "[Environment]::GetEnvironmentVariable('Path','User')"
    const result = await run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 30_000 })
    const [machine = '', user = ''] = String(result.stdout || '').split('####')
    const seen = new Set()
    const parts = []
    for (const chunk of [process.env.PATH, machine, user]) {
      for (const raw of String(chunk || '').split(';')) {
        const dir = raw.trim().replace(/^"|"$/g, '')
        if (!dir) continue
        const key = dir.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        parts.push(dir)
      }
    }
    if (parts.length) {
      effectivePathValue = parts.join(';')
      effectivePathAt = now
      pathCache.clear()
    }
  } catch {
    /* 读不到就继续用进程自带的 PATH */
  }
  return effectivePathValue
}

function resolveOnPath(name) {
  if (!WIN) return null
  if (pathCache.has(name)) return pathCache.get(name)
  const answer = (() => {
    if (name.includes('\\') || name.includes('/')) return existsSync(name) ? name : null
    const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    const dirs = lookupPath().split(';').filter(Boolean)
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext)
        if (existsSync(candidate)) return candidate
      }
      const direct = path.join(dir, name)
      if (existsSync(direct)) return direct
    }
    return null
  })()
  pathCache.set(name, answer)
  return answer
}

function quoteForCmd(value) {
  const text = String(value)
  if (!/[\s"^&|<>()%]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

/** 把逻辑上的 argv 翻译成真正能 spawn 的 { file, args, verbatim }。 */
function commandOf(argv) {
  const [name, ...args] = argv
  if (!WIN) return { file: name, args, verbatim: false }
  const resolved = resolveOnPath(name) ?? name
  if (CMD_EXT.test(resolved)) {
    // .cmd/.bat 必须交给 cmd.exe。这里自己拼好整行并用 windowsVerbatimArguments
    // 原样传给 cmd，否则 Node 会把内层引号转义成 \" ，cmd 认不出来。
    const command = `"${resolved}"${args.length ? ' ' + args.map(quoteForCmd).join(' ') : ''}`
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
    return { file: comspec, args: ['/d', '/s', '/c', `"${command}"`], verbatim: true }
  }
  return { file: resolved, args, verbatim: false }
}

function effect(ctx, fn, label) {
  if (typeof ctx.effect === 'function') return ctx.effect(fn, label)
  const disposer = fn()
  return typeof disposer === 'function' ? disposer : () => {}
}

function getService(ctx, name) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(name)
  } catch {
    /* ignore */
  }
  return undefined
}

/** 执行一个命令并收集输出；永远 resolve，不抛。 */
function run(argv, options = {}) {
  return new Promise((resolve) => {
    const { file, args, verbatim } = commandOf(argv)
    let settled = false
    const finish = (value) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    let child
    try {
      child = execFile(
        file,
        args,
        {
          cwd: options.cwd ?? os.homedir(),
          timeout: options.timeoutMs ?? PROBE_TIMEOUT_MS,
          windowsHide: true,
          windowsVerbatimArguments: verbatim,
          env: childEnv(),
          maxBuffer: 4 * 1024 * 1024,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          finish({
            ok: !error,
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            enoent: !!error && error.code === 'ENOENT',
            error: error ? String(error.message || error) : null,
          })
        },
      )
    } catch (error) {
      finish({ ok: false, code: 1, stdout: '', stderr: '', enoent: false, error: String((error && error.message) || error) })
      return
    }
    child.on('error', (error) => {
      finish({
        ok: false,
        code: 1,
        stdout: '',
        stderr: '',
        enoent: error && error.code === 'ENOENT',
        error: String((error && error.message) || error),
      })
    })
  })
}

function match(pattern, text) {
  if (!pattern) return null
  try {
    const m = new RegExp(pattern, 'm').exec(text ?? '')
    return m ? m[1] ?? m[0] : null
  } catch {
    return null
  }
}

const installed = (version, where, debug) => ({
  installed: true,
  version: version ?? null,
  where: where ?? null,
  reason: null,
  debug: debug ?? null,
})
const missing = (reason, debug) => ({
  installed: false,
  version: null,
  where: null,
  reason: reason ?? null,
  debug: debug ?? null,
})

/** 探测失败时留存的可解释信息：用了什么探测、实际执行了什么、退出码与输出片段。 */
function diagOf(probe, extra) {
  const diag = { probe: probe ?? null, file: null, exitCode: null, output: null }
  return Object.assign(diag, extra ?? {})
}

function snippet(stdout, stderr, limit = 400) {
  const text = `${stdout ?? ''}\n${stderr ?? ''}`.replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text || null
}

// --------------------------------------------------- portable path resolution
// Implementation lives in ./paths.js so it can be unit tested and reviewed on its own.

/** The global npm root: asked once per scan, with environment-variable fallbacks. */
async function npmGlobalRoot(state) {
  if (state.npmRoot !== undefined) return state.npmRoot
  let root = null
  const result = await run(['npm', 'root', '-g'], { timeoutMs: 20_000 })
  const first = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0]
  if (result.ok && first && existsSync(first)) root = first
  if (!root) {
    for (const candidate of [
      '%APPDATA%\\npm\\node_modules',
      '%ProgramFiles%\\nodejs\\node_modules',
      '%ProgramFiles(x86)%\\nodejs\\node_modules',
      '%LOCALAPPDATA%\\pnpm\\global\\5\\node_modules',
    ]) {
      const [expanded] = expandEnv(candidate)
      if (expanded && existsSync(expanded)) {
        root = expanded
        break
      }
    }
  }
  state.npmRoot = root
  return root
}

// ----------------------------------------------------------------- registry

/** 一次性读取三个卸载注册表分支，缓存整个扫描周期。 */
async function registryIndex(state) {
  if (state.registry) return state.registry
  if (state.registryPromise) return state.registryPromise
  state.registryPromise = (async () => {
    const script = [
      '$OutputEncoding=[Text.Encoding]::UTF8;[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
      "$ErrorActionPreference='SilentlyContinue';",
      "$p=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
      "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
      "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
      'Get-ItemProperty $p | Where-Object { $_.DisplayName } |',
      'Select-Object DisplayName,DisplayVersion,InstallLocation | ConvertTo-Json -Compress -Depth 3',
    ].join('')
    const result = await run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 90_000 })
    let list = []
    try {
      const parsed = JSON.parse((result.stdout || '').trim() || '[]')
      list = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      list = []
    }
    state.registry = list.filter((row) => row && row.DisplayName)
    return state.registry
  })()
  return state.registryPromise
}

/**
 * 插件的状态目录 —— **必须是能写进去的那个**，而不是"看起来正确的那个"。
 *
 * 起因是一次真实失败：`rootsFile()` 把路径算成了 `<profile>/dsh-dev-env/roots.json`，看起来完全正确，
 * 但那个位置**写不进去**（这台机器上创建该目录会被拒绝），于是 mkdir 抛错、保存返回 false，而调用方
 * 只看到一句"没有可用的存储位置"——**错误信息把真正的原因藏住了**，害得排查绕了一圈。
 *
 * 所以这里不猜：**逐个候选真写一个探针文件**，第一个成功的才是存储位置。候选顺序按语义优先级：
 *   1. `DSH_DEV_ENV_STATE_DIR` —— 显式覆盖，给测试与特殊部署用
 *   2. `<rootsFile() 所在目录>` —— 原本的设计位置（profile 下）
 *   3. `DSH_PROFILE_DIR/dsh-dev-env-state` —— 万一 profile 下那层目录建不出来
 *   4. 会话工作区 / 当前目录下的 `.dsh-dev-env` —— 受限策略下也可写，且不会被当临时文件清掉
 *   5. 系统临时目录 —— 最后兜底，宁可状态易失也不要功能完全不可用
 *
 * 结果缓存起来（一次探针一个进程），因为每个 HTTP 请求都要用它。
 */
let stateDirCache = null

function stateDir() {
  if (stateDirCache) return stateDirCache
  const candidates = []
  const explicit = process.env.DSH_DEV_ENV_STATE_DIR
  if (explicit && String(explicit).trim()) candidates.push(String(explicit).trim())
  const primary = rootsFile()
  if (primary) candidates.push(path.dirname(primary))
  if (process.env.DSH_PROFILE_DIR) candidates.push(path.join(process.env.DSH_PROFILE_DIR, 'dsh-dev-env-state'))
  // 会话工作区：在 workspace-write 策略下**一定可写**，而且不会被系统当临时文件清掉。
  // 放在 profile 之后：profile 才是语义上正确的位置，只有它不可用时才退到这里。
  if (process.env.DSH_WORKSPACE && String(process.env.DSH_WORKSPACE).trim()) {
    candidates.push(path.join(String(process.env.DSH_WORKSPACE).trim(), '.dsh-dev-env'))
  }
  candidates.push(path.join(process.cwd(), '.dsh-dev-env'))
  candidates.push(path.join(os.tmpdir(), 'dsh-dev-env-state'))

  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true })
      const probe = path.join(dir, '.dsh-dev-env-writable')
      writeFileSync(probe, 'ok', 'utf8')
      rmSync(probe, { force: true })
      stateDirCache = dir
      return dir
    } catch {
      /* 换下一个候选；全都失败时下面返回 null */
    }
  }
  stateDirCache = null
  return null
}

/** 状态目录里的一个文件。目录不可用时返回 null，调用方据此如实报错。 */
function stateFile(name) {
  const dir = stateDir()
  if (!dir) return null
  return path.join(dir, name)
}

// ----------------------------------------------------------------- scanned roots

/** Where the panel remembers the folders the user picked. */
function rootsPathOf(state) {
  if (!state.rootsPath) state.rootsPath = stateFile('roots.json')
  return state.rootsPath
}

/**
 * The folder list one scan should search: the environment variable plus the panel's store.
 *
 * The file is read on every scan (never cached across scans) because "pick a folder and see it work
 * without restarting DSH" is the entire point of the store — a cached copy would quietly undo it.
 * The merge itself lives in paths.js so that this list and the one `expandEnv` builds for
 * `%DSH_DEV_ENV_ROOTS%` cannot drift apart.
 */
function scanRoots(state) {
  const file = rootsPathOf(state)
  const stored = loadRoots(file)
  const env = envRoots()
  return { file, stored, env, merged: configuredRoots(process.env, stored) }
}

/**
 * The roots list the panel renders: every root a scan used, tagged with where it came from, and
 * whether the user can remove it. One set by an administrator through the environment variable is
 * marked removable: false on purpose — the panel cannot delete it, and a button that fails would
 * look broken rather than honest.
 */
function rootsView(state) {
  const info = state.rootsInfo ?? scanRoots(state)
  const storedKeys = new Set(info.stored.map((dir) => String(dir).toLowerCase()))
  return info.merged.map((dir) => {
    const fromStore = storedKeys.has(String(dir).toLowerCase())
    return { dir, source: fromStore ? 'picked' : 'env', removable: fromStore }
  })
}

// ----------------------------------------------------------------- probes

/**
 * 用条目自己的探测规则，判断**某一个目录**算不算这个工具——也就是用户选文件夹之后那句回执。
 *
 * 复用 pathList 分支而不是另写一套判断：上一版的注释里已经写明，"诊断说行、探针说不行"是这类
 * 插件最难查的分歧。这里和真正扫描走的是同一份规则，所以结论永远一致。
 */
function probeAtDir(probe, dir) {
  const absence = []
  if (probe.file && !existsSync(path.join(dir, probe.file))) absence.push(`缺少 ${probe.file}`)
  for (const relative of probe.requires || []) {
    if (!existsSync(path.join(dir, relative))) absence.push(`缺少 ${relative}`)
  }
  if (absence.length) return { ok: false, missing: absence }

  let source = null
  if (probe.file) {
    source = safeRead(path.join(dir, probe.file))
  } else {
    let isFile = false
    try {
      isFile = statSync(dir).isFile()
    } catch {
      isFile = false
    }
    source = isFile ? safeRead(dir) : path.basename(dir)
  }
  if (source === null) return { ok: false, missing: ['这个目录读不出来'] }

  const version = probe.pattern ? match(probe.pattern, source) : null
  if (probe.pattern && !version) return { ok: false, missing: [`目录名或文件内容不匹配 ${probe.pattern}`] }

  return {
    ok: true,
    missing: [],
    version: version === null ? (probe.version ?? null) : `${probe.prefix ?? ''}${version}${probe.suffix ?? ''}`,
  }
}

async function probeItem(item, state, options = {}) {
  const probe = item.probe
  if (!probe) return missing('未声明探测方式', diagOf(null))
  // `roots` is only for tests: a scan relies on expandEnv's own default, which merges the
  // environment variable with the panel's store. Stating the list explicitly keeps a guard from
  // depending on whatever this machine happens to have picked.
  const roots = options.roots
  const expand = (input) =>
    roots === undefined ? expandEnv(input) : expandEnv(input, process.env, undefined, roots)
  try {
    switch (probe.kind) {
      case 'argv': {
        const spec = commandOf(probe.argv)
        const result = await run(probe.argv)
        const diag = diagOf(probe, {
          file: spec.file,
          exitCode: result.code,
          output: snippet(result.stdout, result.stderr),
        })
        if (result.enoent) return missing(`未找到 ${probe.argv[0]}`, diag)
        const text = `${result.stdout}\n${result.stderr}`
        const version = match(probe.pattern, text)
        if (version) return installed(version, null, diag)
        if (result.ok) return installed(null, null, diag)
        return missing(`退出码 ${result.code}`, diag)
      }
      case 'versionFile': {
        const [resolved] = expand(probe.path)
        const diag = diagOf(probe, { file: resolved ?? probe.path })
        if (!resolved) return missing(`${probe.path} 里的环境变量未设置`, diag)
        if (!existsSync(resolved)) return missing(`${resolved} 不存在`, diag)
        const text = readFileSync(resolved, 'utf8')
        const raw = match(probe.pattern, text)
        if (!raw) return missing('版本文件中没有匹配到版本号', diag)
        return installed(`${probe.prefix ?? ''}${raw}${probe.suffix ?? ''}`, resolved, diag)
      }
      case 'dir': {
        const [resolved] = expand(probe.path)
        const diag = diagOf(probe, { file: resolved ?? probe.path })
        if (!resolved) return missing(`${probe.path} 里的环境变量未设置`, diag)
        if (!existsSync(resolved)) return missing(`${resolved} 不存在`, diag)
        return installed(probe.version ?? null, resolved, diag)
      }
      case 'pathList': {
        // 端口无关的定位方式：候选路径支持 %ENV% / ~ / 单段通配，
        // 匹配到文件就按文件内容抓版本，匹配到目录就按目录名抓版本。
        // `requires` 是内容层面的额外门槛（例如"必须带 bin\javac.exe"才算 JDK），
        // 用来把同名但不同性质的东西排除掉。
        //
        // 候选里同时保留了两种起点（见 belowRoot / rootStartingPoints）：`%DSH_DEV_ENV_ROOTS%` 代表
        // 用户自己指的一层，他既可能指工具的**父目录**，也可能指**工具自己那个目录**——面板的提示
        // 让他选后者，所以这里必须两种都试，否则"选对了却还是认不出来"需要用户自己去猜该选哪一层。
        const diag = diagOf(probe)
        const tried = []
        for (const candidate of probe.paths || []) {
          const starts = expand(candidate)
          const withParent = []
          for (const start of starts) {
            withParent.push(start)
            // 用户可能指工具自己的目录（面板的提示就是这么教他的），这时候选多拼了一层。
            // 把它降回父目录再试一次——只有最后一段本身是"工具目录名"（带通配或能匹配 pattern）时
            // 才会这么做，所以不会把深路径的中间层拉进来、把候选数量无谓地翻倍。
            if (mentionsRoots(candidate)) {
              const parent = parentDirStartingPoint(start, probe)
              if (parent) withParent.push(parent)
            }
          }
          for (const withEnv of withParent) {
            for (const base of expandGlob(withEnv)) {
              const target = probe.file ? path.join(base, probe.file) : base
              tried.push(target)
              if (!existsSync(target)) continue
              if (probe.requires && !probe.requires.every((relative) => existsSync(path.join(base, relative)))) {
                continue
              }
              if (!probe.pattern) {
                diag.file = target
                return installed(probe.version ?? null, target, diag)
              }
              let source = null
              if (probe.file) {
                source = safeRead(target)
              } else {
                let isFile = false
                try {
                  isFile = statSync(target).isFile()
                } catch {
                  isFile = false
                }
                source = isFile ? safeRead(target) : path.basename(target)
              }
              if (source === null) continue
              const raw = match(probe.pattern, source)
              if (!raw) continue
              diag.file = target
              diag.output = source.slice(0, 200).replace(/\s+/g, ' ')
              return installed(`${probe.prefix ?? ''}${raw}${probe.suffix ?? ''}`, target, diag)
            }
          }
        }
        diag.output = tried.slice(0, 6).join(' | ') || null
        return missing('候选路径都不存在或匹配不到版本号', diag)
      }
      case 'pip': {
        const result = await run(['python', '-m', 'pip', 'show', probe.module])
        const diag = diagOf(probe, { file: 'python -m pip', exitCode: result.code, output: snippet(result.stdout, result.stderr) })
        if (!result.ok) return missing(`pip 中未安装 ${probe.module}`, diag)
        const version = match('Version:\\s*([\\S]+)', result.stdout)
        return installed(version, `pip:${probe.module}`, diag)
      }
      case 'npmGlobal': {
        const root = await npmGlobalRoot(state)
        const diag = diagOf(probe, { file: root ?? 'npm root -g 未解析出目录' })
        if (!root) return missing('找不到全局 npm 目录', diag)
        const dir = path.join(root, probe.name)
        if (!existsSync(dir)) return missing(`全局 npm 目录里没有 ${probe.name}`, diag)
        let version = null
        try {
          const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
          version = pkg.version ?? null
        } catch {
          /* ignore */
        }
        diag.file = dir
        return installed(version, dir, diag)
      }
      case 'registry': {
        const index = await registryIndex(state)
        const diag = diagOf(probe, { file: 'Windows 卸载注册表', exitCode: index.length ? 0 : 1, output: `索引 ${index.length} 条` })
        let re
        try {
          re = new RegExp(probe.match, 'i')
        } catch {
          return missing('match 非法', diag)
        }
        const hit = index.find((row) => re.test(row.DisplayName))
        if (!hit) return missing('注册表中没有该程序', diag)
        return installed(hit.DisplayVersion || null, hit.InstallLocation || null, diag)
      }
      default:
        return missing(`未知探测方式 ${probe.kind}`, diagOf(probe))
    }
  } catch (error) {
    return missing(String((error && error.message) || error), diagOf(probe))
  }
}

// ----------------------------------------------------------------- inventory

async function scan(state, options = {}) {
  const now = Date.now()
  if (!options.force && state.cache && now - state.cache.at < CACHE_TTL_MS) return state.cache.value
  if (state.inflight) return state.inflight

  state.inflight = (async () => {
    try {
      // 先刷新 PATH：刚用一键补齐装好的工具不该被漏掉
      await refreshPath(options.force === true)
      // 再读一次额外的根目录。放在这里而不是模块加载时：用户在面板里选完文件夹，
      // 下一次扫描就必须看到它——"不用重启 DSH"正是这个存储存在的理由。
      const roots = scanRoots(state)
      state.roots = roots.merged
      state.rootsInfo = roots
      const results = new Array(CATALOG.length)
      let cursor = 0
      const workers = Array.from({ length: Math.min(8, CATALOG.length) }, async () => {
        for (;;) {
          const index = cursor++
          if (index >= CATALOG.length) return
          results[index] = await probeItem(CATALOG[index], state)
        }
      })
      await Promise.all(workers)

      // winget 是否真的能用：整个扫描只问一次，然后决定要不要把 winget 方案列出来。
      // force 时不缓存失败结果，所以用户装好 winget 后"重新扫描"就能立刻看到它出现。
      const wingetOk = await wingetReady()
      // 用户设置每次扫描读一次：设置文件是给人手改的，缓存它只会让"改了没生效"变得难以解释。
      const settings = loadSettings(settingsFile())

      const items = await Promise.all(
        CATALOG.map(async (entry, index) => {
          const result = results[index] ?? missing('未探测')
          const base = {
            id: entry.id,
            name: entry.name,
            nameEn: entry.nameEn ?? null,
            desc: DESCRIPTIONS[entry.id]?.zh ?? null,
            descEn: DESCRIPTIONS[entry.id]?.en ?? null,
            category: entry.category,
            essential: entry.essential === true,
            installed: result.installed,
            version: result.version,
            where: result.where,
            reason: result.reason,
            debug: result.installed ? null : result.debug ?? null,
            // 认这个工具需要什么，由它自己的探测声明生成；非 pathList 条目是 null，
            // 面板据此决定"选文件夹"这个入口显不显示（对注册表/PATH 类条目它毫无用处）。
            hint: describeProbeHint(entry),
            install: entry.install ?? {},
            plans: plansFor(entry, { wingetReady: wingetOk, settings }).map((plan) => ({
              mode: plan.mode,
              label: plan.label,
              url: plan.url ?? null,
              note: plan.note ?? null,
              // 来源列表要能到面板：否则"换源"下拉无从渲染。只有我们自己下载的方案才有它。
              sources: plan.sources ?? null,
              // 面板在"不指定来源"时（一键补齐 + 倒计时自动开始）用它，而不是自己猜第一个。
              defaultSource: plan.defaultSource ?? null,
            })),
          }
          // 卸载方式只对**已安装**的条目计算，而且只在真有时才给：面板因此不需要自己判断
          // "这个工具能不能卸"，也就不会出现按下去没反应的按钮。registry 类型要读注册表，
          // 所以这里是异步的。
          const plan = await uninstallPlanFor(state, { id: entry.id, installed: result.installed })
          return {
            ...base,
            // 面板要能解释"为什么这里没有一键补齐"，而不是只显示一个空位。
            wingetUsable: wingetOk,
            uninstall: plan
              ? {
                  label: plan.label,
                  quiet: plan.quiet === true,
                  experimental: plan.experimental === true,
                  interactive: plan.interactive === true,
                  note: plan.note ?? null,
                }
              : null,
          }
        }),
      )

      const missingItems = items.filter((item) => !item.installed)
      const value = {
        scannedAt: new Date().toISOString(),
        platform: process.platform,
        host: os.hostname(),
        categories: CATEGORIES,
        // 这一次扫描实际搜过哪些额外根目录，以及每条是怎么来的。
        // 面板要把它们列出来并允许撤销——选错的目录必须能收回，否则用户只能去删 JSON。
        roots: rootsView(state),
        items,
        summary: {
          total: items.length,
          installed: items.length - missingItems.length,
          missing: missingItems.length,
          essentialMissing: missingItems.filter((item) => item.essential).length,
          byCategory: CATEGORIES.map((category) => {
            const group = items.filter((item) => item.category === category.id)
            return {
              id: category.id,
              name: category.name,
              total: group.length,
              installed: group.filter((item) => item.installed).length,
              missing: group.filter((item) => !item.installed).length,
            }
          }),
        },
      }
      state.cache = { at: Date.now(), value }
      return value
    } finally {
      state.inflight = null
    }
  })()

  return state.inflight
}

// ----------------------------------------------------------------- install

/** 一个下载条目的可选来源，供面板显示"换源"下拉。没有列表（单来源）时返回 null。 */
function downloadSourcesOf(download, settings) {
  if (!Array.isArray(download?.sources)) return null
  const rows = download.sources.map((entry) => ({
    name: entry.name,
    label: entry.label ?? entry.name,
    host: (() => {
      try {
        return new URL(entry.listing ?? entry.direct).host
      } catch {
        return null
      }
    })(),
  }))
  // "不显示国内镜像"只影响**呈现**，不改目录：被隐藏的源仍然写在 catalog 里，随时可以打开。
  if (settings && settings['download.showMirrors'] === false) {
    return rows.filter((row) => /^(apache|nodejs|pythonorg|curlse)$/.test(row.name))
  }
  return rows
}

/**
 * 不指定来源时该用哪一个——这是 `download.preferOfficial` 唯一**真正改变行为**的地方。
 *
 * 打开（默认）：用第一个源，也就是官方站。关掉：优先国内镜像，源站慢的时候更快。
 * 返回 null 表示"让 resolveDownload 走它自己的默认顺序"。
 */
function pickDefaultSource(download, settings) {
  if (!Array.isArray(download?.sources)) return null
  if (settings && settings['download.preferOfficial'] === false) {
    // 顺序仍然来自 catalog，所以"哪一个是镜像"不需要在这里再定义一次。
    const mirror = download.sources.find((entry) => !/^(apache|nodejs|pythonorg|curlse)$/.test(entry.name))
    if (mirror) return mirror.name
  }
  return null
}

/**
 * winget 到底能不能用。
 *
 * 这台机器上出现过最坏的一种情况：`%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` 是**0 字节的
 * 应用执行别名占位符**（Store 从没装过 winget）。执行它没有任何输出，退出码是 WinGet 自己的
 * 0x8A150001。只看"这个名字在不在 PATH 上"会判成存在——而它每一次安装都必然失败，用户看到的却是
 * "一键补齐"点下去没反应、或者一个看不懂的退出码。
 *
 * 所以健康检查以**有没有版本号输出**为准，而且只缓存成功的结果：失败要能被下一次扫描纠正过来
 * （用户可能刚装好 winget）。
 */
let wingetHealthy = null

async function wingetReady() {
  if (process.platform !== 'win32') return false
  if (wingetHealthy === true) return true
  const result = await run(['winget', '--version'], { timeoutMs: 20_000 })
  const healthy = result.ok && /\d+\.\d+/.test(String(result.stdout || ''))
  if (healthy) wingetHealthy = true
  return healthy
}

/** 把 catalog 里的 install 声明翻译成一组可执行方案，顺序即优先级。 */
function plansFor(item, options = {}) {
  const source = item.install || {}
  const plans = []
  // `wingetReady: false` 时**不提供** winget 方案：一个明知跑不通的方案比没有方案更糟，
  // 用户会把"点了一键补齐没反应"归因成插件坏了。
  const wingetUsable = options.wingetReady !== false
  if (source.winget && process.platform === 'win32' && wingetUsable) {
    plans.push({
      mode: 'winget',
      label: `winget install --id ${source.winget} -e`,
      argv: [
        'winget',
        'install',
        '--id',
        source.winget,
        '-e',
        '--accept-source-agreements',
        '--accept-package-agreements',
        '--disable-interactivity',
      ],
      note: source.note ?? null,
    })
  }
  if (source.npm) {
    plans.push({ mode: 'npm', label: `npm install -g ${source.npm}`, argv: ['npm', 'install', '-g', source.npm], note: source.note ?? null })
  }
  if (source.pip) {
    plans.push({
      mode: 'pip',
      label: `python -m pip install ${source.pip}`,
      argv: ['python', '-m', 'pip', 'install', source.pip],
      note: source.note ?? null,
    })
  }
  if (source.download) {
    // 我们自己去取的那个方案。排在 winget 之后、page 之前：winget 走的是系统包管理器（
    // 升级/卸载都归它管，通常仍是首选），但它在网络受限时会静默卡住，那时候这个方案是唯一的出路。
    plans.push({
      mode: 'download',
      label: `自己下载 ${item.name} 的官方压缩包`,
      download: source.download,
      // 可选来源（官方 + 国内镜像）。面板据此显示"换源"下拉；只有我们自己下载的条目才有它，
      // 因为 winget / pip / npm 怎么取包不由我们决定。
      sources: downloadSourcesOf(source.download, options.settings),
      // 不指定来源时的默认来源。由 `download.preferOfficial` 决定，是那个设置唯一真正生效的地方。
      defaultSource: pickDefaultSource(source.download, options.settings),
      note: source.downloadNote ?? null,
    })
  }
  if (source.page) {
    plans.push({ mode: 'page', label: `打开官方下载页 ${source.page}`, url: source.page, note: source.note ?? null })
  }
  return plans
}

/**
 * 挑方案。`auto` 的优先级：winget/npm/pip（托管安装器，升级卸载都有人管）→ 自己下载 →
 * 打开官网。自己下载排在托管安装器之后是刻意的：它要我们自己决定解压到哪、将来由谁升级，
 * 只有在没有托管方案、或者用户明确点名时才用它。
 */
function choosePlan(plans, requested) {
  if (!plans.length) return null
  if (!requested || requested === 'auto') {
    return plans.find((plan) => !['page', 'download'].includes(plan.mode)) ?? plans.find((plan) => plan.mode === 'download') ?? plans[0]
  }
  return plans.find((plan) => plan.mode === requested) ?? null
}

function openExternal(url) {
  if (typeof url !== 'string' || !/^https?:\/\/[^\s"'`&|<>^]+$/i.test(url)) return false
  try {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
    const child = spawn(comspec, ['/d', '/s', '/c', `"start "" "${url}""`], {
      windowsHide: true,
      windowsVerbatimArguments: true,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

function trimJobs(jobs) {
  if (jobs.size <= MAX_JOBS) return
  const ordered = [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt)
  while (ordered.length > MAX_JOBS) {
    const job = ordered.shift()
    jobs.delete(job.id)
  }
}

// ----------------------------------------------------------------- own downloads

/** 我们自己下载/解压的目录。跟着**可写的**状态目录走，不写进只读的发布物目录。 */
function downloadsDir() {
  const dir = stateDir()
  return dir ? path.join(dir, 'downloads') : path.join(os.tmpdir(), 'dsh-dev-env-downloads')
}

function speedHistoryFile() {
  return stateFile('download-speeds.json')
}

/** 交接记录的存储位置。 */
function handoffsFile() {
  return stateFile('handoffs.json')
}

/** 用户设置的位置。 */
function settingsFile() {
  return stateFile('settings.json')
}

/** 解压一个 zip。用系统自带的 tar.exe（Win10 1803+），不额外依赖 7-Zip。 */
async function extractZip(archive, into) {
  const result = await run(['tar', '-xf', archive, '-C', into], { timeoutMs: 15 * 60_000 })
  return { ok: result.ok, error: result.ok ? null : snippet(result.stdout, result.stderr, 300) ?? `退出码 ${result.code}` }
}

/**
 * 交给 DSH 的提问文本。
 * 面板里已经有预设的一句话说明了，所以这条提问要的是「再往下讲一层」，
 * 并且明确带上这台机器上的当前状态——那是只有 Agent 才能顺手查的东西。
 */
function explainPrompt(item, lang) {
  const english = lang === 'en'
  const desc = english ? item.descEn || item.desc : item.desc || item.descEn
  const state = item.installed
    ? english
      ? `installed (${item.version || 'version unknown'})`
      : `已安装（${item.version || '版本未知'}）`
    : english
      ? `not installed${item.reason ? `: ${item.reason}` : ''}`
      : `未安装${item.reason ? `：${item.reason}` : ''}`
  const lines = english
    ? [
        `Explain the developer tool ${item.name}${item.nameEn ? ` (${item.nameEn})` : ''} in a few short paragraphs.`,
        desc ? `Starting point: ${desc}` : '',
        `Cover what it is, what people use it for, when a beginner would need it, and its current state on this machine: ${state}.`,
        'Answer directly; no need to call dev_env_inventory for this.',
      ]
    : [
        `请用几句话解释这个开发工具：${item.name}${item.nameEn ? `（${item.nameEn}）` : ''}。`,
        desc ? `一句话起点：${desc}` : '',
        `请覆盖：它是什么、典型用途、新手什么时候会需要它，以及它在这台机器上的当前状态（${state}）。`,
        '直接回答即可，不需要为此调用 dev_env_inventory。',
      ]
  return lines.filter(Boolean).join('\n')
}

/**
 * 给一个**失败或卡住的任务**生成求助提问。
 *
 * 和 explainPrompt 的区别在于：那条是"这个工具是什么"，这条是"这件事为什么没成"。
 * 所以这里必须把**这台机器上的实际状态**带上——状态、阶段、错误、最后几行输出、
 * 实际执行的命令、下载地址与传输计数。DSH 拿到这些才能真的诊断，而不是给一段泛泛的建议。
 *
 * 明确写出"不要只说可能的原因"：用户点这个按钮是要解决问题，不是要一份清单。
 */
function jobHelpPrompt(job, item, lang) {
  const english = lang === 'en'
  const tail = (job.log || []).slice(-30)
  // 可选行用空串表示"不适用"。这里先按位置收集，再把空串丢掉，最后在日志段前统一留一个空行——
  // 否则某一条不适用时，那个空行会落在"已传输"和"备注"中间，读起来像缺了一段。
  const zh = [
    `我这边有一个 dsh-dev-env 的安装任务没有成功，需要你帮我解决。`,
    `任务：${job.name}（${job.itemId}），方式 ${job.mode}，状态 ${job.status}，阶段 ${job.phase || '-'}。`,
    `执行的命令或来源：${job.label}`,
    job.error ? `报错：${job.error}` : '',
    job.url ? `下载地址：${job.url}` : '',
    job.totalBytes ? `已传输：${job.receivedBytes ?? 0} / ${job.totalBytes} 字节` : '',
    job.exitCode === null || job.exitCode === undefined ? '' : `退出码：${job.exitCode}`,
    job.note ? `备注：${job.note}` : '',
  ]
  const en = [
    `A dev-env install job on my machine did not succeed and I need it fixed.`,
    `Job: ${job.name} (${job.itemId}), mode ${job.mode}, status ${job.status}, phase ${job.phase || '-'}.`,
    `Command or source: ${job.label}`,
    job.error ? `Reported error: ${job.error}` : '',
    job.url ? `Download URL: ${job.url}` : '',
    job.totalBytes ? `Transferred: ${job.receivedBytes ?? 0} of ${job.totalBytes} bytes` : '',
    job.exitCode === null || job.exitCode === undefined ? '' : `Exit code: ${job.exitCode}`,
    job.note ? `Note: ${job.note}` : '',
  ]
  const facts = (english ? en : zh).filter(Boolean)
  const tailLines = tail.map((line) => `  ${line}`)
  const closing = english
    ? [
        `The machine is Windows and this is the dsh-dev-env plugin. Its catalog entry for ${job.itemId} declares how it detects and installs this tool; the host tools dev_env_inventory and dev_env_job expose the same information — call them to check the real current state instead of assuming it.`,
        `Tell me why it failed and what to do next on this machine. Do not just list possible causes; this is a real failure I need resolved.`,
      ]
    : [
        `这台机器是 Windows，插件是 dsh-dev-env。它的目录条目里声明了这个工具怎么探测、怎么补齐；host 侧的 dev_env_inventory 和 dev_env_job 两个工具能拿到同样的信息——请调用它们确认当前真实状态，不要凭假设判断。`,
        `请告诉我它为什么失败、以及在这台机器上接下来该怎么做。不要只罗列可能的原因，这是我真实遇到的问题，需要解决。`,
      ]
  return [...facts, '', english ? `Last ${tailLines.length} log lines:` : `最后 ${tailLines.length} 行日志：`, ...tailLines, '', ...closing].join('\n')
}

/**
 * 把一条提问投进**用户正在看的那个会话**，让 DSH 接手。
 *
 * sessionController 必须在请求时惰性获取：apply 那一刻它可能还没就绪，一次性 ctx.get 会拿到
 * undefined 而且永不重试。会话列表按活跃度排序，第一个可用且非空白的会话就是用户正在看的那个。
 */
async function askDsh({ res, scope, ctx, text, requestId, summary, sessionId }) {
  const sessions = getService(scope || ctx, 'sessionController')
  if (!sessions || typeof sessions.prompt !== 'function') {
    return sendJson(res, 503, { ok: false, error: '当前 DSH 没有可用的会话服务' })
  }
  const abort = new AbortController()
  try {
    // 指定了 sessionId 就投给那个会话（跨对话传递）；否则退到"用户正在看的那个"。
    // 不合并成一条路径：显式指定的会话不该被"最活跃"的排序悄悄替换掉。
    let targetId = sessionId
    if (targetId) {
      const listed = await sessions.list({}, abort.signal)
      const known = ((listed && listed.items) || []).some((row) => row.sessionId === targetId)
      if (!known) return sendJson(res, 404, { ok: false, error: `找不到会话：${targetId}` })
    } else {
      const listed = await sessions.list({}, abort.signal)
      const rows = (listed && listed.items) || []
      const target = rows.find((row) => row.agentAvailable && !row.blank)
      if (!target) return sendJson(res, 409, { ok: false, error: '没有找到可以提问的会话' })
      targetId = target.sessionId
    }
    await sessions.prompt(
      { requestId, sessionId: targetId, mode: 'queue', content: [{ type: 'text', text }] },
      abort.signal,
    )
    sendJson(res, 200, { ok: true, sessionId: targetId, summary })
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
  }
}

/**
 * 请模型写条例的提示词。
 *
 * **两条路的目标不同，所以提示词必须不同**——这是修一个真实故障得来的：
 *   · `fork` 子智能体：它把结果**作为文本还回来**，宿主负责写入。所以明确说"不要调用工具"。
 *   · `current` 当前对话：模型没法把结果还给我（DSH 的 prompt 是单向的），只能靠它**调用工具**写。
 * 第一版对两者用了同一句话（"调用工具保存，不要只打印"），于是 fork 的子智能体照做了、
 * 只回一句"已写入"，而宿主在等**文本**——解析不出五节就报错。一个写入者，一个通道。
 */
function handoffFillPrompt(lang, options = {}) {
  const expectText = options.expectText === true
  const english = lang === 'en'
  const first = expectText
    ? english
      ? 'Write a continuation handover for the work in this conversation and return it as your final message. Do not call any tool — the text you return is what gets recorded.'
      : '请把这段对话里的工作写成一份条例（continuation handover），**作为你的最终回复返回**。不要调用任何工具——你返回的文本就是被记录下来的内容。'
    : english
      ? 'Write a continuation handover for the work in this conversation, then save it by calling the `dev_env_handoff_write` tool. Do not just print it — the tool call is what records it.'
      : '请把这段对话里的工作写成一份条例（continuation handover），然后**调用 `dev_env_handoff_write` 工具保存它**。不要只打印出来——真正记录下来的那一步是工具调用。'
  return english
    ? [
        first,
        '',
        'Use the same five-part structure DSH uses for a compaction summary, because this handover is meant to be read at the start of another conversation in place of the history:',
        '1. Task Overview — the user\'s core request and success criteria, and any constraints they stated',
        '2. Current State — what is done, files created or changed with paths, key artifacts',
        '3. Important Discoveries — technical constraints, decisions and their rationale, errors and how they were resolved, approaches that did not work',
        '4. Next Steps — specific remaining actions in priority order, what is in progress, and the immediate next step',
        '5. Context to Preserve — user preferences and style requirements, non-obvious domain details, promises made',
        '',
        ...(expectText
          ? ['Wrap the whole thing in <summary></summary> tags so the host can read it back.']
          : []),
        'Be concise but complete. The point is that whoever continues this work does not have to re-derive it or repeat a mistake. Write the content in the language the user has been using.',
      ].join('\n')
    : [
        first,
        '',
        '请使用与 DSH 压缩摘要相同的五节结构，因为这份条例的用途就是"在另一个对话的开头代替这段历史被读到"：',
        '1. Task Overview —— 用户的核心请求与成功标准，以及明确提出的约束',
        '2. Current State —— 已经完成了什么、涉及的文件与路径、关键产出物',
        '3. Important Discoveries —— 技术约束、决策与理由、遇到的错误及如何解决、试过但不成的方法',
        '4. Next Steps —— 按优先级排列的具体待办、正在进行中的项、紧接着的下一步',
        '5. Context to Preserve —— 用户偏好与风格要求、不明显的领域细节、做过的承诺',
        '',
        ...(expectText ? ['请把整份内容包在 <summary></summary> 里，好让宿主读回来。'] : []),
        '要简洁但完整。它的价值在于：接着做的人不必重新推导，也不必重犯同一个错误。内容请用用户一直在用的语言写。',
      ].join('\n')
}

/**
 * 一键填充所需的能力探测。
 *
 * A（用当前对话的模型总结）只需要 sessionController，那个已经在用。
 * B（用 compaction 另起一次总结）需要 `compaction` 服务，以及一个带 `session` 与 `options` 的
 * `CompactionAgentContext`——`agents.get(sessionId)` 可能就是它，但这**必须实测**：
 * 拿不到就不能提供 B，否则用户选了一个会静默失败的选项。
 */
async function probeAutoFill(ctx, sessionId) {
  const report = { sessions: false, compaction: false, agent: false, session: false, canCompact: false, detail: [] }
  const sessions = getService(ctx, 'sessionController')
  report.sessions = Boolean(sessions && typeof sessions.list === 'function')
  if (!report.sessions) report.detail.push('sessionController 不可用')

  const compaction = getService(ctx, 'compaction')
  report.compaction = Boolean(compaction && typeof compaction.compactNow === 'function')
  if (!report.compaction) report.detail.push('compaction 服务不可用（B 不可用）')

  const agents = getService(ctx, 'agents')
  if (agents && typeof agents.get === 'function' && sessionId) {
    try {
      const agent = agents.get(sessionId)
      report.agent = Boolean(agent)
      // compactNow 的契约要 `agent.session` 与 `agent.options`。
      report.session = Boolean(agent && agent.session && typeof agent.session.append === 'function')
      report.canCompact = report.compaction && report.agent && report.session
      if (agent && !report.session) report.detail.push('agent 上没有可用的 session 对象')
    } catch (error) {
      report.detail.push(`agents.get 抛错：${String((error && error.message) || error).slice(0, 80)}`)
    }
  } else if (sessionId) {
    report.detail.push('agents 服务不可用或没有 get()')
  }

  // D：能否用**子智能体**总结（不占用主对话的上下文）。
  //
  // 关键不是"有没有 provider"，而是 provider 的 `inheritsParentContext`——子智能体是否带着父对话的
  // 历史开始。**只有继承上下文的 provider 才能做这件事**：不继承的子智能体看不到这段对话，
  // 让它写交接只会编出一个空壳。所以这里如实报告每个 provider 的能力，而不是假定。
  report.subagentProviders = []
  const subagents = getService(ctx, 'subagents')
  if (subagents && typeof subagents.list === 'function' && typeof subagents.getProvider === 'function') {
    try {
      for (const name of subagents.list()) {
        const provider = subagents.getProvider(name)
        report.subagentProviders.push({
          name,
          inheritsParentContext: provider ? provider.inheritsParentContext === true : false,
          agentOptions: provider && provider.capabilities ? provider.capabilities.agentOptions === true : false,
        })
      }
    } catch (error) {
      report.detail.push(`枚举子智能体 provider 失败：${String((error && error.message) || error).slice(0, 60)}`)
    }
  }
  report.canSubagentFill = report.subagentProviders.some((row) => row.inheritsParentContext)

  // A 始终可用（只要会话服务在），因为它只是把一段文本作为提问投进对话。
  report.canAutoFill = report.sessions
  return report
}

/**
 * 一个会话的状态测量。**工具与「状态」页签共用这一份**，所以两者不可能给出不同的数字。
 *
 * 三处真实性保证：
 *   · token 数来自 `tokenMeter.measure()`，不是按字数估的；
 *   · 窗口大小来自路由声明的 `requestContext()`，不是常量；
 *   · 任一项拿不到就返回 `unknown` 并说明缺什么——**凭空的比例看起来和测量一模一样**。
 */
function measureState(ctx, sessionId, lang) {
  const agents = getService(ctx, 'agents')
  const agent = agents && typeof agents.get === 'function' && sessionId ? agents.get(sessionId) : undefined
  const session = agent && agent.session
  if (!session) {
    return {
      ok: false,
      error: '拿不到当前会话对象，因此无法测量上下文占用。这不影响你继续工作，只是没法给出数字。',
    }
  }

  let surfaceTokens = null
  const meter = getService(ctx, 'tokenMeter')
  if (meter && typeof meter.measure === 'function') {
    try {
      const measured = meter.measure(session)
      surfaceTokens = measured && typeof measured.surfaceTokens === 'number' ? measured.surfaceTokens : null
    } catch (error) {
      return { ok: false, error: `测量上下文失败：${String((error && error.message) || error).slice(0, 120)}` }
    }
  }
  const context = typeof session.requestContext === 'function' ? session.requestContext() : null
  const contextWindow = context && typeof context.contextWindow === 'number' ? context.contextWindow : null

  let messages = null
  let compactions = null
  try {
    if (typeof session.deriveMessages === 'function') messages = session.deriveMessages().length
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
    compactions = events.filter((event) => event && typeof event.type === 'string' && event.type.startsWith('compaction/')).length
  } catch {
    /* 统计失败不影响主结论：饱和度的两个输入已经拿到了 */
  }

  const pressure = assessPressure(surfaceTokens, contextWindow)
  const text = renderAssessment({ pressure, messages, compactions, contextWindowSource: contextWindow !== null }, lang)
  return { ok: true, pressure, messages, compactions, symptoms: SYMPTOMS.map((row) => row.id), text }
}

/**
 * 一个会话属于哪个项目。
 *
 * 身份取自 `sessionController.list()` 给出的 `cwd`：那是"这段工作在哪里做"的唯一可靠来源。
 * 读不到会话列表（服务未就绪）时不抛错——退回按会话分开，由 `projectKeyOf` 标注 `scope: 'session'`，
 * 界面就能如实说明"这次没能按项目归并"。
 */
async function projectForSession(ctx, sessionId) {
  const sessions = getService(ctx, 'sessionController')
  if (sessions && typeof sessions.list === 'function') {
    try {
      const listed = await sessions.list({}, new AbortController().signal)
      const row = ((listed && listed.items) || []).find((entry) => entry.sessionId === sessionId)
      // `cwd` 也过一遍还原：它可能来自一个被转义坏掉的来源，而折叠反斜杠是安全的。
      if (row) return projectKeyOf(deEscapePath(row.cwd ?? ''), sessionId)
    } catch {
      /* 读不到就走下面的退化路径 */
    }
  }
  return projectKeyOf(null, sessionId)
}

/**
 * 请求里可选的目标会话。只接受非空字符串：把 `undefined`/`null` 一起转成"未指定"，
 * 免得面板发一个空串就被当成"投给名为 '' 的会话"而 404。
 */
function sessionIdOf(body) {
  const raw = body && body.sessionId
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

/**
 * 给一条任务生成"交给**另一个对话**"的交接文本。
 *
 * 和 jobHelpPrompt 的区别是收件人：那条是"你帮我修"，这条是"这些事正在别的对话里发生，你需要知道"。
 * 所以它带上**所有**任务的当前状态而不只是失败的那一条，并且不要求对方去修——只要求它知道现状。
 */
function jobHandoffPrompt(jobs, lang) {
  const english = lang === 'en'
  const running = jobs.filter((job) => job.status === 'running')
  const rows = jobs.map((job) => {
    const head = `[${job.status}] ${job.name}（${job.itemId}）· ${job.mode} · ${job.label}`
    const bits = [
      job.phase ? `阶段 ${job.phase}` : '',
      job.percent !== null && job.percent !== undefined ? `${job.percent}%` : '',
      job.bytesPerSecond ? `${(job.bytesPerSecond / 1048576).toFixed(1)} MB/s` : '',
      job.error ? `错误：${job.error}` : '',
    ].filter(Boolean)
    const tail = (job.log || []).slice(-3).map((line) => `      ${line}`)
    return [`  ${head}`, bits.length ? `      ${bits.join(' · ')}` : '', ...tail].filter(Boolean).join('\n')
  })
  const lines = english
    ? [
        `Handing over the state of my dev-env tasks. ${jobs.length} job(s), ${running.length} still running.`,
        '',
        ...rows,
        '',
        `This is context from the dsh-dev-env panel, not a request to change anything. Use dev_env_job to read the live state if you need more than this summary.`,
      ]
    : [
        `把我这边 dsh-dev-env 的任务现状交接给你。共 ${jobs.length} 个任务，其中 ${running.length} 个还在运行。`,
        '',
        ...rows,
        '',
        `这是来自 dsh-dev-env 面板的现状，不是要你去改动什么。如果需要比这份摘要更新的状态，用 dev_env_job 查。`,
      ]
  return lines.join('\n')
}

// ---------------------------------------------------------------- job progress
// 安装器画进度条的方式是「裸 \r 刷新同一行」——只按 \n 切分就会把整段刷新历史粘成一条巨长的
// 乱行。那正是面板上看不到进度的原因：信息一直在采，只是被拼坏了。
//
// 这些规则把每条输出翻译成「现在走到哪一步了」，中英都要认，因为 winget 说中文、pip 说英文。
// 顺序有意义：先判完成，否则「已成功安装」会先被 install 规则吃掉。
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g
const PHASE_RULES = [
  { id: 'done', re: /成功|已完成|已安装|完成安装|Successfully|installed|Done\b/i },
  { id: 'verify', re: /验证|哈希|校验|Verifying|hash|checksum/i },
  { id: 'download', re: /下载|Downloading|Downloaded|Fetching|Getting/i },
  // 卸载要排在 install 之前：很多卸载器会打印"正在移除 xxx"，而"移除"和"安装"的中英关键词
  // 并不重叠，但顺序明确比依赖措辞更可靠。
  { id: 'uninstall', re: /卸载|移除|Uninstalling|Uninstalled|Removing|Removed/i },
  { id: 'install', re: /安装|解压|配置|Installing|Extracting|Configuring|Building/i },
]
const PERCENT_RE = /(\d{1,3})\s*%/
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(?:KB|MB|GB)(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:KB|MB|GB))?/i
// 一条「进度行」的特征：带百分比、带体积，或是一串进度条字符。
const PROGRESS_RE = /(\d{1,3}\s*%)|(\d+(?:[.,]\d+)?\s*(?:KB|MB|GB))|[▏▎▍▌▋▊▉█▓▒░#=+\-]{4,}/i

// 我们自己下载的那些任务，把它们的「中断并删除残片」回调挂在这里，供取消路由调用。
// 用模块级 Map 而不是塞进 job 对象：job 会被 JSON 序列化进 /api/jobs，函数塞进去只会污染协议。
const downloadCancels = new Map()

/**
 * 终止整棵进程树。
 *
 * 只 kill 直接子进程是不够的：winget 还会拉起真正的安装器（msiexec 等），杀掉 winget 之后
 * 那些进程会变成后台幽灵，继续写注册表和磁盘。`taskkill /T` 才是把整棵树一起带走。
 */
function killTree(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    try {
      execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, (error) => resolve(!error))
    } catch {
      resolve(false)
    }
  })
}

/**
 * 卸载跑完后复查：这个条目现在还装不装。结论写进 job.uninstall 供面板显示。
 *
 * 复查用**扫描时同一个探针**（probeItem），因为面板下一次刷新显示的就是它的结论——
 * 用任何别的判断都可能出现"任务说卸载成功、清单里还在"这种自相矛盾。
 */
async function verifyUninstall(state, item, job) {
  try {
    const entry = CATALOG.find((row) => row.id === item.id)
    if (!entry) return
    const after = await probeItem(entry, state)
    job.uninstall = { stillInstalled: after.installed === true, version: after.version ?? null }
    if (after.installed) {
      job.log.push('复查：这个工具**仍然被探测到**，卸载可能没有真正完成')
      if (job.status === 'succeeded') {
        job.status = 'failed'
        job.error = job.error ?? '卸载命令返回成功，但复查时这个工具仍然存在'
      }
    } else {
      job.log.push('复查：已经探测不到这个工具了')
      if (job.status === 'succeeded') job.log.push('卸载完成')
      // 卸载会改变 PATH 与注册表，下一次扫描必须重新读
      pathCache.clear()
      state.cache = null
      state.registry = null
      state.registryPromise = null
    }
  } catch (error) {
    job.log.push(`复查失败：${String((error && error.message) || error)}`)
  }
}

/**
 * 修正注册表里"说是卸载、其实是安装"的命令。
 *
 * Windows 的惯例是 `MsiExec.exe /X{GUID}`，但把 `/I`（安装/修复）写进 `UninstallString` 是实际
 * 存在的（这台机器上 MySQL 和 SQL Server LocalDB 都是 `/I`）。照原样执行的话，用户点"卸载"
 * 会触发**修复或重装**——这是个危险的反向操作，比"卸载失败"糟得多。
 *
 * 只做这一处改写：把 MSI 的 `/I` 换成 `/X`。其他形态保持原样，并且如实标注我们改了它。
 */
function normaliseUninstallCommand(command) {
  const text = String(command)
  if (!/\bmsiexec(\.exe)?\b/i.test(text)) return { command: text, adjusted: null }
  const rewritten = text.replace(
    /(^|\s)\/I(\s*\{|\s*"[^"]*\.msi"|\s*$)/i,
    (_all, before, after) => `${before}/X${after}`,
  )
  if (rewritten === text) return { command: text, adjusted: null }
  return { command: rewritten, adjusted: '注册表里写的是 /I（安装），已改写为 /X（卸载）' }
}

/**
 * 这个条目怎么卸载。返回 null 表示**没有可靠的卸载方式**——那就一个按钮也不给。
 *
 * Windows 没有通用卸载，所以分三种来源，且都不靠猜：
 *   · winget 声明 → `winget uninstall --id <id>`，托管安装器的反向操作
 *   · npm / pip 声明 → 对应的 uninstall，但只对"全局包"成立，所以标 experimental
 *   · registry 探针 → 用 **Windows 自己的 UninstallString**，有 QuietUninstallString 才可能静默；
 *     没有的话会弹出交互式向导，而我们追踪不到它的完成
 *
 * 只靠路径探测的条目（解压即用：zentao / adb / junit / scoop…）一律 null：我们没有它们的安装
 * 记录，也不知道用户是不是自己解压的，直接删目录是不可接受的猜测。
 */
async function uninstallPlanFor(state, item) {
  const entry = CATALOG.find((row) => row.id === item.id)
  if (!entry || !item.installed) return null
  const install = entry.install || {}

  if (install.winget && process.platform === 'win32') {
    return {
      mode: 'uninstall',
      label: `winget uninstall --id ${install.winget} -e`,
      argv: ['winget', 'uninstall', '--id', install.winget, '-e', '--accept-source-agreements', '--disable-interactivity'],
      quiet: true,
      note: null,
    }
  }
  if (install.npm) {
    return {
      mode: 'uninstall',
      label: `npm uninstall -g ${install.npm}`,
      argv: ['npm', 'uninstall', '-g', install.npm],
      quiet: true,
      experimental: true,
      note: '只在这个全局包确实存在时有效',
    }
  }
  if (install.pip) {
    return {
      mode: 'uninstall',
      label: `python -m pip uninstall -y ${install.pip}`,
      argv: ['python', '-m', 'pip', 'uninstall', '-y', install.pip],
      quiet: true,
      experimental: true,
      note: '只在这个全局包确实存在时有效',
    }
  }

  if (entry.probe?.kind === 'registry') {
    let re
    try {
      re = new RegExp(entry.probe.match, 'i')
    } catch {
      return null
    }
    const index = await registryIndex(state)
    const hit = index.find((row) => re.test(row.DisplayName))
    const raw = hit?.QuietUninstallString || hit?.UninstallString
    if (!raw) return null
    const { command, adjusted } = normaliseUninstallCommand(raw)
    // `argv` 用**完整**命令（截断一条命令行等于执行错误的命令），只把 label 收短供显示。
    return {
      mode: 'uninstall',
      label: command.length > 300 ? `${command.slice(0, 297)}…` : command,
      argv: ['cmd.exe', '/d', '/s', '/c', command],
      // 交互式卸载器会开自己的窗口，可能比一次静默卸载久得多；给一个宽上限，避免任务永远挂着。
      timeoutMs: 15 * 60_000,
      quiet: Boolean(hit.QuietUninstallString),
      interactive: !hit.QuietUninstallString,
      note: [
        adjusted,
        hit.QuietUninstallString ? null : '会弹出卸载向导；完成后请重新扫描确认',
      ].filter(Boolean).join('；') || null,
    }
  }

  return null
}

/**
 * 自己下载并解压一个工具。这是「像浏览器那样」的进度、速率、ETA、断点续传和干净取消的唯一实现路径：
 * 托管安装器（winget/pip/npm）在管道下连体积和速率都不打印，也没有续传接口。
 *
 * 全部状态写在 job 对象上（而不是另开一份），所以面板和 dev_env_job 不需要区分任务类型。
 */
function startOwnDownload(state, item, plan, job) {
  const dir = downloadsDir()
  const historyFile = speedHistoryFile()
  let cancelled = false
  let handle = null

  // 取消回调一注册就生效，所以**下载还没开始时按取消也有用**：它只是把 cancelled 立起来，
  // 后面每一处都检查它，于是不会有"取消之后还在后台默默下完"的窗口。
  downloadCancels.set(job.id, () => {
    cancelled = true
    if (handle) handle.cancel()
  })

  const finish = (status, error = null) => {
    job.status = status
    job.endedAt = Date.now()
    if (error) job.error = error
    downloadCancels.delete(job.id)
  }

  const work = async () => {
    job.phase = 'download'
    job.activity = '正在解析下载地址…'
    const chosenLabel = plan.sourceLabel ?? plan.download.listing ?? plan.download.direct ?? '(未声明)'
    job.source = plan.source ?? null
    job.log.push(`下载源：${chosenLabel}`)

    // 先解析并**验证**（HEAD/Range 探测）再开始。这一步是"选中的源真的是活的"的保证：
    // 用户选了镜像、或者倒计时自动选了第一条，都不该在几秒后才发现这个源是坏的。
    const resolved = await resolveDownload(plan.download, { source: plan.source })
    if (!resolved) {
      job.log.push('没有解析到可下载的文件（列表不可用，或所有候选都返回了错误状态码）')
      return finish('failed', `找不到可下载的文件${plan.sourceLabel ? `（来源：${plan.sourceLabel}）` : ''}`)
    }
    job.url = resolved.url
    job.version = resolved.version ?? null
    job.totalBytes = resolved.total ?? null
    job.log.push(`已解析：${resolved.name}${resolved.total ? `（${formatBytes(resolved.total)}）` : ''}`)

    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, resolved.name)
    const history = loadHistory(historyFile)
    const host = (() => {
      try {
        return new URL(resolved.url).host
      } catch {
        return null
      }
    })()

    handle = startDownload({
      url: resolved.url,
      file,
      total: resolved.total ?? null,
      history: history[host] ? { [host]: history[host] } : {},
      meter: undefined, // 引擎自带的速度计，历史均值由 history 兜底
      onProgress: (snapshot) => {
        // 进度同时写"结构化字段"和"日志行"：面板读字段，人读日志。
        job.receivedBytes = snapshot.received
        job.totalBytes = snapshot.total ?? job.totalBytes
        if (typeof snapshot.percent === 'number') job.percent = snapshot.percent
        job.bytesPerSecond = snapshot.expectedBytesPerSecond ?? snapshot.liveBytesPerSecond ?? null
        job.etaSeconds = snapshot.etaSeconds
        if (snapshot.note && snapshot.note !== job.note) {
          job.note = snapshot.note
          job.log.push(snapshot.note)
        }
        const parts = [formatBytes(snapshot.received)]
        if (snapshot.total) parts.push(`/ ${formatBytes(snapshot.total)}`)
        if (snapshot.percent !== null) parts.push(`${snapshot.percent}%`)
        if (job.bytesPerSecond) parts.push(`${formatBytes(job.bytesPerSecond)}/s`)
        if (snapshot.etaSeconds !== null) parts.push(`剩余 ${snapshot.etaSeconds}s`)
        job.activity = parts.join('  ')
      },
    })

    const result = await handle.promise
    if (cancelled || job.status === 'cancelled') return

    if (historyFile && host) {
      const rate = job.bytesPerSecond
      if (rate) saveHistory(historyFile, recordSpeed(history, host, rate))
    }

    // 解压到下载目录里自己的文件夹，然后把那一层登记成额外根目录——于是接下来的扫描
    // 会像发现任何其它工具一样发现它（走的是同一条探针，不是特例）。
    job.phase = 'install'
    job.percent = 100
    job.activity = '正在解压…'
    const extracted = await extractZip(file, dir)
    if (!extracted.ok) {
      job.log.push(`解压失败：${extracted.error}`)
      job.log.push('压缩包已保留，可以手动解开')
      return finish('failed', `解压失败：${extracted.error}`)
    }

    const inner = path.join(dir, resolved.name.replace(/\.zip$/i, ''))
    const target = existsSync(inner) ? inner : dir
    const stored = addRoot(loadRoots(rootsPathOf(state)), target)
    if (saveRoots(rootsPathOf(state), stored)) {
      state.cache = null
      state.rootsInfo = null
      job.log.push(`已把 ${target} 记为额外根目录，下次扫描即可识别`)
    } else {
      job.log.push(`解压完成，但没能记住目录 ${target}（存储不可写）`)
    }
    try {
      rmSync(file, { force: true })
    } catch {
      /* 留着一个已解压的压缩包不算问题 */
    }

    job.phase = 'done'
    job.activity = `已解压到 ${target}`
    job.log.push(`完成：${target}`)
    finish('succeeded')
  }

  work().catch((error) => {
    const message = String((error && error.message) || error)
    if (cancelled || job.status === 'cancelled') {
      job.log.push(`已取消：${message}`)
      return
    }
    job.log.push(`失败：${message}`)
    if (handle) handle.cancel() // 认证后仍可能失败：把残片删掉，不留半成品
    finish('failed', message)
  })
}

function startJob(state, item, plan) {
  const job = {
    id: randomUUID().slice(0, 8),
    itemId: item.id,
    name: item.name,
    mode: plan.mode,
    label: plan.label,
    note: plan.note ?? null,
    status: 'running',
    phase: null,
    percent: null,
    size: null,
    activity: null,
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    error: null,
    log: [],
  }
  state.jobs.set(job.id, job)
  trimJobs(state.jobs)

  if (plan.mode === 'page') {
    job.log.push(`打开下载页：${plan.url}`)
    job.status = openExternal(plan.url) ? 'succeeded' : 'failed'
    if (job.status === 'failed') job.error = '无法唤起浏览器，请手动复制链接'
    job.phase = job.status === 'failed' ? 'install' : 'done'
    job.activity = job.log[0]
    job.endedAt = Date.now()
    return job
  }

  if (plan.mode === 'download') {
    // 交给下面的 startOwnDownload；它在后台跑，job 先返回给调用方。
    startOwnDownload(state, item, plan, job)
    return job
  }

  if (plan.mode === 'uninstall') {
    job.phase = 'uninstall'
    job.log.push(`卸载方式：${plan.label}`)
    if (plan.note) job.log.push(plan.note)
    if (plan.interactive) job.log.push('这个卸载器会打开自己的窗口，我们只能把它拉起来，无法追踪它何时结束')
  }

  const push = (chunk) => {
    // 按 \r 也切开，并把 ANSI 控制序列剥掉，否则进度条会在日志里显示成乱码。
    for (const raw of String(chunk).split(/\r\n|\r|\n/)) {
      const text = raw.replace(ANSI_RE, '').trim()
      if (!text) continue
      const line = text.slice(0, 500)
      job.activity = line
      for (const rule of PHASE_RULES) {
        if (rule.re.test(line)) {
          job.phase = rule.id
          break
        }
      }
      const percent = PERCENT_RE.exec(line)
      if (percent) job.percent = Math.max(0, Math.min(100, Number(percent[1])))
      else if (job.phase === 'done') job.percent = 100
      const size = SIZE_RE.exec(line)
      if (size) job.size = size[0].replace(/\s+/g, ' ')
      // 连续两条都是进度行 → 是同一条被刷新了，覆盖而不是追加，避免日志被刷新历史淹没。
      const last = job.log[job.log.length - 1]
      if (last !== undefined && PROGRESS_RE.test(line) && PROGRESS_RE.test(last)) job.log[job.log.length - 1] = line
      else job.log.push(line)
      if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES)
    }
  }

  let child
  try {
    const { file, args, verbatim } = commandOf(plan.argv)
    child = spawn(file, args, {
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    job.status = 'failed'
    job.error = String((error && error.message) || error)
    job.endedAt = Date.now()
    return job
  }

  job.pid = child.pid ?? null
  state.children.add(child)
  if (child.stdout) child.stdout.on('data', push)
  if (child.stderr) child.stderr.on('data', push)
  // `spawn` 没有 execFile 的 timeout 选项，所以超时要自己实现。交互式卸载器可能弹出窗口后
  // 一直挂着，没有上限的话任务会永远停在"运行中"。killTree 带走整棵树，避免只杀外壳。
  const killTimer = plan.timeoutMs
    ? setTimeout(() => {
        job.log.push(`超过 ${Math.round(plan.timeoutMs / 60000)} 分钟仍未结束，已终止`)
        killTree(child.pid).catch(() => {})
      }, plan.timeoutMs)
    : null
  const clearKillTimer = () => {
    if (killTimer) clearTimeout(killTimer)
  }
  child.on('error', (error) => {
    clearKillTimer()
    state.children.delete(child)
    job.status = 'failed'
    job.error = String((error && error.message) || error)
    job.endedAt = Date.now()
  })
  child.on('close', (code) => {
    clearKillTimer()
    state.children.delete(child)
    if (job.status === 'running') {
      job.exitCode = code
      job.status = code === 0 ? 'succeeded' : 'failed'
      job.endedAt = Date.now()
      if (code !== 0) {
        job.error = plan.mode === 'uninstall' ? `卸载进程退出码 ${code}` : `安装进程退出码 ${code}`
        // winget **在不同环境里适配度差别很大**：这台机器上它是 0 字节的 Store 别名（完全跑不起来），
        // 别的机器上它可能装好了却因为"--scope machine 需要提权""企业策略禁用了源""源不可达"而失败——
        // 那些情况下安装进程同样返回非 0，而用户看到的只是一个退出码。
        //
        // 所以失败时把**别的路**一并记下来，让面板能直接给出"改用自己下载"。这不是自动重试：
        // 换一种方式改动系统仍然要用户点头。
        if (plan.mode === 'winget') {
          const alternative = plansFor(item, { wingetReady: false }).find((row) => row.mode === 'download')
          if (alternative) {
            job.fallback = { mode: 'download', label: alternative.label }
            job.log.push(`这条命令失败了；这个条目还有一条不依赖 winget 的路：${alternative.label}`)
          }
        }
      }
      // 卸载之后要**复查**，不能只看退出码：交互式卸载器往往立刻返回 0 而实际什么都没做，
      // 而 winget 卸载一个不是它装的工具也可能报成功。复查走的是扫描用的同一个探针，
      // 所以结论就是面板下一次会显示的那个。
      if (plan.mode === 'uninstall') verifyUninstall(state, item, job)
    }
    // 装完之后立刻重读 PATH，这样面板下一次刷新就能看到新工具
    if (code === 0) refreshPath(true).catch(() => {})
  })
  return job
}

// ----------------------------------------------------------------- tool text

function renderInventory(data, options = {}) {
  const lines = []
  lines.push(`本机开发/测试环境探测 · ${data.scannedAt}`)
  lines.push(
    `共 ${data.summary.total} 项：已安装 ${data.summary.installed} · 缺失 ${data.summary.missing}` +
      (data.summary.essentialMissing ? ` · 其中核心必备缺失 ${data.summary.essentialMissing} 项` : ''),
  )
  lines.push('')

  const missingItems = data.items.filter((item) => !item.installed)
  if (missingItems.length) {
    const essential = missingItems.filter((item) => item.essential)
    const optional = missingItems.filter((item) => !item.essential)
    const block = (title, group) => {
      if (!group.length) return
      lines.push(`${title}（${group.length}）`)
      for (const item of group) {
        const plans = item.plans || []
        const plan = plans.find((p) => p.mode !== 'page') ?? plans[0]
        lines.push(`- ${item.name}  [${item.category}]  → ${plan ? plan.label : '（无自动方案，见下载页）'}`)
      }
      lines.push('')
    }
    block('❌ 缺失 · 核心必备', essential)
    block('⚠ 缺失 · 可选', optional)
  } else {
    lines.push('✅ 目录内所有工具链均已安装。')
    lines.push('')
  }

  if (options.full !== false) {
    for (const category of data.categories) {
      const group = data.items.filter((item) => item.category === category.id)
      if (!group.length) continue
      lines.push(`【${category.name}】`)
      for (const item of group) {
        const mark = item.installed ? '✅' : '❌'
        const version = item.installed ? item.version ?? '版本未知' : item.reason ?? '未安装'
        lines.push(`  ${mark} ${item.name} — ${version}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n').trimEnd()
}

// ----------------------------------------------------------------- plugin

export function apply(ctx, config) {
  const state = {
    cache: null,
    inflight: null,
    registry: null,
    registryPromise: null,
    jobs: new Map(),
    children: new Set(),
  }

  // -------------------------------------------------- HTTP API（Client 面板用）
  //
  // ⚠️ 必须用局部 ctx.inject 等 webServer 就绪，不能在这里 ctx.get 一次性取值：
  // 冷启动时本插件可能先于 webServer 激活，`get` 会拿到 undefined 并且永不重试，
  // 结果就是面板能渲染、但所有 /dsh-dev-env/api/* 返回 404。
  // （对照 dsh-whale-widget：对象级 inject 会把整个 apply 推迟到服务就绪，
  //   而桌面端的注入表是启动时一次性收集的；局部 inject 只等这一段，两边都不耽误。）
  const registerRoutes = (scope) => {
    const server = (scope && scope.webServer) || getService(scope || ctx, 'webServer')
    if (!server || typeof server.register !== 'function') return undefined
    const disposers = []
    const register = (pathname, handler) => {
      disposers.push(
        server.register({
          kind: 'exact',
          path: pathname,
          handler: async (req, res) => {
            try {
              await handler(req, res)
            } catch (error) {
              sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
            }
          },
        }),
      )
    }

    register('/dsh-dev-env/api/inventory', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const force = url.searchParams.get('refresh') === '1'
      const data = await scan(state, { force })
      sendJson(res, 200, { ok: true, ...data })
    })

    register('/dsh-dev-env/api/jobs', async (_req, res) => {
      sendJson(res, 200, { ok: true, jobs: [...state.jobs.values()].sort((a, b) => b.startedAt - a.startedAt) })
    })

    // 额外根目录：用户手动指的那些"解压在自己文件夹里"的工具。
    // GET 列出、POST 增加、DELETE 撤销。整个存储的意义就是**不用重启 DSH**，
    // 所以每次写盘都顺手把扫描缓存丢掉——下一次 /api/inventory 必须看到新目录。
    register('/dsh-dev-env/api/roots', async (req, res) => {
      const method = (req.method || 'GET').toUpperCase()
      const rootsInfo = scanRoots(state)

      if (method === 'GET') {
        return sendJson(res, 200, { ok: true, roots: rootsView(state), file: rootsInfo.file, env: rootsInfo.env })
      }

      if (method === 'POST') {
        const body = await readJson(req)
        const raw = typeof body.dir === 'string' ? body.dir.trim() : ''
        if (!raw) return sendJson(res, 400, { ok: false, error: '缺少 dir' })
        if (!path.isAbsolute(raw)) return sendJson(res, 400, { ok: false, error: '需要一个完整的绝对路径' })
        const dir = normaliseDir(raw)
        if (!dir) return sendJson(res, 400, { ok: false, error: '这个目录不能作为根目录（比如盘符根目录）' })
        if (!existsSync(dir)) return sendJson(res, 400, { ok: false, error: `这个目录不存在：${dir}` })

        const next = addRoot(rootsInfo.stored, dir)
        if (next.length > MAX_ROOTS) return sendJson(res, 400, { ok: false, error: `最多只能记 ${MAX_ROOTS} 个根目录` })
        if (!saveRoots(rootsInfo.file, next)) {
          return sendJson(res, 500, { ok: false, error: `保存失败：${rootsInfo.file || '(没有可用的存储位置)'}` })
        }
        state.cache = null
        state.rootsInfo = null

        // 选完立刻回执：这个目录到底算不算，缺什么。host 的探针说了算，不另做判断。
        const entry = CATALOG.find((row) => row.id === body.id)
        let verdict = null
        if (entry && entry.probe?.kind === 'pathList') {
          const outcome = probeAtDir(entry.probe, dir)
          verdict = {
            id: entry.id,
            ok: outcome.ok,
            version: outcome.version ?? null,
            missing: outcome.missing,
            message: outcome.ok
              ? `已认出 ${entry.name}${outcome.version ? `（${outcome.version}）` : ''}`
              : explainVerdict(entry, { ok: false, missing: outcome.missing }),
          }
        }
        return sendJson(res, 200, { ok: true, roots: rootsView(state), added: dir, verdict, file: rootsInfo.file })
      }

      if (method === 'DELETE') {
        const body = await readJson(req)
        const raw = typeof body.dir === 'string' ? body.dir.trim() : ''
        if (!raw) return sendJson(res, 400, { ok: false, error: '缺少 dir' })
        const dir = normaliseDir(raw)
        if (!dir) return sendJson(res, 400, { ok: false, error: '这个目录不是一条根目录记录' })
        if (!rootsInfo.stored.some((entry) => entry.toLowerCase() === dir.toLowerCase())) {
          // 环境变量里的根**不可删**：面板删不掉它，说清楚比给一个按了没反应的按钮好。
          return sendJson(res, 404, { ok: false, error: '这条根目录不在面板的记录里（它来自环境变量，或已经被移除了）' })
        }
        if (!saveRoots(rootsInfo.file, removeRoot(rootsInfo.stored, dir))) {
          return sendJson(res, 500, { ok: false, error: `保存失败：${rootsInfo.file || '(没有可用的存储位置)'}` })
        }
        state.cache = null
        state.rootsInfo = null
        return sendJson(res, 200, { ok: true, roots: rootsView(state), removed: dir, file: rootsInfo.file })
      }

      return sendJson(res, 405, { ok: false, error: 'GET / POST / DELETE only' })
    })

    register('/dsh-dev-env/api/install', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      const data = await scan(state)
      const item = data.items.find((entry) => entry.id === body.id)
      if (!item) return sendJson(res, 404, { ok: false, error: `未知的条目：${body.id}` })
      const plan = choosePlan(plansFor(item, { wingetReady: item.wingetUsable }), body.mode)
      if (!plan) return sendJson(res, 400, { ok: false, error: `没有可用的安装方案（${body.mode || 'auto'}）` })
      // 面板可以在来源下拉里指定一个来源。命名错了就明确报错，不悄悄退回另一个源。
      if (body.source) {
        const available = downloadSourcesOf(plan.download)
        const chosen = available?.find((entry) => entry.name === body.source)
        if (!chosen) return sendJson(res, 400, { ok: false, error: `这个方案没有名为 ${body.source} 的下载来源` })
        plan.source = chosen.name
        plan.sourceLabel = `${chosen.label}（${chosen.host ?? '-'}）`
      } else if (plan.mode === 'download') {
        // 没指定来源：按用户设置挑默认源，而不是无条件用第一个。
        // 这不只是"排序"——它决定源站慢的时候会不会用国内镜像，所以必须真的接上。
        const preferred = pickDefaultSource(plan.download, loadSettings(settingsFile()))
        if (preferred) {
          plan.source = preferred
          const available = downloadSourcesOf(plan.download)
          const chosen = available?.find((entry) => entry.name === preferred)
          plan.sourceLabel = chosen ? `${chosen.label}（${chosen.host ?? '-'}）` : preferred
        }
      }
      const job = startJob(state, item, plan)
      sendJson(res, 200, { ok: true, job, plans: item.plans })
    })

    // 列出某个下载方案的可用来源，并**逐个真验证**（解析 + HEAD/Range 探测）。
    // 面板用它填"换源"下拉：只列出真的能下的，坏镜像在这里就被挡掉，不会变成一个选了没反应的选项。
    register('/dsh-dev-env/api/sources', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const id = url.searchParams.get('id')
      const data = await scan(state)
      const item = data.items.find((entry) => entry.id === id)
      if (!item) return sendJson(res, 404, { ok: false, error: `未知的条目：${id}` })
      const plan = plansFor(item, { wingetReady: item.wingetUsable }).find((row) => row.mode === 'download')
      if (!plan) return sendJson(res, 404, { ok: false, error: '这个条目没有自己下载的方案' })
      const available = downloadSourcesOf(plan.download)
      if (!available) {
        return sendJson(res, 200, { ok: true, sources: [{ name: null, label: '默认来源', verified: true, total: null }] })
      }
      // 并行验证：每个来源各自解析一次，慢的那个不该拖住整份列表。
      const checked = await Promise.all(
        available.map(async (entry) => {
          const resolved = await resolveDownload(plan.download, { source: entry.name })
          return {
            name: entry.name,
            label: entry.label,
            host: entry.host,
            verified: Boolean(resolved),
            total: resolved?.total ?? null,
            version: resolved?.version ?? null,
            url: resolved?.url ?? null,
          }
        }),
      )
      sendJson(res, 200, { ok: true, sources: checked })
    })

    register('/dsh-dev-env/api/uninstall', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      const data = await scan(state)
      const item = data.items.find((entry) => entry.id === body.id)
      if (!item) return sendJson(res, 404, { ok: false, error: `未知的条目：${body.id}` })
      if (!item.installed) return sendJson(res, 400, { ok: false, error: '这个工具没有被探测到，无需卸载' })
      // 面板只有在 uninstall 非 null 时才显示按钮；这里仍然重算一次，因为状态可能已经变了
      // （比如用户刚装了某个工具，或者某个注册表项消失了）。
      const plan = await uninstallPlanFor(state, item)
      if (!plan) {
        return sendJson(res, 400, {
          ok: false,
          error: '这个工具没有可靠的卸载方式（多半是解压即用的，我们没有它的安装记录）',
        })
      }
      const job = startJob(state, item, plan)
      sendJson(res, 200, { ok: true, job })
    })

    register('/dsh-dev-env/api/open', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      if (!openExternal(body.url)) return sendJson(res, 400, { ok: false, error: '仅支持 http(s) 链接' })
      sendJson(res, 200, { ok: true })
    })

    // 可供投递的会话列表。面板用"多对话传递"：用户选一个对话，把任务现状交过去。
    // sessionController.list() 本来就按活跃度排序并给出 running/cwd/parentSessionId，
    // 这里只做**投影**，把面板需要的那几项挑出来——不把整个 summary 泄给页面。
    register('/dsh-dev-env/api/sessions', async (req, res) => {
      const sessions = getService(scope || ctx, 'sessionController')
      if (!sessions || typeof sessions.list !== 'function') {
        return sendJson(res, 503, { ok: false, error: '当前 DSH 没有可用的会话服务' })
      }
      const abort = new AbortController()
      try {
        const listed = await sessions.list({}, abort.signal)
        const items = ((listed && listed.items) || []).map((row) => ({
          sessionId: row.sessionId,
          updatedAt: row.updatedAt ?? null,
          running: row.running === true,
          blank: row.blank === true,
          cwd: row.cwd ?? null,
          parentSessionId: row.parentSessionId ?? null,
          origin: row.origin ?? null,
          // 只有能收提示的会话才可选：多数不可用的会话是子代理，投进去没人接。
          available: row.agentAvailable === true && row.blank !== true,
        }))
        sendJson(res, 200, { ok: true, sessions: items })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    })

    // 删除任务。一次失败的安装会一直占着列表，用户需要能把它清掉。
    register('/dsh-dev-env/api/jobs/delete', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      if (body.scope === 'finished') {
        let removed = 0
        for (const [id, job] of [...state.jobs]) {
          if (job.status !== 'running') {
            state.jobs.delete(id)
            removed += 1
          }
        }
        return sendJson(res, 200, { ok: true, removed, jobs: [...state.jobs.values()] })
      }
      const job = state.jobs.get(body.id)
      if (!job) return sendJson(res, 404, { ok: false, error: `未知的任务：${body.id}` })
      // 正在跑的任务不给删：删掉记录不会停掉子进程，只会让用户失去唯一的观察窗口。
      if (job.status === 'running') return sendJson(res, 400, { ok: false, error: '任务仍在运行，等它结束再删' })
      state.jobs.delete(body.id)
      sendJson(res, 200, { ok: true, removed: 1, jobs: [...state.jobs.values()] })
    })

    // 取消任务。能暂停的只有我们自己下载的东西（阶段 4 接入）；托管安装器（winget/pip/npm）
    // 只能取消，而且必须连带收拾干净：杀整棵进程树，删掉我们自己的残片。
    register('/dsh-dev-env/api/jobs/cancel', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      const job = state.jobs.get(body.id)
      if (!job) return sendJson(res, 404, { ok: false, error: `未知的任务：${body.id}` })
      if (job.status !== 'running') return sendJson(res, 400, { ok: false, error: '任务已经结束，不需要取消' })

      job.cancelRequested = true
      job.log.push('收到取消请求')

      // ① 我们自己下载的：中断传输，并按约定删除 .part 与元数据
      const cancelDownload = downloadCancels.get(job.id)
      if (cancelDownload) {
        try {
          cancelDownload()
          job.log.push('已中断下载，并删除未完成的残片')
        } catch (error) {
          job.log.push(`中断下载时出错：${String((error && error.message) || error)}`)
        }
      }

      // ② 外部安装器：杀整棵树
      if (job.pid) {
        const killed = await killTree(job.pid)
        job.log.push(killed ? `已终止进程树（PID ${job.pid}）` : `终止进程树失败（PID ${job.pid}）`)
      }
      for (const child of [...state.children]) {
        if (child.pid === job.pid) {
          try {
            child.kill()
          } catch {
            /* 树已经没了 */
          }
        }
      }

      job.status = 'cancelled'
      job.phase = null
      job.endedAt = Date.now()
      // 诚实说明清理边界：我们的残片删掉了，安装器自己的缓存删不掉。
      job.cleanup = cancelDownload ? 'partial-removed' : 'external-cache-untouched'
      sendJson(res, 200, { ok: true, job, jobs: [...state.jobs.values()] })
    })

    // 让 DSH 接手两件事：解释一个工具（body.id），或者**诊断一个失败/卡住的任务**（body.jobId）。
    // 后者是用户在详情里按"让 DSH 帮我看看"时用的——日志只弹出到详情里是不够的，
    // 用户要的是有人真的来解决它。
    // sessionController 必须在请求时惰性获取——apply 那一刻它可能还没就绪，
    // 一次性 ctx.get 会拿到 undefined 并且永不重试。
    register('/dsh-dev-env/api/explain', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)

      // 求助模式：把这条任务的实际状态写进提问。
      if (body.jobId) {
        const job = state.jobs.get(body.jobId)
        if (!job) return sendJson(res, 404, { ok: false, error: `未知的任务：${body.jobId}` })
        const data = await scan(state)
        const item = data.items.find((entry) => entry.id === job.itemId) ?? {
          id: job.itemId,
          name: job.name,
          nameEn: null,
        }
        const text = jobHelpPrompt(job, item, body.lang)
        return askDsh({
          req,
          res,
          scope,
          ctx,
          text,
          requestId: `dev-env-help-${randomUUID()}`,
          summary: `已让 DSH 诊断任务 ${job.id}`,
          sessionId: sessionIdOf(body),
        })
      }

      // 交接模式：把**整份任务列表**的现状交给另一个（或同一个）对话。
      // 和求助的区别在收件人与意图：这是"这些事正在发生，你需要知道"，不是"帮我修这一条"。
      if (body.handoff) {
        if (!state.jobs.size) return sendJson(res, 400, { ok: false, error: '现在没有任务可以交接' })
        const jobs = [...state.jobs.values()]
        return askDsh({
          req,
          res,
          scope,
          ctx,
          text: jobHandoffPrompt(jobs, body.lang),
          requestId: `dev-env-handoff-${randomUUID()}`,
          summary: `已把 ${jobs.length} 个任务的现状交给会话`,
          sessionId: sessionIdOf(body),
        })
      }

      const data = await scan(state)
      const item = data.items.find((entry) => entry.id === body.id)
      if (!item) return sendJson(res, 404, { ok: false, error: `未知的条目：${body.id}` })
      await askDsh({
        req,
        res,
        scope,
        ctx,
        text: explainPrompt(item, body.lang),
        requestId: `dev-env-explain-${randomUUID()}`,
        summary: `已让 DSH 解释 ${item.name}`,
        sessionId: sessionIdOf(body),
      })
    })

    // 交接：读写**按项目键控**的记录，而不是按对话。
    //
    // 为什么是项目：交接属于"这段工作"，不属于某个对话。同一项目下的任何对话打开它都该看到同一份
    // ——这才是"无论在哪里箱子的内容一样"。而"分支项目要它的全部资料""别的项目要它的经验"这两个
    // 场景，只有项目键控 + 索引才能表达：前者是同一目录，后者靠索引跨目录取用。
    //
    // 项目身份取自会话的 `cwd`（sessionController.list() 会给出），拿不到时退回按会话分开并如实标注。
    register('/dsh-dev-env/api/handoff', async (req, res) => {
      const method = (req.method || 'GET').toUpperCase()
      const file = handoffsFile()

      if (method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost')
        const sessionId = url.searchParams.get('sessionId') || ''
        const projectKey = url.searchParams.get('projectKey') || ''
        const { byProject } = loadRecords(file)

        // 不带身份时返回**索引**：这是"从别的项目取用"的入口（场景 2 与 3）。
        if (!sessionId && !projectKey) {
          return sendJson(res, 200, {
            ok: true,
            file,
            projects: Object.values(byProject)
              .map((row) => ({
                projectKey: row.projectKey,
                projectPath: row.projectPath,
                scope: row.projectScope,
                summary: row.handoff.summary,
                tags: row.tags,
                todo: row.handoff.todo.length,
                doing: row.handoff.doing.length,
                done: row.handoff.done.length,
                updatedAt: row.handoff.updatedAt,
              }))
              .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
          })
        }

        const project = projectKey
          ? { key: projectKey, path: null, scope: 'explicit' }
          : await projectForSession(scope || ctx, sessionId)
        return sendJson(res, 200, {
          ok: true,
          file,
          project,
          record: byProject[project.key] ?? emptyRecord(project),
        })
      }

      if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'GET / POST only' })
      const body = await readJson(req)
      // 来自面板的保存：sessionId 必须显式给出（面板从 conversation.view 的 prop 拿到它）。
      // 没有它就不知道该存给哪个项目，宁可拒绝也不猜。
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
      if (!sessionId) return sendJson(res, 400, { ok: false, error: '缺少 sessionId：不知道该把交接存给哪个项目' })
      const project = await projectForSession(scope || ctx, sessionId)
      const { byProject } = loadRecords(file)
      const record = normaliseRecord(
        Object.assign({}, body.record || body, { lastSessionId: sessionId, tags: body.tags ?? body.record?.tags }),
        project,
      )
      byProject[project.key] = record
      const written = saveRecords(file, byProject)
      if (!written.ok) return sendJson(res, 500, { ok: false, error: `保存失败：${written.error}` })
      sendJson(res, 200, { ok: true, project, record })
    })

    // 能力探测：面板据此决定"A / B"里哪些是可用的，而不是给一个选了会静默失败的选项。
    register('/dsh-dev-env/api/handoff/capability', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const report = await probeAutoFill(scope || ctx, url.searchParams.get('sessionId') || '')
      sendJson(res, 200, { ok: true, capability: report })
    })

    // 一键填充：请**这个对话的模型**把这段工作总结成交接，并调用工具写下来。
    //
    // 为什么是"请模型调用工具"而不是"投一段提示再读回复"：DSH 的 prompt 是单向的，模型的回答是
    // 另一条消息，插件抓不回来。所以让模型把结果**交出来**，内容直接落进项目记录，面板下一次轮询
    // 自然看到——这也正是 DSH 自己压缩上下文时的做法（它替换历史，而不是把文本还给调用方）。
    register('/dsh-dev-env/api/handoff/fill', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
      if (!sessionId) return sendJson(res, 400, { ok: false, error: '缺少 sessionId：不知道要总结哪个对话' })

      const capability = await probeAutoFill(scope || ctx, sessionId)
      const method = body.method === 'fork' ? 'fork' : body.method === 'compact' ? 'compact' : 'current'
      // 选了 B 但 B 不可用时**明确报错**，不静默退回 A：两者代价不同（B 会就地改写这段对话），
      // 悄悄替换等于在用户没同意的情况下做了另一件事。
      if (method === 'compact' && !capability.canCompact) {
        return sendJson(res, 400, {
          ok: false,
          error: `这个环境里 compaction 不可用，无法用压缩方式总结（${capability.detail.join('；') || '缺少服务'}）。可以改用"用当前对话总结"或"用子智能体总结"。`,
        })
      }
      if (method === 'fork' && !capability.canSubagentFill) {
        return sendJson(res, 400, { ok: false, error: '这个环境里没有会继承对话上下文的子智能体 provider，无法用它总结。' })
      }

      // **fork 子智能体**：它带有父对话的上下文（provider 声明 inheritsParentContext），
      // 所以能真读到这段对话，而**不占用主对话的上下文**——那正是用户要的。
      // 它的输出由宿主解析落盘，**不再经过模型的 JSON 参数**：那条通道刚坏过一次。
      if (method === 'fork') {
        const agents = getService(scope || ctx, 'agents')
        const subagents = getService(scope || ctx, 'subagents')
        if (!subagents || typeof subagents.start !== 'function') {
          return sendJson(res, 503, { ok: false, error: '子智能体服务不可用' })
        }
        const parent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
        if (!parent) {
          // 没有活着的 agent 就没有"父"可继承。如实说明，而不是换一条路悄悄做别的事。
          return sendJson(res, 400, {
            ok: false,
            error: '这个对话当前没有活着的 agent，子智能体无法继承它的上下文。可以先用"用当前对话总结"。',
          })
        }
        const provider = capability.subagentProviders.find((row) => row.inheritsParentContext)
        const abort = new AbortController()
        try {
          const run = await subagents.start(provider.name, {
            label: 'dev-env 条例填充',
            // `expectText`：这条路上子智能体**返回文本**，宿主负责写入。提示词与工具过滤必须与之一致，
            // 否则子智能体照另一条路的指示去调用工具、只回一句"已写入"，而宿主在等文本——解析失败。
            prompt: [{ type: 'text', text: handoffFillPrompt(body.lang, { expectText: true }) }],
            parent,
            signal: abort.signal,
            // 禁掉写入类工具：一是"一个写入者"，二是避免子智能体顺手改动本机的其他东西。
            toolFilter: {
              deny: ['dev_env_handoff_write', 'dev_env_tasks', 'write', 'edit', 'bash', 'terminal_open', 'terminal_signal'],
            },
          })
          try {
            const result = await run.result
            const text = (result.output || [])
              .map((block) => (block && block.type === 'text' ? block.text : ''))
              .filter(Boolean)
              .join('\n')
            const parsed = parseSummary(text)
            if (!parsed) {
              // 把子智能体到底说了什么带出来。只说"没有产出可解析的摘要"会让人无从判断是它没写、
              // 还是写了格式不对——而这正是排查要分清的两件事。
              const head = text.replace(/\s+/g, ' ').slice(0, 300)
              return sendJson(res, 502, {
                ok: false,
                error: `子智能体返回的内容解析不出五节结构。它说的是："${head || '(空)'}"。可以重试，或改用「用当前对话总结」。`,
                raw: text.slice(0, 500),
              })
            }
            const file = handoffsFile()
            const { byProject } = loadRecords(file)
            const project = await projectForSession(scope || ctx, sessionId)
            const record = recordFromSummary(parsed, byProject[project.key], project)
            record.lastSessionId = sessionId
            byProject[project.key] = record
            const written = saveRecords(file, byProject)
            if (!written.ok) return sendJson(res, 500, { ok: false, error: written.error })
            return sendJson(res, 200, {
              ok: true,
              via: 'fork',
              project,
              record,
              summary: '已由子智能体写条例',
            })
          } finally {
            // 运行结束就释放，避免子智能体常驻。
            await run.dispose().catch(() => {})
          }
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: `子智能体失败：${String((error && error.message) || error)}` })
        }
      }

      const text = handoffFillPrompt(body.lang)
      return askDsh({
        req,
        res,
        scope,
        ctx,
        text,
        requestId: `dev-env-fill-${randomUUID()}`,
        summary: '已请 DSH 把这段工作写成条例',
        sessionId,
      })
    })

    // 把**某个项目**的条例投递给一个对话：手动传递与自动带入都走这里。
    //
    // `automatic` 只影响措辞：手动的说"用户要求带上"，自动的说"这个项目被设置为自动带入"。
    // 两者都是一条**普通消息**，所以用户能看见、能撤销——而不是偷偷塞进上下文。
    register('/dsh-dev-env/api/handoff/send', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      const file = handoffsFile()
      const { byProject } = loadRecords(file)
      // 来源可以按项目键给（索引里选一个），也可以按会话给（面板只知道自己是哪个会话）。
      const from = typeof body.projectKey === 'string' ? body.projectKey.trim() : ''
      const fromSession = typeof body.from === 'string' ? body.from.trim() : ''
      const project = from
        ? { key: from, path: null, scope: 'explicit' }
        : await projectForSession(scope || ctx, fromSession)
      const record = byProject[project.key]
      if (!record) {
        return sendJson(res, 404, { ok: false, error: `这个项目还没有项目条例：${project.key || '(未指定)'}` })
      }
      const text = clausePrompt(record.handoff, body.lang, { automatic: body.automatic === true })
      if (!text) return sendJson(res, 400, { ok: false, error: '这份条例还是空的，先写点内容再传递' })
      const target = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
      return askDsh({
        req,
        res,
        scope,
        ctx,
        text,
        requestId: `dev-env-clause-${randomUUID()}`,
        summary: `已把项目条例交给会话`,
        sessionId: target || undefined,
      })
    })

    // 输入框上方的手动传递：列出所有有条例的项目，供"带上哪一份"。
    // 返回索引而不是全文——全文由 send 时再渲染，避免把大段内容推给页面。
    register('/dsh-dev-env/api/handoff/projects', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') || ''
      const { byProject } = loadRecords(handoffsFile())
      const current = sessionId ? await projectForSession(scope || ctx, sessionId) : null
      sendJson(res, 200, {
        ok: true,
        currentKey: current ? current.key : null,
        projects: Object.values(byProject)
          .map((row) => ({
            projectKey: row.projectKey,
            projectPath: row.projectPath,
            scope: row.projectScope,
            summary: row.handoff.summary,
            tags: row.tags,
            open: [...(row.handoff.todo || []), ...(row.handoff.doing || [])].filter((task) => !task.done).length,
            updatedAt: row.handoff.updatedAt,
            // 当前对话所在项目的那一份排在最前：多数时候用户要的就是它。
            isCurrent: current ? row.projectKey === current.key : false,
          }))
          .sort((a, b) => (a.isCurrent === b.isCurrent ? (b.updatedAt ?? 0) - (a.updatedAt ?? 0) : a.isCurrent ? -1 : 1)),
      })
    })

    // 自动带入：新对话开始时，如果这个项目有条例且开关打开，就把条例作为大前提投进去。
    //
    // **默认关闭**（见设置）：它每次都花 token，而过时的前提比没有前提更糟。
    // 面板在会话刚建立时调它，所以走的是一条**普通消息**——用户看得见，也能撤销。
    register('/dsh-dev-env/api/handoff/seed', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
      if (!sessionId) return sendJson(res, 400, { ok: false, error: '缺少 sessionId' })
      const settings = loadSettings(settingsFile())
      if (settings['handoff.autoInject'] !== true) {
        return sendJson(res, 200, { ok: true, injected: false, reason: '自动带入未开启' })
      }
      const { byProject } = loadRecords(handoffsFile())
      const project = await projectForSession(scope || ctx, sessionId)
      const record = byProject[project.key]
      if (!record) return sendJson(res, 200, { ok: true, injected: false, reason: '这个项目还没有条例' })
      const text = clausePrompt(record.handoff, body.lang, { automatic: true })
      if (!text) return sendJson(res, 200, { ok: true, injected: false, reason: '条例还是空的' })
      return askDsh({
        req,
        res,
        scope,
        ctx,
        text,
        requestId: `dev-env-seed-${randomUUID()}`,
        summary: `已自动带入 ${project.path || project.key} 的项目条例`,
        sessionId,
      })
    })

    // 说明书：设置页与 dev_env_manual 工具读的是**同一份数据**（manual.js），
    // 所以界面与模型看到的说明不可能不一致。
    register('/dsh-dev-env/api/manual', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh'
      const section = url.searchParams.get('section') || null
      // 指定了节就顺带把纯文本版本一起给出，方便"复制给别的对话"这类用法。
      const text = section ? manualText(lang, section) : null
      sendJson(res, 200, { ok: true, manual: manualView(lang), text })
    })

    // 状态页签的数据。与 dev_env_state 工具**同一个测量函数**，所以数字不会不一致。
    // 页签是只读展示：它不写任何东西，也不参与判断——判断在用户手里。
    register('/dsh-dev-env/api/state', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') || ''
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh'
      if (!sessionId) return sendJson(res, 400, { ok: false, error: '缺少 sessionId' })
      const measured = measureState(scope || ctx, sessionId, lang)
      if (!measured.ok) return sendJson(res, 503, measured)
      // 页面需要档位文案与清单全文，工具用不到那部分，所以在这里补上而不是塞进工具输出。
      sendJson(res, 200, { ok: true, state: Object.assign({}, measured, { bands: PRESSURE_BANDS, checklist: SYMPTOMS }) })
    })

    // 用户设置：读取与保存。设置页（settings.section）用它渲染，其余功能用它决定默认行为。
    register('/dsh-dev-env/api/settings', async (req, res) => {
      const method = (req.method || 'GET').toUpperCase()
      const file = settingsFile()
      if (method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost')
        return sendJson(res, 200, { ok: true, settings: settingsView(file, url.searchParams.get('lang')) })
      }
      if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'GET / POST only' })
      const body = await readJson(req)
      // 只写入已知键（normaliseSettings 会丢弃其余），所以页面无法把任意结构塞进这个文件。
      if (!saveSettings(file, body.values)) {
        return sendJson(res, 500, { ok: false, error: `保存失败：${file || '(没有可用的存储位置)'}` })
      }
      // 保存后读回一次，让调用方看到**实际生效**的值而不是它提交的值——两者可能不同（类型不符会被
      // 回落到默认），而调用方需要知道这一点。
      sendJson(res, 200, { ok: true, settings: settingsView(file, body.lang) })
    })

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => registerRoutes(scope))
  } else {
    // 极老版本没有 ctx.inject：退回一次性尝试（热加载场景仍然可用）
    effect(ctx, () => registerRoutes(ctx), 'dsh-dev-env: http routes')
  }

  // -------------------------------------------------- Agent Tools
  effect(
    ctx,
    () =>
      ctx.tools.register({
        name: 'dev_env_inventory',
        description:
          '扫描本机已安装的开发/测试环境（语言运行时、IDE、测试工具、数据库与中间件、构建工具），返回精确版本、安装路径，以及与完整工具链目录比对后"缺什么"和对应的补齐命令。默认带 60 秒缓存，refresh=true 强制重新扫描。写代码或跑测试前先调用它，可以避免对不存在的编译器/运行时做出错误假设。',
        parameters: {
          type: 'object',
          properties: {
            refresh: { type: 'boolean', description: '忽略缓存，强制重新探测（约 3-8 秒）' },
            only: {
              type: 'string',
              enum: ['all', 'missing', 'installed'],
              description: '只返回缺失项 / 已装项，默认 all',
            },
            category: {
              type: 'string',
              enum: ['language', 'ide', 'test', 'data', 'tool'],
              description: '只返回某一类，省略则返回全部',
            },
            verbose: { type: 'boolean', description: '为 true 时在文本结果里逐条列出全部工具，默认只列缺失项' },
          },
          additionalProperties: false,
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (args, value) => [
            { type: 'text', text: renderInventory(value, { full: args && args.verbose === true }) },
          ],
        },
        async execute(args) {
          const options = args && typeof args === 'object' ? args : {}
          const data = await scan(state, { force: options.refresh === true })
          let items = data.items
          if (options.only === 'missing') items = items.filter((item) => !item.installed)
          else if (options.only === 'installed') items = items.filter((item) => item.installed)
          if (options.category) items = items.filter((item) => item.category === options.category)
          return {
            scannedAt: data.scannedAt,
            platform: data.platform,
            host: data.host,
            summary: data.summary,
            categories: data.categories,
            // Agent 需要知道"这次扫描额外搜过哪些目录"，否则它无法解释某个工具为什么在/不在，
            // 也无法建议用户去面板里指一个目录。
            roots: data.roots,
            items: items.map((item) => ({
              id: item.id,
              name: item.name,
              nameEn: item.nameEn,
              category: item.category,
              essential: item.essential,
              installed: item.installed,
              version: item.version,
              where: item.where,
              reason: item.reason,
              debug: item.debug,
              hint: item.hint,
              plans: item.plans,
            })),
          }
        },
      }),
    'dsh-dev-env: tool dev_env_inventory',
  )

  effect(
    ctx,
    () =>
      ctx.tools.register({
        name: 'dev_env_install',
        description:
          '为本机补齐一个缺失的开发/测试工具链。mode=auto 时优先用 winget，其次 npm / pip，都不行则打开官方下载页。mode=command 只返回将要执行的命令而不执行。安装是长任务：返回 job 信息，之后用 dev_env_job 查询进度与日志。会改变本机软件环境，仅在用户明确要求时调用。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'dev_env_inventory 返回的条目 id，例如 gcc / git / cmake' },
            mode: {
              type: 'string',
              enum: ['auto', 'winget', 'npm', 'pip', 'page', 'command'],
              description: '安装方式；auto 为默认，command 只预览命令',
            },
          },
          required: ['id'],
          additionalProperties: false,
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        async execute(args) {
          const id = args && args.id
          if (typeof id !== 'string' || !id) throw new Error('id 必填')
          const data = await scan(state)
          const item = data.items.find((entry) => entry.id === id)
          if (!item) throw new Error(`未知的条目 id：${id}`)
          if (item.installed) {
            return {
              summary: `${item.name} 已经安装（${item.version ?? '版本未知'}），无需补齐。`,
              alreadyInstalled: true,
              version: item.version,
            }
          }
          if (args.mode === 'command') {
            return {
              summary: `【预览】${item.name} 的可用补齐方式：\n` + item.plans.map((plan) => `- ${plan.mode}: ${plan.label}`).join('\n'),
              plans: item.plans,
              executed: false,
            }
          }
          const plan = choosePlan(plansFor(item, { wingetReady: item.wingetUsable }), args.mode)
          if (!plan) throw new Error(`没有可用的安装方案（mode=${args.mode || 'auto'}）`)
          const job = startJob(state, item, plan)
          return {
            summary: `已启动补齐任务：${item.name} · ${plan.label}\n任务 id=${job.id}，状态=${job.status}${
              job.status === 'failed' ? `，错误=${job.error}` : '。用 dev_env_job 查询进度。'
            }`,
            job: { id: job.id, itemId: job.itemId, name: job.name, mode: job.mode, status: job.status, error: job.error },
          }
        },
      }),
    'dsh-dev-env: tool dev_env_install',
  )

  effect(
    ctx,
    () =>
      ctx.tools.register({
        name: 'dev_env_job',
        description: '查询 dev_env_install 启动的补齐任务：状态、退出码与最近日志。省略 jobId 时返回最近的若干任务。',
        parameters: {
          type: 'object',
          properties: {
            jobId: { type: 'string', description: '任务 id；省略则列出最近任务' },
            tailLines: { type: 'number', description: '每个任务返回的日志尾部行数，默认 30' },
          },
          additionalProperties: false,
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        async execute(args) {
          const tail = Math.max(1, Math.min(200, Number(args && args.tailLines) || 30))
          if (args && args.jobId) {
            const job = state.jobs.get(args.jobId)
            if (!job) throw new Error(`没有这个任务：${args.jobId}`)
            return {
              summary: `任务 ${job.id} · ${job.name} · ${job.mode}\n状态=${job.status} 退出码=${job.exitCode ?? '-'}${
                job.error ? `\n错误=${job.error}` : ''
              }\n--- 日志尾部 ${tail} 行 ---\n${job.log.slice(-tail).join('\n') || '(无输出)'}`,
              job: { ...job, log: job.log.slice(-tail) },
            }
          }
          const jobs = [...state.jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 10)
          return {
            summary: jobs.length
              ? jobs
                  .map(
                    (job) =>
                      `- ${job.id}  ${job.status.padEnd(9)}  ${job.name}  (${job.mode})${job.error ? ` 错误=${job.error}` : ''}`,
                  )
                  .join('\n')
              : '还没有任何补齐任务。',
            jobs: jobs.map((job) => ({ ...job, log: job.log.slice(-tail) })),
          }
        },
      }),
    'dsh-dev-env: tool dev_env_job',
  )

  // 让模型把**交接**写下来。这是"一键填充"能成立的唯一方式。
  //
  // 为什么需要它：DSH 的 prompt 是**单向**的——投进去之后模型的回答是另一条消息，插件抓不回来，
  // 所以无法"投一段提示然后读回复"。DSH 自己的做法是让模型**调用工具**把结果交出来（compaction
  // 也是替换历史，而不是把文本还给我）。所以这里注册一个写入动作：面板发一句提示，模型读完对话
  // 后调用本工具，内容就落进了那份项目记录里，面板下一次轮询自然看到。
  effect(
    ctx,
    () =>
      ctx.tools.register({
        name: 'dev_env_handoff_write',
        description:
          '把当前工作的交接（continuation summary）写入 dsh-dev-env 的项目记录，供之后在别的对话里接着做或供别的项目取用。按 DSH 压缩摘要的五节结构填写。只在用户要求生成/更新交接时调用。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', description: '1. Task Overview：用户的核心请求与成功标准、明确的约束' },
            done: {
              type: 'array',
              items: { type: 'string' },
              description: '2. Current State：已完成什么、涉及的文件与路径、产出物',
            },
            discoveries: { type: 'string', description: '3. Important Discoveries：技术约束、决策与理由、错误及解决、试过但不成的方法' },
            todo: {
              type: 'array',
              items: { type: 'string' },
              description: '4. Next Steps：具体待办，按优先级排列',
            },
            doing: { type: 'array', items: { type: 'string' }, description: '4. Next Steps：正在进行中的项' },
            next: { type: 'string', description: '4. Next Steps：紧接着的下一步（一句话）' },
            preserve: { type: 'string', description: '5. Context to Preserve：用户偏好与风格、不明显的领域细节、做过的承诺' },
          },
          required: ['summary'],
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (args, value) => [
            {
              type: 'text',
              text: value && value.ok
                ? `已写入 ${value.projectPath || value.projectKey} 的交接（${value.todo} 项待办 / ${value.done} 项已完成）。面板的「交接」页签会显示它。`
                : `写入失败：${(value && value.error) || '未知原因'}`,
            },
          ],
        },
        async execute(args, exec) {
          const input = args && typeof args === 'object' ? args : {}
          // 会话身份取自**这次工具调用所属的 agent**（`exec.agent.id`），而不是"当前发起者"：
          // 后者在由插件发起的那一轮里未必是目标会话，用它会把交接写到**错误的项目**上——
          // 而写错项目的交接会被另一个项目读到。
          const sessionId = (exec && exec.agent && exec.agent.id) || null
          // 项目身份**一律按当前会话的工作目录**判定，不再接受模型传路径。
          //
          // 这不是保守，是从一次失败里改的：模型在参数里写 Windows 路径时反斜杠转义出错，
          // 整轮以 `MALFORMED_RESPONSE / tool input is invalid JSON` 结束，**连带同一轮里其它成功的
          // 写入一起作废**。而项目身份本来就能从会话确定，让模型填只是白白引入一个转义风险。
          const project = await projectForSession(ctx, sessionId)
          const file = handoffsFile()
          const { byProject } = loadRecords(file)
          const previous = byProject[project.key]
          const record = normaliseRecord(
            {
              // 保留已有标签：写入内容不该顺手抹掉用户打过的标签。
              tags: previous ? previous.tags : [],
              lastSessionId: sessionId,
              summary: input.summary,
              done: input.done,
              notes: [input.discoveries, input.preserve].filter(Boolean).join('\n\n'),
              todo: input.todo,
              doing: input.doing,
              next: input.next,
            },
            project,
          )
          byProject[project.key] = record
          const written = saveRecords(file, byProject)
          if (!written.ok) return { ok: false, error: `保存失败：${written.error}` }
          return {
            ok: true,
            projectKey: project.key,
            projectPath: project.path,
            todo: record.handoff.todo.length,
            done: record.handoff.done.length,
          }
        },
      }),
    'dsh-dev-env: tool dev_env_handoff_write',
  )

  /**
   * 项目条例的**任务清单**的读写工具。
   *
   * 存在理由：任务清单是"还要做什么"的唯一事实来源，而 DSH 需要能读到它——否则每开一个新对话，
   * 它都要重新问你"接下来做什么"。同时让 DSH 能**写入**：干活过程中发现的新事项应当当场记下来，
   * 而不是等你想起来再手填。
   *
   * 项目身份**一律取自这次调用所属会话的工作目录**，不接受调用方传路径——上一版让模型传
   * Windows 路径，结果反斜杠转义出错导致整轮 `MALFORMED_RESPONSE`，连带同轮其它成功的写入作废。
   */
  effect(
    ctx,
    () =>
      ctx.tools.register({
        name: 'dev_env_tasks',
        description:
          '读取或修改当前项目条例里的任务清单。任务有稳定 id，顺序即优先级。用它来：看接下来该做什么（action=list）、把新发现的事项记下来（action=add）、勾掉或改一条（action=update）、调整优先级（action=move）、删掉不要的（action=remove）。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'add', 'update', 'move', 'remove', 'clear'],
              description: '要做的操作',
            },
            text: { type: 'string', description: 'action=add / update：任务内容' },
            id: { type: 'string', description: 'action=update / move / remove：任务 id（先用 list 拿到）' },
            done: { type: 'boolean', description: 'action=update：是否已完成' },
            tag: { type: 'string', description: 'action=update / add：任务标签，用于右栏分组' },
            index: { type: 'number', description: 'action=move：目标位置（0 表示排到最前）' },
            list: {
              type: 'string',
              enum: ['todo', 'doing'],
              description: '操作哪个清单，默认 todo',
            },
            doneOnly: { type: 'boolean', description: 'action=clear：只清已完成的' },
          },
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (args, value) => {
            if (!value || value.ok !== true) {
              return [{ type: 'text', text: `失败：${(value && value.error) || '未知原因'}` }]
            }
            const tasks = value.tasks || []
            if (!tasks.length) return [{ type: 'text', text: `${value.projectPath || value.projectKey} 的任务清单是空的。` }]
            const lines = tasks.map((task, i) => `${i + 1}. [${task.done ? 'x' : ' '}] ${task.text}${task.tag ? `  #${task.tag}` : ''}  (${task.id})`)
            return [
              {
                type: 'text',
                text: `${value.projectPath || value.projectKey} 的任务清单（${tasks.length} 项，顺序即优先级）：\n${lines.join('\n')}`,
              },
            ]
          },
        },
        async execute(args, exec) {
          const input = args && typeof args === 'object' ? args : {}
          const sessionId = (exec && exec.agent && exec.agent.id) || null
          const project = await projectForSession(ctx, sessionId)
          if (project.scope === 'unknown') {
            return { ok: false, error: '无法确定当前项目（既没有工作目录也没有会话身份），因此无法读写任务清单' }
          }
          const file = handoffsFile()
          const { byProject } = loadRecords(file)
          const record = byProject[project.key] ?? emptyRecord(project)
          const listName = input.list === 'doing' ? 'doing' : 'todo'
          let tasks = normaliseTasks(record.handoff[listName])
          const action = input.action

          if (action === 'add') {
            const task = normaliseTask({ text: input.text, tag: input.tag }, tasks.length)
            if (!task) return { ok: false, error: '任务内容不能为空' }
            tasks = tasks.concat(task)
          } else if (action === 'update') {
            const found = tasks.find((row) => row.id === input.id)
            if (!found) return { ok: false, error: `找不到任务 ${input.id}（先用 action=list 拿 id）` }
            if (typeof input.text === 'string' && input.text.trim()) found.text = clampText(input.text)
            if (typeof input.done === 'boolean') found.done = input.done
            if (typeof input.tag === 'string') found.tag = input.tag.trim() || null
          } else if (action === 'move') {
            const at = tasks.findIndex((row) => row.id === input.id)
            if (at < 0) return { ok: false, error: `找不到任务 ${input.id}` }
            const target = Math.max(0, Math.min(tasks.length - 1, Number(input.index) || 0))
            const [moved] = tasks.splice(at, 1)
            tasks.splice(target, 0, moved)
          } else if (action === 'remove') {
            const before = tasks.length
            tasks = tasks.filter((row) => row.id !== input.id)
            if (tasks.length === before) return { ok: false, error: `找不到任务 ${input.id}` }
          } else if (action === 'clear') {
            tasks = input.doneOnly === true ? tasks.filter((row) => !row.done) : []
          } else if (action !== 'list') {
            return { ok: false, error: `未知的 action：${action}` }
          }

          if (action !== 'list') {
            record.handoff[listName] = tasks
            record.lastSessionId = sessionId
            byProject[project.key] = record
            const written = saveRecords(file, byProject)
            if (!written.ok) return { ok: false, error: written.error }
          }
          // 两个清单一起返回：只给一个会让人看不到另一半。
          return {
            ok: true,
            projectKey: project.key,
            projectPath: project.path,
            list: listName,
            tasks,
            doing: normaliseTasks(record.handoff.doing),
            todo: normaliseTasks(record.handoff.todo),
          }
        },
      }),
    'dsh-dev-env: tool dev_env_tasks',
  )

  /**
   * 说明书工具。**给 DSH 读的那一份与人看的完全同源**（都来自 manual.js）。
   *
   * 为什么值得单独做一个工具：模型不知道这个插件有什么、边界在哪，就会猜——猜出来的用法会出错，
   * 出错后它会去试更离谱的做法。让它查一份**和界面同源**的说明，比在系统提示里塞一大段更省，也比
   * 让它自己探索更准。
   */
  effect(
    ctx,
    () =>
      ctx.tools.register({
        name: 'dev_env_manual',
        description:
          '读取 dsh-dev-env 的说明书：它做什么、每个工具（dev_env_inventory / dev_env_install / dev_env_job / dev_env_handoff_write / dev_env_tasks / dev_env_manual / dev_env_state）该怎么用、所有设置项的作用、以及它在这台机器上做不到什么（winget 不可用、github 不通、compaction 不可用、面板不能启动进程）。不确定这个插件能做什么时先读它，不要猜。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            section: {
              type: 'string',
              enum: ['what', 'install', 'clause', 'limits', 'tools'],
              description: '只读某一节，省略则返回全部。limits 那节说明已知边界，最值得先看。',
            },
            lang: { type: 'string', enum: ['zh', 'en'], description: '语言，默认 zh' },
          },
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (args, value) => [
            {
              type: 'text',
              text: value && value.ok === true ? value.text : `读取失败：${(value && value.error) || '未知原因'}`,
            },
          ],
        },
        async execute(args) {
          const input = args && typeof args === 'object' ? args : {}
          return manualText(input.lang === 'en' ? 'en' : 'zh', input.section || null)
        },
      }),
    'dsh-dev-env: tool dev_env_manual',
  )

  /**
   * 智能体状态评估。**只报可测的东西，并明确说清它测不到什么。**
   *
   * 起因是用户问"对话这么长，模型会不会像人一样累"。诚实的回答分两半：
   *   - 模型**没有**疲惫这种体验，也没有内省通道；说"我觉得我累了"是编的。
   *   - 但**上下文会被填满**，而那是可测的：`tokenMeter.measure(session)` 给出当前保留的
   *     token 数，`requestContext()` 给出模型窗口，两者相除就是饱和度。
   *
   * 所以这个工具给的是**硬指标 + 判断题清单**，而不是一个"健康分数"——把分层信号压成一个数字，
   * 会诱发"70 分所以还行"的错觉，而该不该换对话取决于具体征兆。
   */
  effect(
    ctx,
    () =>
      ctx.tools.register({
        name: 'dev_env_state',
        description:
          '评估当前对话的状态：上下文占用百分比（由 tokenMeter 实测的 token 数与模型窗口算出）、保留的消息数、已压缩次数，并列出需要自己判断的行为征兆清单。它**测不出**模型"累不累"——没有那个通道——只能告诉你这个对话还有多少余量，以及该不该先写条例再换对话。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            lang: { type: 'string', enum: ['zh', 'en'], description: '语言，默认 zh' },
          },
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (args, value) => [
            { type: 'text', text: value && value.ok === true ? value.text : `评估失败：${(value && value.error) || '未知原因'}` },
          ],
        },
        async execute(args, exec) {
          const input = args && typeof args === 'object' ? args : {}
          const lang = input.lang === 'en' ? 'en' : 'zh'
          const sessionId = (exec && exec.agent && exec.agent.id) || null
          return measureState(ctx, sessionId, lang)
        },
      }),
    'dsh-dev-env: tool dev_env_state',
  )

  // 卸载时收掉仍在前台跑的安装进程
  return () => {
    for (const child of state.children) {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    state.children.clear()
    state.cache = null
  }
}

// ----------------------------------------------------------------- test surface

/**
 * Test-only surface, used by `scripts/check.mjs`.
 *
 * The self-check has to drive the scanner's real probing (the "a picked folder actually makes the
 * probe match" guard). Probing lives in this module, and the alternatives were both worse: exporting
 * these under ordinary names would widen the plugin's public surface for no user, and copying the
 * logic into the test would create exactly the second implementation this design avoids — the kind
 * that lets a diagnosis disagree with the probe.
 */
export const __test = {
  probeItem,
  probeAtDir,
  scanRoots,
  rootsView,
  normaliseUninstallCommand,
  jobHelpPrompt,
  plansFor,
  wingetReady,
  jobHandoffPrompt,
  sessionIdOf,
  pickDefaultSource,
  downloadSourcesOf,
  projectKeyOf,
  deEscapePath,
  normaliseTask,
  normaliseTasks,
  clampText,
  normaliseRecord,
  emptyRecord,
  handoffFillPrompt,
  probeAutoFill,}

// ----------------------------------------------------------------- http helpers

function sendJson(res, code, value) {
  let body
  try {
    body = JSON.stringify(value)
  } catch (error) {
    body = JSON.stringify({ ok: false, error: `序列化失败：${String((error && error.message) || error)}` })
    code = 500
  }
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readJson(req, limit = 128 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        resolve({})
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}
