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
  const raw = typeof cwd === 'string' ? deEscapePath(cwd) : ''
  if (raw) {
    const normalized = raw.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
    if (normalized) return { key: `dir:${normalized}`, scope: 'project', path: raw }
  }
  const sid = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : ''
  return sid
    ? { key: `session:${sid}`, scope: 'session', path: null }
    : { key: 'unknown', scope: 'unknown', path: null }
}

/**
 * 把被 JSON 转义坏掉的 Windows 路径还原。
 *
 * 起因是一次真实失败：模型在工具参数里把 `D:\x\y` 写成了 `D:\\x\\y`，整轮以
 * `MALFORMED_RESPONSE / tool input is invalid JSON` 结束——**连带那一轮里其它成功的写入一起作废**。
 * 真正的 Windows 路径里**不会出现连续两个反斜杠**，所以折叠它是安全的，而不是在猜。
 */
export function deEscapePath(value) {
  let text = String(value).trim()
  // 反复折叠：转义可能叠了几层（字符串里的 `\\\\` 就是两个反斜杠）。
  for (let i = 0; i < 4 && text.includes('\\\\'); i += 1) text = text.replace(/\\\\/g, '\\')
  return text
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

/**
 * 单条任务文本的上限。导出给宿主用——**不在 index.js 里再写一份**：
 * 两处上限一旦不同步，面板存进去的文字会被工具截断，而用户看到的是自己写的内容变了。
 */
export function clampText(text) {
  return clamp(text, LIMITS.item)
}

function clampList(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((row) => (typeof row === 'string' ? clamp(row, LIMITS.item) : ''))
    .filter(Boolean)
    .slice(0, LIMITS.items)
}

/**
 * 一条任务：**结构化的对象**，不是字符串。
 *
 * 为什么必须带 id：拖动排序与删除都要有稳定身份。若按文本或下标标识，一旦两条任务文字相同、
 * 或拖动后下标变化，操作就会落到错误的那一条上——而用户看不出来。
 */
export function normaliseTask(input, index) {
  const source = typeof input === 'string' ? { text: input } : input && typeof input === 'object' ? input : {}
  const text = clamp(source.text, LIMITS.item)
  if (!text) return null
  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim().slice(0, 64) : `t${index + 1}`,
    text,
    // `done` 是任务自己的状态，和"哪一栏"无关：右栏显示未完成，左栏"已完成"是项目级的成果记录。
    done: source.done === true,
    // 每个任务可以带一个标签，右栏据此分组；没打标签的归到「未分类」。
    tag: typeof source.tag === 'string' && source.tag.trim() ? source.tag.trim().slice(0, 40) : null,
  }
}

/**
 * 归一化任务列表，并**兼容两种历史形态**：
 *   - 旧：`['一件事', '另一件']`（字符串数组）
 *   - 新：`[{ id, text, done, tag }]`
 * 旧形态必须继续能读——用户已有记录里就是字符串，丢掉它们等于破坏"原有功能可复现"的承诺。
 * 旧字符串会得到生成出来的 id，并在下一次保存时自然升级。
 */
export function normaliseTasks(input) {
  if (!Array.isArray(input)) return []
  const tasks = []
  for (const row of input) {
    const task = normaliseTask(row, tasks.length)
    if (task) tasks.push(task)
  }
  // id 去重：生成出来的 id 可能与显式传入的撞车，撞了会让拖动操作落到错的那条上。
  const seen = new Set()
  for (let i = 0; i < tasks.length; i += 1) {
    while (seen.has(tasks[i].id)) tasks[i].id = `${tasks[i].id}-${i + 1}`
    seen.add(tasks[i].id)
  }
  return tasks.slice(0, LIMITS.items)
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
    //
    // `todo` 与 `doing` 现在是**结构化任务**（带 id，支持拖动排序与删除）；`done` 保持字符串数组，
    // 因为它是项目级的**成果记录**，不参与勾选与排序，升级它只会增加迁移面而没有收益。
    todo: normaliseTasks(source.todo),
    doing: normaliseTasks(source.doing),
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
      const record = normaliseRecord(value, project)
      // **保留存盘时的 updatedAt**。`normaliseRecord` 会把内容层的时间戳设成"现在"，那是写入时的
      // 语义；如果读取时也这样，每条记录的"最后更新"就永远等于查询时刻——索引排序全部失效，而且
      // 无法用时间判断"刚才那次填充到底写了没有"。这是真机上量出来的：两条记录时间戳同秒。
      const stored = value && value.handoff && typeof value.handoff.updatedAt === 'number' ? value.handoff.updatedAt : null
      if (stored !== null) record.handoff.updatedAt = stored
      byProject[project.key] = record
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

/**
 * 保存记录。返回 `{ ok, error }` 而不是布尔值——**这是从一次真实排查里改的**。
 *
 * 原来失败只回 `false`，调用方于是报出"没有可用的存储位置"，而真正的原因是建目录被拒绝。
 * 两种完全不同的故障共用一句含糊的提示，把排查引向了错误的方向：明明路径解析正常，
 * 却让人去查环境变量。
 */
export function saveRecords(file, byProject) {
  if (!file) return { ok: false, error: '没有解析出存储位置（DSH_PROFILE_DIR 与 DSH_HOME 都不可用）' }
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    // 写新结构，同时**留下空的 bySession**，这样更老的版本读到它至少不会崩。
    writeFileSync(file, JSON.stringify({ version: 2, byProject, bySession: {} }, null, 2), 'utf8')
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: `写入 ${file} 失败：${String((error && error.message) || error)}` }
  }
}

/**
 * 从一段文本里解析出交接的五节内容。**刻意做成容错的纯文本解析**，而不是要求 JSON。
 *
 * 起因是一次真实失败：模型在工具参数里拼 JSON 时反斜杠转义出错，整轮以
 * `MALFORMED_RESPONSE / tool input is invalid JSON` 结束，连带同一轮里其它成功的写入一起作废。
 * 所以这条路**不再经过模型的 JSON**：子智能体写自然文本，解析在宿主侧完成，容忍缺节、缺标题、
 * 大小写与编号差异——宁可少解析一节，也不要因为格式差一点就整份丢掉。
 */
export function parseSummary(text) {
  const raw = typeof text === 'string' ? text : ''
  if (!raw.trim()) return null
  // 优先取 <summary> 块；没有就整段当正文——DSH 的压缩摘要带标记，但子智能体可能不带。
  const block = /<summary>([\s\S]*?)<\/summary>/i.exec(raw)
  const body = (block ? block[1] : raw).trim()
  const out = { summary: '', done: [], discoveries: '', todo: [], doing: [], next: '', preserve: '' }
  // 五节的标题在 DSH 原文里是英文编号；同时认中文标题，因为正文语言由用户决定。
  const heads = [
    ['summary', /^\s*(?:1\.|一[、.]|#+\s*)?\s*(?:Task Overview|任务概述|目标)/i],
    ['done', /^\s*(?:2\.|二[、.]|#+\s*)?\s*(?:Current State|当前状态|已完成)/i],
    ['discoveries', /^\s*(?:3\.|三[、.]|#+\s*)?\s*(?:Important Discoveries|重要发现|经验)/i],
    ['nextSteps', /^\s*(?:4\.|四[、.]|#+\s*)?\s*(?:Next Steps|下一步)/i],
    ['preserve', /^\s*(?:5\.|五[、.]|#+\s*)?\s*(?:Context to Preserve|需要保留)/i],
  ]
  const buckets = { summary: [], done: [], discoveries: [], nextSteps: [], preserve: [] }
  let current = null
  // 标题出现**之前**的内容不能丢：子智能体完全可能只给一份列表、不写标题，
  // 而"没有标题就把全部内容丢掉"会让一次成功的总结变成空记录。
  const intro = []
  for (const line of body.split(/\r?\n/)) {
    const head = heads.find(([, re]) => re.test(line))
    if (head) {
      current = head[0]
      // 标题行本身可能带内容（`1. Task Overview: 做了 X`），冒号后的部分要留下。
      const rest = line.replace(/^[^:：]*[:：]/, '').trim()
      if (rest && rest !== line.trim()) buckets[current].push(rest)
      continue
    }
    if (current) buckets[current].push(line)
    else intro.push(line)
  }
  // 标题前的内容按"列表项 vs 段落"分流：列表项是任务，段落是概述。
  for (const line of intro) {
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) buckets.nextSteps.push(line)
    else buckets.summary.push(line)
  }
  const join = (rows) => rows.join('\n').trim()
  out.summary = join(buckets.summary)
  out.discoveries = join(buckets.discoveries)
  out.preserve = join(buckets.preserve)

  // 清单行：`- xxx` / `* xxx` / `1. xxx`。已勾选的 `- [x]` 归到 done，未勾选的归到 todo。
  const classify = (rows) => {
    for (const line of rows) {
      const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
      if (!bullet) continue
      let text = bullet[1].trim()
      if (!text) continue
      // `[x]` / `[ ]` 两种勾选写法。
      const tick = /^\[(x|X|\s)\]\s*(.*)$/.exec(text)
      let done = false
      if (tick) {
        done = tick[1].toLowerCase() === 'x'
        text = tick[2].trim()
      }
      // `in progress:` 前缀来自渲染器，解析时还原成归属信息。
      const progress = /^in progress[:：]\s*(.*)$/i.exec(text)
      if (progress) {
        out.doing.push(progress[1].trim())
        continue
      }
      const nextMark = /^next[:：]\s*(.*)$/i.exec(text)
      if (nextMark) {
        out.next = nextMark[1].trim()
        continue
      }
      if (done) out.done.push(text)
      else out.todo.push(text)
    }
  }
  classify(buckets.nextSteps)
  classify(buckets.done)

  const empty = !out.summary && !out.discoveries && !out.preserve && !out.next && !out.todo.length && !out.done.length && !out.doing.length
  return empty ? null : out
}

/**
 * 把解析出来的五节写成一份记录。**保留已有的任务 id**：按文字匹配，匹配上的沿用原 id 与原顺序，
 * 这样一次自动填充不会把用户手动排好的优先级和刚打的标签冲掉。
 */
export function recordFromSummary(parsed, previous, project) {
  // 容忍传入 null：解析失败时调用方**不应该**被迫先判空——忘了判就会抛，而抛在写入路径上意味着
  // 一次"看起来失败"的填充把已有记录留在半路。这里统一兜成一个空解析结果。
  const source = parsed && typeof parsed === 'object' ? parsed : {}
  const before = previous && previous.handoff ? previous.handoff : {}
  const taskIds = new Map()
  for (const row of [...(before.todo || []), ...(before.doing || [])]) {
    if (row && row.text) taskIds.set(row.text, row.id)
  }
  const asTasks = (rows) =>
    (rows || []).map((text, index) => ({ id: taskIds.get(text) || `a${index + 1}`, text, done: false, tag: null }))
  return normaliseRecord(
    {
      // 标签与已完成记录都保留：自动填充只负责更新"要做什么"，不该抹掉别的层。
      tags: previous ? previous.tags : [],
      lastSessionId: previous ? previous.lastSessionId : null,
      summary: source.summary,
      done: [...(before.done || []), ...(source.done || [])].slice(0, LIMITS.items),
      discoveries: source.discoveries,
      preserve: source.preserve,
      notes: [source.discoveries, source.preserve].filter(Boolean).join('\n\n'),
      todo: asTasks(source.todo),
      doing: asTasks(source.doing),
      next: source.next,
    },
    project,
  )
}

/**
 * 把条例渲染成**项目的大前提**，而不是"我在接着另一个对话"。
 *
 * 与 handoffPrompt 的区别是框架：那个说"历史被这段摘要替换"，适合跨对话传承；这个说"这是这个项目
 * 一直在遵守的约定"，适合在一个项目里一直带着。混用会让模型以为每次都是在续接同一个对话。
 */
export function clausePrompt(handoff, lang, options = {}) {
  const english = lang === 'en'
  if (isHandoffEmpty(handoff)) return null
  const taskText = (row) => (row && typeof row === 'object' ? row.text : String(row))
  const taskDone = (row) => Boolean(row && typeof row === 'object' && row.done === true)
  const open = [...(handoff.doing || []), ...(handoff.todo || [])].filter((row) => !taskDone(row))
  const blocks = english
    ? [
        [`The standing clause for this project is below. Treat it as the project's premise: what it is for, what is already decided, and what is still open.`],
        handoff.summary ? [`What this project is for:\n${handoff.summary}`] : null,
        handoff.done && handoff.done.length ? [`Already done:\n${handoff.done.map((row) => `- ${row}`).join('\n')}`] : null,
        open.length ? [`Still to do:\n${open.map((row) => `- ${taskText(row)}`).join('\n')}`] : null,
        handoff.next ? [`Next step:\n${handoff.next}`] : null,
        handoff.notes ? [`Lessons and traps:\n${handoff.notes}`] : null,
        [`Work from this premise rather than re-deriving it. If something here looks out of date, say so instead of following it blindly.`],
      ]
    : [
        [`下面是这个项目一直在遵守的条例。请把它当作**这个项目的大前提**：它是做什么的、已经定了什么、还有什么没定。`],
        handoff.summary ? [`这个项目要做什么：\n${handoff.summary}`] : null,
        handoff.done && handoff.done.length ? [`已经做完：\n${handoff.done.map((row) => `- ${row}`).join('\n')}`] : null,
        open.length ? [`还需要做：\n${open.map((row) => `- ${taskText(row)}`).join('\n')}`] : null,
        handoff.next ? [`下一步：\n${handoff.next}`] : null,
        handoff.notes ? [`经验与坑：\n${handoff.notes}`] : null,
        [`请基于这个大前提往下做，不要再重新推导一遍。如果发现其中有**过时**的地方，直接指出，而不是照着做。`],
      ]
  const body = blocks.filter(Boolean).map((block) => block.join('\n')).join('\n\n')
  const header = options.automatic
    ? english
      ? 'This conversation started in a project that keeps a clause, and the project is set to load it automatically.'
      : '这个对话开在一个有项目条例的项目里，而该项目被设置为自动带入条例。'
    : english
      ? 'The user asked for this project\'s clause.'
      : '用户要求带上这个项目的条例。'
  return [header, '', '<summary>', body, '</summary>'].join('\n')
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
  // 任务现在是对象：这里把文字取出来。**已勾选的不再进"下一步"**——它们已经完成了，
  // 混在里面会让接手者以为还要做。
  const taskText = (row) => (row && typeof row === 'object' ? row.text : String(row))
  const taskDone = (row) => Boolean(row && typeof row === 'object' && row.done === true)
  const nextSteps = [
    ...handoff.doing.filter((row) => !taskDone(row)).map((row) => `- in progress: ${taskText(row)}`),
    ...handoff.todo.filter((row) => !taskDone(row)).map((row) => `- ${taskText(row)}`),
    ...(handoff.next ? [`- next: ${handoff.next}`] : []),
  ]
  // 已勾选的任务单独列出来：它们也是"已经做完"的一部分，不该凭空消失。
  const finishedTasks = [...handoff.todo, ...handoff.doing].filter(taskDone).map((row) => `- ${taskText(row)}`)
  const sections = [
    ['1. Task Overview', handoff.summary ? [handoff.summary] : ['(not recorded)']],
    [
      '2. Current State',
      [...handoff.done.map((row) => `- ${row}`), ...finishedTasks].length
        ? [...handoff.done.map((row) => `- ${row}`), ...finishedTasks]
        : ['(not recorded)'],
    ],
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
