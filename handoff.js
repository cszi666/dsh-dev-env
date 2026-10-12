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
 * 归一化一份交接。三个清单的顺序固定，因为面板与提示词都按这个顺序读；
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

export function loadHandoffs(file) {
  try {
    if (!file || !existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return {}
    const out = {}
    for (const [sessionId, value] of Object.entries(parsed.bySession || {})) {
      out[sessionId] = normaliseHandoff(value, sessionId)
    }
    return out
  } catch {
    // 读坏了就当没有：交接是辅助信息，不该因为它让整个插件起不来。
    return {}
  }
}

export function saveHandoffs(file, bySession) {
  try {
    if (!file) return false
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ version: 1, bySession }, null, 2), 'utf8')
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
  // 每个段落各自成块，最后用**空行分隔段落**去拼。不要在段落内部写空行标记：那样某一段缺失时
  // 它的空行会留下来，出现连续两个空行（jobHelpPrompt 与这里都踩过同一个坑）。
  const list = (title, rows) => (rows.length ? [`${title}：`, ...rows.map((row) => `  - ${row}`)] : null)
  const listEn = (title, rows) => (rows.length ? [`${title}:`, ...rows.map((row) => `  - ${row}`)] : null)

  const blocks = english
    ? [
        [`I am continuing work from another conversation, which has run out of room.`],
        handoff.summary ? [`Where it stands: ${handoff.summary}`] : null,
        listEn('Still to do', handoff.todo),
        listEn('In progress', handoff.doing),
        listEn('Already done', handoff.done),
        handoff.next ? [`Next step planned: ${handoff.next}`] : null,
        handoff.notes ? [`Notes worth keeping:`, handoff.notes] : null,
        [`Treat the above as established context and continue from it. Do not re-derive what is already listed as done.`],
      ]
    : [
        [`我在接着另一个对话继续做事，那个对话已经到上限了。`],
        handoff.summary ? [`当前进展：${handoff.summary}`] : null,
        list('还需要做', handoff.todo),
        list('正在做', handoff.doing),
        list('已经做完', handoff.done),
        handoff.next ? [`下一步计划：${handoff.next}`] : null,
        handoff.notes ? [`值得保留的备注：`, handoff.notes] : null,
        [`请把以上当作已知背景，从这里接着往下做；已经在"已经做完"里的不要再重新推一遍。`],
      ]
  return blocks
    .filter(Boolean)
    .map((block) => block.join('\n'))
    .join('\n\n')
}
