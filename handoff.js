// 会话交接（handoff）存储。
//
// 存在的理由：一个对话总会到上限。到那时用户需要在新对话里无缝接上，而"接上"需要的是**任务本身
// 的状态**——还需要做什么、什么已经做完、下一步打算怎么做——而不是聊天记录。聊天记录又长又是噪音。
//
// 所以这里存的是**精简结构**，不是摘要：三个清单 + 关键决定 + 下一步。刻意保持小，因为它的用途是
// 被塞进另一个对话的开头，长篇大论在那里只会挤占真正有用的上下文。
//
// **按 sessionId 键控**：每个对话有自己的交接，互相不覆盖。这正是"多对话"的语义——新对话开始时
// 的交接应该是空的（它还没做任何事），而旧对话的交接必须保留下来供接手者读取。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 项目身份：**按目录判定的"末影箱"**。
 *
 * 交接不该属于某个对话，而该属于**这段工作**——同一项目下的任何对话打开它都应该看到同一份内容，
 * 这才是"无论在哪里箱子的内容一样"。所以键取自项目的目录，而不是 sessionId。
 *
 * 大小写与结尾分隔符都要归一：Windows 路径不区分大小写，`D:\X` 与 `d:\x\` 是同一个项目，若按字面
 * 比较会让"同一项目"分裂成两条记录。
 *
 * 拿不到目录时**不抛错**，回落到按会话分开：宁可某个环境里退化成旧行为，也不要因为这个功能让插件
 * 出问题。返回值里带 `scope` 说明是哪种情况，界面可以如实显示。
 */
export function projectKeyOf(cwd, sessionId) {
  const raw = typeof cwd === 'string' ? cwd.trim() : ''
  if (raw) {
    const normalized = raw.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
    if (normalized) return { key: `dir:${normalized}`, scope: 'project', path: raw }
  }
  const sid = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : ''
  return sid
    ? { key: `session:${sid}`, scope: 'session', path: null }
    : { key: 'unknown', scope: 'unknown', path: null }
}

/** 这条记录属于哪个项目。存盘时写在顶层，读盘时缺失就按旧记录处理。 */
export function recordProject(record) {
  if (!record || typeof record !== 'object') return null
  const key = typeof record.projectKey === 'string' ? record.projectKey : ''
  if (!key) return null
  return {
    key,
    path: typeof record.projectPath === 'string' ? record.projectPath : null,
    scope: typeof record.projectScope === 'string' ? record.projectScope : 'unknown',
  }
}

/** 上限：交接是要被判读的，不是存档。超了就是没精简。 */
const LIMITS = {
  summary: 2000,
  item: 300,
  items: 50,
  notes: 4000,
}

function clamp(text, max) {
  const value = typeof text === 'string' ? text.trim() : ''
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function clampList(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((row) => (typeof row === 'string' ? clamp(row, LIMITS.item) : ''))
    .filter(Boolean)
    .slice(0, LIMITS.items)
}

/**
 * 归一化一份记录。
 *
 * 顶层是**项目身份**（这条记录属于谁），内容在 `handoff` 里。分成两层是因为它们生命周期不同：
 * 项目不变，而内容会被反复改写。
 */
export function normaliseRecord(input, project) {
  const source = input && typeof input === 'object' ? input : {}
  const body = source.handoff && typeof source.handoff === 'object' ? source.handoff : source
  const identity = project ?? {
    key: typeof source.projectKey === 'string' ? source.projectKey : 'unknown',
    path: typeof source.projectPath === 'string' ? source.projectPath : null,
    scope: typeof source.projectScope === 'string' ? source.projectScope : 'unknown',
  }
  return {
    projectKey: identity.key,
    projectPath: identity.path ?? null,
    projectScope: identity.scope ?? 'unknown',
    // 用途标签：这条记录是干什么用的（传承 / 项目资料 / 可复用经验）。**空数组表示还没打标签**，
    // 插件不会自己填——标签是用户按按钮的动作。
    tags: Array.isArray(source.tags) ? source.tags.filter((row) => typeof row === 'string' && row.trim()).slice(0, 12) : [],
    // 谁写的。项目记录可以被多个对话改写，所以留一个"最后写入者"便于解释来龙去脉。
    lastSessionId: typeof source.lastSessionId === 'string' ? source.lastSessionId : null,
    handoff: normaliseHandoff(body, identity.key),
  }
}

/**
 * 归一化一份交接的内容部分。三个清单的顺序固定，因为面板与提示词都按这个顺序读；
 * 未知字段一律丢弃，避免把调用方塞进来的任意结构存到磁盘上。
 */
export function normaliseHandoff(input, sessionId) {
  const source = input && typeof input === 'object' ? input : {}
  return {
    sessionId: String(sessionId ?? source.sessionId ?? ''),
    // 一句话说明这个对话在干什么——接手者第一眼要看到的东西。
    summary: clamp(source.summary, LIMITS.summary),
    // "还剩什么没做"与"下一步计划"是这份东西的核心，也正是用户点名的两项。
    todo: clampList(source.todo),
    doing: clampList(source.doing),
    done: clampList(source.done),
    next: clamp(source.next, LIMITS.summary),
    notes: clamp(source.notes, LIMITS.notes),
    updatedAt: Date.now(),
  }
}

/** 空交接：一个还没写过任何东西的会话。 */
export function emptyHandoff(sessionId) {
  return {
    sessionId: String(sessionId ?? ''),
    summary: '',
    todo: [],
    doing: [],
    done: [],
    next: '',
    notes: '',
    updatedAt: null,
  }
}

/** 空记录：一个还没写过任何东西的项目。 */
export function emptyRecord(project) {
  const identity = project ?? { key: 'unknown', path: null, scope: 'unknown' }
  return {
    projectKey: identity.key,
    projectPath: identity.path ?? null,
    projectScope: identity.scope ?? 'unknown',
    tags: [],
    lastSessionId: null,
    handoff: emptyHandoff(identity.key),
  }
}

/** 这份交接是否还是空的（面板据此显示"还没写"而不是一张空表）。 */
export function isHandoffEmpty(handoff) {
  if (!handoff) return true
  return (
    !handoff.summary &&
    !handoff.next &&
    !handoff.notes &&
    !handoff.todo.length &&
    !handoff.doing.length &&
    !handoff.done.length
  )
}

/**
 * 读记录表。
 *
 * **旧格式必须继续可读**：1.2.x 之前写的是 `{ bySession: { [sessionId]: handoff } }`。用户机器上可能
 * 已经有这样的文件，直接换格式等于把那部分内容丢掉——而"原有功能不出现无法复现"是这次重构的硬要求。
 * 所以旧条目会被读出来、并**按会话键**放进新结构（`session:<id>`），下一次保存时自然迁移。
 */
export function loadRecords(file) {
  try {
    if (!file || !existsSync(file)) return { byProject: {}, migrated: 0 }
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return { byProject: {}, migrated: 0 }

    const byProject = {}
    for (const [key, value] of Object.entries(parsed.byProject || {})) {
      const project = recordProject(value) ?? { key, path: null, scope: 'unknown' }
      byProject[project.key] = normaliseRecord(value, project)
    }

    let migrated = 0
    for (const [sessionId, value] of Object.entries(parsed.bySession || {})) {
      const identity = { key: `session:${sessionId}`, path: null, scope: 'session' }
      // 新格式里已经有同键记录就不覆盖：新写的比旧的更可信。
      if (!byProject[identity.key]) {
        byProject[identity.key] = normaliseRecord(Object.assign({ lastSessionId: sessionId }, value), identity)
        migrated += 1
      }
    }
    return { byProject, migrated }
  } catch {
    // 读坏了就当没有：交接是辅助信息，不该因为它让整个插件起不来。
    return { byProject: {}, migrated: 0 }
  }
}

export function saveRecords(file, byProject) {
  try {
    if (!file) return false
    mkdirSync(path.dirname(file), { recursive: true })
    // 写新结构，同时**留下空的 bySession**，这样更老的版本读到它至少不会崩。
    writeFileSync(file, JSON.stringify({ version: 2, byProject, bySession: {} }, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 把一份交接渲染成"喂给另一个对话的开场"。
 *
 * 和交接给对话（jobHandoffPrompt）的区别：那条说的是"插件任务正在发生什么"，这条说的是
 * "**我在做什么、还剩什么**"。两者可以同时用，但这条是对话级的。
 */
export function handoffPrompt(handoff, lang) {
  const english = lang === 'en'
  if (isHandoffEmpty(handoff)) return null
  // 核心：用 **DSH 自带的压缩摘要格式**，而不是自己发明一套标记。
  //
  // 依据是 DSH 的 `DEFAULT_SUMMARY_PROMPT`（CompactionControl）——它要求模型产出五节、并
  // "Wrap your summary in <summary></summary> tags"，用途写明是"对话历史将被这段摘要替换"。
  // 交接要做的事**和它一模一样**，所以同构就意味着：新对话收到这份东西，等效于这段历史本来就是
  // 这样被压缩进来的，模型不需要为它重新学一种格式。
  //
  // 节名刻意用英文，和 DSH 原文一致；正文可以是中文。这是 **format 与 content 分层**：
  // 格式两侧都认得，内容各写各的语言。
  // 五节照 DSH 原文的节名与顺序。缺的节宁可**留标题不写内容**，也不省略标题：DSH 的压缩摘要
  // 总是五节齐全，节名缺失会让"这份东西是压缩摘要"这个信号变弱，而信号正是复用它格式的理由。
  const nextSteps = [
    ...handoff.doing.map((row) => `- in progress: ${row}`),
    ...handoff.todo.map((row) => `- ${row}`),
    ...(handoff.next ? [`- next: ${handoff.next}`] : []),
  ]
  const sections = [
    ['1. Task Overview', handoff.summary ? [handoff.summary] : ['(not recorded)']],
    ['2. Current State', handoff.done.length ? handoff.done.map((row) => `- ${row}`) : ['(not recorded)']],
    ['3. Important Discoveries', handoff.notes ? [handoff.notes] : ['(not recorded)']],
    ['4. Next Steps', nextSteps.length ? nextSteps : ['(not recorded)']],
    ['5. Context to Preserve', [`Recorded in a dsh-dev-env handover${handoff.sessionId ? `: ${handoff.sessionId}` : ''}`]],
  ]

  // **只写一份**：内容全部在 `<summary>` 里，前面只留一句说明这块东西是什么、该怎么用。
  // 第一版把内容先用自然语言列一遍、再在 summary 里列一遍，等于让模型把同一件事读两遍——
  // 那正好和"不要重新理解一遍"相反。
  const body = sections.map(([title, lines]) => [title, ...lines].join('\n')).join('\n\n')
  const pointer = english
    ? `I am continuing work from another conversation, which has run out of room. Its summary is below; treat it as established context, and do not re-derive what it lists as already done.`
    : `我在接着另一个对话继续做事，那个对话已经到上限了。它的摘要在下面；请当作已知背景，其中"已做完"的部分不要再重新推一遍。`
  return [pointer, '', '<summary>', body, '</summary>'].join('\n')
}
