/**
 * dsh-dev-env — 用户手动添加的工具根目录
 *
 * 存在的理由：有些工具是「解压到自己的文件夹里」的（JDK 8、JMeter、Tomcat……），注册表里没有、
 * PATH 里也没有，任何固定候选列表都不可能猜到用户放在哪。目录条目已经支持 `%DSH_DEV_ENV_ROOTS%`
 * 这个逃生口，但那是环境变量，`setx` 之后**必须重启 DSH** 才生效。
 *
 * 这个模块把同一件事变成"点一下、立刻生效"：把用户选的目录存到一个 JSON 文件里，扫描时
 * 与环境变量里的根**合并**使用。不重启，不重复实现匹配逻辑——匹配依旧由 host 的探针来做，
 * 这里只负责「记住用户选了什么」和「把这个工具认什么翻译成人话」。
 *
 * 全部是纯函数，除了 load/save 两个显式接收文件路径的函数，所以可以完整离线验证。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 去掉结尾的分隔符并去掉首尾空白。空串、非字符串、以及裸盘符（`D:` / `D:\`）都返回 null。 */
export function normaliseDir(dir) {
  if (typeof dir !== 'string') return null
  const trimmed = dir.trim()
  if (!trimmed) return null
  const stripped = trimmed.replace(/[\\/]+$/, '')
  if (!stripped) return null
  // 裸盘符不是可用的根：`D:\` 会被剥成 `D:`，当候选根用只会得到一个语义含糊的路径。
  // 让它返回 null，选到盘符根目录时就不会悄悄记下一条没用的记录。
  if (/^[A-Za-z]:$/.test(stripped)) return null
  return stripped
}

/** 读用户添加的根。文件缺失或损坏都退化成空数组——记不住不是致命问题。 */
export function loadRoots(file) {
  try {
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.roots) ? parsed.roots : []
    return list.map(normaliseDir).filter(Boolean)
  } catch {
    return []
  }
}

export function saveRoots(file, roots) {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ roots }, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 加一个根。Windows 路径大小写不敏感，所以按小写去重；已存在的会被移到最前，
 * 因为「刚选的那个」最可能是用户接下来要用的。
 */
export function addRoot(roots, dir) {
  const clean = normaliseDir(dir)
  if (!clean) return roots
  const key = clean.toLowerCase()
  const rest = roots.filter((entry) => normaliseDir(entry)?.toLowerCase() !== key)
  return [clean, ...rest]
}

export function removeRoot(roots, dir) {
  const clean = normaliseDir(dir)
  if (!clean) return roots
  const key = clean.toLowerCase()
  return roots.filter((entry) => normaliseDir(entry)?.toLowerCase() !== key)
}

/**
 * 扫描时实际使用的额外根 = 环境变量里的 + 用户添加的（去重）。
 * 环境变量优先，因为它通常由脚本/管理员统一设置；用户添加的排在后面只是展示顺序。
 */
export function mergeRoots(envValue, stored) {
  const fromEnv = String(envValue || '')
    .split(';')
    .map(normaliseDir)
    .filter(Boolean)
  let merged = fromEnv
  for (const dir of stored || []) merged = addRoot(merged, dir)
  return merged
}

/**
 * 把这个工具「凭什么算认出来」翻译成一句人话，用于选错目录时的提示。
 *
 * 返回 null 表示这个条目不适用（不是 pathList）——那种情况下不该给用户显示"选择文件夹"，
 * 因为它认的是注册表或 PATH，选目录不会有用，显示出来只会让人以为插件坏了。
 *
 * 文案里说"工具自己的目录**或**它的上一级"是照着实现写的：探针会把这一层降回父目录再试一次
 * （见 paths.js 的 parentDirStartingPoint），所以两种选法都作数。提示和代码必须说的是同一件事。
 */
export function describeProbeHint(entry) {
  const probe = entry?.probe
  if (!probe || probe.kind !== 'pathList') return null

  const evidence = []
  if (probe.file) evidence.push(`含有 ${probe.file} 文件`)
  for (const required of probe.requires || []) evidence.push(`含有 ${required}`)

  if (evidence.length) {
    const what = evidence.join('、且')
    return `请选择包含该工具的目录本身（${what}），或者它的上一级目录。`
  }
  if (probe.pattern) {
    return `请选择目录名匹配 ${probe.pattern} 的那一层（工具自己的目录），或者它的上一级目录。`
  }
  return '请选择该工具自己的目录，或者它的上一级目录。'
}

/**
 * 给"选错了"这种情况生成一句具体的说明：告诉用户还差什么，而不是笼统地说没找到。
 * `verdict` 由调用方给出，来源是 host 探针对**这一个目录**的真实判定——这里不做第二次判断，
 * 避免出现"诊断说行、探针说不行"的分歧。
 */
export function explainVerdict(entry, verdict) {
  const hint = describeProbeHint(entry)
  if (!hint) return null
  if (verdict && verdict.ok) return `已在该目录识别到 ${entry.name}。`
  const probe = entry.probe
  const missing = []
  if (probe.file) missing.push(`缺少 ${probe.file}`)
  for (const required of probe.requires || []) missing.push(`缺少 ${required}`)
  if (probe.pattern) missing.push(`目录名或文件内容不匹配 ${probe.pattern}`)
  const detail = missing.length ? `（${missing.join('；')}）` : ''
  return `这个目录里没有认出 ${entry.name}${detail}。${hint}`
}
