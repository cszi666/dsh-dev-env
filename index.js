/**
 * dsh-dev-env — host 半边
 *
 * 职责：
 *   1) 扫描本机已安装的语言 / IDE / 测试工具 / 数据库 / 构建工具，给出精确版本；
 *   2) 对比目录（catalog），算出"缺什么"，并给出可执行的补齐命令；
 *   3) 把同一套能力同时暴露给两条调用路径：
 *        · Agent Tool —— dev_env_inventory / dev_env_install / dev_env_job
 *        · HTTP API  —— /dsh-dev-env/api/*（供 Client 面板使用）
 *      两者共用下面这些函数，不存在第二份逻辑。
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { CATALOG, CATEGORIES } from './catalog.js'
import { expandEnv, expandGlob, safeRead, rootsFile, envRoots, configuredRoots, mentionsRoots, parentDirStartingPoint } from './paths.js'
import { loadRoots, saveRoots, addRoot, removeRoot, normaliseDir, describeProbeHint, explainVerdict } from './roots.js'
import { startDownload, resolveDownload, formatBytes, loadHistory, saveHistory, recordSpeed, inspectPending } from './downloads.js'

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

// ----------------------------------------------------------------- scanned roots

/** Where the panel remembers the folders the user picked. */
function rootsPathOf(state) {
  if (!state.rootsPath) state.rootsPath = rootsFile()
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

      const items = CATALOG.map((entry, index) => {
        const result = results[index] ?? missing('未探测')
        return {
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
          plans: plansFor(entry).map((plan) => ({ mode: plan.mode, label: plan.label, url: plan.url ?? null, note: plan.note ?? null })),
        }
      })

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

/** 把 catalog 里的 install 声明翻译成一组可执行方案，顺序即优先级。 */
function plansFor(item) {
  const source = item.install || {}
  const plans = []
  if (source.winget && process.platform === 'win32') {
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

/** 我们自己下载/解压的目录：跟着 profile 走，不写进插件自己的目录（那是只读的发布物）。 */
function downloadsDir() {
  const file = rootsFile()
  if (!file) return path.join(os.tmpdir(), 'dsh-dev-env-downloads')
  return path.join(path.dirname(file), 'downloads')
}

function speedHistoryFile() {
  const file = rootsFile()
  if (!file) return null
  return path.join(path.dirname(file), 'download-speeds.json')
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
    job.log.push(`下载源：${plan.download.listing ?? plan.download.direct ?? '(未声明)'}`)

    const resolved = await resolveDownload(plan.download)
    if (!resolved) {
      job.log.push('没有解析到可下载的文件（列表不可用，或所有候选都返回了错误状态码）')
      return finish('failed', '找不到可下载的文件')
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
  child.on('error', (error) => {
    state.children.delete(child)
    job.status = 'failed'
    job.error = String((error && error.message) || error)
    job.endedAt = Date.now()
  })
  child.on('close', (code) => {
    state.children.delete(child)
    if (job.status === 'running') {
      job.exitCode = code
      job.status = code === 0 ? 'succeeded' : 'failed'
      job.endedAt = Date.now()
      if (code !== 0) job.error = `安装进程退出码 ${code}`
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
      const plan = choosePlan(plansFor(item), body.mode)
      if (!plan) return sendJson(res, 400, { ok: false, error: `没有可用的安装方案（${body.mode || 'auto'}）` })
      const job = startJob(state, item, plan)
      sendJson(res, 200, { ok: true, job, plans: item.plans })
    })

    register('/dsh-dev-env/api/open', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      if (!openExternal(body.url)) return sendJson(res, 400, { ok: false, error: '仅支持 http(s) 链接' })
      sendJson(res, 200, { ok: true })
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

    // 让 DSH 自己解释一个工具：把一条提问投进最近活跃的那个会话。
    // sessionController 必须在请求时惰性获取——apply 那一刻它可能还没就绪，
    // 一次性 ctx.get 会拿到 undefined 并且永不重试。
    register('/dsh-dev-env/api/explain', async (req, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const body = await readJson(req)
      const data = await scan(state)
      const item = data.items.find((entry) => entry.id === body.id)
      if (!item) return sendJson(res, 404, { ok: false, error: `未知的条目：${body.id}` })
      const sessions = getService(scope || ctx, 'sessionController')
      if (!sessions || typeof sessions.prompt !== 'function') {
        return sendJson(res, 503, { ok: false, error: '当前 DSH 没有可用的会话服务' })
      }
      const abort = new AbortController()
      try {
        const listed = await sessions.list({}, abort.signal)
        const rows = (listed && listed.items) || []
        // list() 按活跃度排序，第一个可用且非空白的会话就是用户正在看的那个。
        const target = rows.find((row) => row.agentAvailable && !row.blank)
        if (!target) return sendJson(res, 409, { ok: false, error: '没有找到可以提问的会话' })
        await sessions.prompt(
          {
            requestId: `dev-env-explain-${randomUUID()}`,
            sessionId: target.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: explainPrompt(item, body.lang) }],
          },
          abort.signal,
        )
        sendJson(res, 200, { ok: true, sessionId: target.sessionId, summary: `已让 DSH 解释 ${item.name}` })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
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
          const plan = choosePlan(plansFor(item), args.mode)
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
}

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
