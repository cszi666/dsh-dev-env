// 智能体状态评估。**只报告可观测的指标，不假装有内省。**
//
// 先划清边界：模型没有"累不累"的通道。所谓"对话太长导致状态下降"，工程上对应的是**上下文饱和**
// ——保留的历史越多，早期决定越容易被后面的内容冲淡。它有可观测的征兆（重复已纠正的错、忘掉早先
// 的约定、答复变短变泛），而它的**根因可以量化**：当前上下文占模型窗口的比例。
//
// 所以这个模块分两层：
//   ① **硬指标**：token 饱和度、消息数、压缩次数——这些是算出来的，不是我说的。
//   ② **清单**：让人（或模型自己）逐条核对行为征兆。它不产生分数，只让人自己判断。
//
// 刻意**不给一个"健康分数"**：把分层信号压成一个数字会诱发"70 分所以还行"的错觉，而实际决定
// 该不该换对话的是具体征兆，不是分数。

/** 饱和度分档。阈值是经验值，写在这里是为了**可被质疑**，而不是散在代码里。 */
export const PRESSURE_BANDS = [
  { id: 'fresh', max: 0.35, zh: '充裕', en: 'Comfortable', advice: { zh: '可以继续在这个对话里做。', en: 'Keep working in this conversation.' } },
  { id: 'warm', max: 0.6, zh: '过半', en: 'Past halfway', advice: { zh: '还能做，但注意早期决定开始被冲淡；重要的结论先写进条例。', en: 'Fine to continue, but early decisions are starting to thin out; write what matters into the clause.' } },
  { id: 'hot', max: 0.8, zh: '偏高', en: 'High', advice: { zh: '建议先把条例更新一次，再决定要不要换对话。', en: 'Update the clause first, then decide whether to move to a new conversation.' } },
  { id: 'critical', max: 1.01, zh: '接近上限', en: 'Near the limit', advice: { zh: '现在就该写条例并换对话；再往下做容易重复劳动。', en: 'Write the clause and move to a new conversation now; continuing risks redoing work.' } },
]

/** 行为征兆清单。**这些是判断题，不是测量值**，所以不参与打分，只逐条列出。 */
export const SYMPTOMS = [
  { id: 'repeat-fixed', zh: '重复一个已经纠正过的错误', en: 'Repeating a mistake that was already corrected' },
  { id: 'forget-decision', zh: '忘掉早先定下的决定或约定', en: 'Forgetting a decision or constraint agreed earlier' },
  { id: 'vague', zh: '答复变短、变泛，少了具体路径与证据', en: 'Answers getting shorter and vaguer, with fewer concrete paths and less evidence' },
  { id: 'reread', zh: '重新读一遍已经看过的东西才敢动手', en: 'Re-reading files or state that was already established' },
  { id: 'drift', zh: '开始做没要求的事，或漏掉明确要求的事', en: 'Doing things that were not asked, or missing things that were' },
  { id: 'tool-spam', zh: '同一件事反复试探，而不是按已知结论推进', en: 'Probing the same thing repeatedly instead of acting on what is already known' },
]

/**
 * 由**真实数字**算出饱和状态。
 *
 * `surfaceTokens` 是当前保留的上下文体量，`contextWindow` 来自模型路由的 requestContext。
 * 拿不到任一值时**不猜**——返回 `unknown` 档并说明缺什么，因为一个凭空的饱和度比没有更糟。
 */
export function assessPressure(surfaceTokens, contextWindow) {
  const used = Number(surfaceTokens)
  const window = Number(contextWindow)
  if (!Number.isFinite(used) || used <= 0 || !Number.isFinite(window) || window <= 0) {
    return {
      band: 'unknown',
      ratio: null,
      usedTokens: Number.isFinite(used) && used > 0 ? used : null,
      contextWindow: Number.isFinite(window) && window > 0 ? window : null,
      reason: '缺少 surfaceTokens 或 contextWindow，无法计算比例',
    }
  }
  const ratio = used / window
  const band = PRESSURE_BANDS.find((row) => ratio <= row.max) ?? PRESSURE_BANDS[PRESSURE_BANDS.length - 1]
  return { band: band.id, ratio, usedTokens: used, contextWindow: window, reason: null }
}

export function pressureBand(id) {
  return PRESSURE_BANDS.find((row) => row.id === id) ?? null
}

/** 把数字与清单排成人能读的报告。**先给硬指标，再给判断题**，顺序不反。 */
export function renderAssessment(input, lang) {
  const english = lang === 'en'
  const lines = []
  lines.push(english ? '# Agent state, as far as it can be measured' : '# 智能体状态（可测的部分）')
  lines.push('')
  lines.push(
    english
      ? 'This reports what can be measured. It **cannot measure** how the model feels — there is no channel for that — and a model of this kind does not tire the way a person does. What it does have is a context window, and that can fill up.'
      : '这份报告只陈述能测到的东西。它**测不出**模型"感觉如何"——没有那个通道——而且这类模型不会像人那样疲惫。它真正会发生的，是**上下文被填满**。',
  )
  lines.push('')

  const pressure = input.pressure
  const band = pressureBand(pressure.band)
  lines.push(english ? '## Measured' : '## 测到的')
  if (pressure.ratio === null) {
    lines.push(english ? `- Context usage: unknown (${pressure.reason})` : `- 上下文占用：无法计算（${pressure.reason}）`)
  } else {
    lines.push(
      english
        ? `- Context usage: ${(pressure.ratio * 100).toFixed(1)}% (${pressure.usedTokens.toLocaleString()} of ${pressure.contextWindow.toLocaleString()} tokens) — ${band ? band.en : pressure.band}`
        : `- 上下文占用：**${(pressure.ratio * 100).toFixed(1)}%**（${pressure.usedTokens.toLocaleString()} / ${pressure.contextWindow.toLocaleString()} tokens）— ${band ? band.zh : pressure.band}`,
    )
    if (band) lines.push(`- ${english ? band.advice.en : band.advice.zh}`)
  }
  if (typeof input.messages === 'number') {
    lines.push(english ? `- Messages retained in the surface: ${input.messages}` : `- 当前保留的消息数：${input.messages}`)
  }
  if (typeof input.compactions === 'number') {
    lines.push(
      english
        ? `- Compactions in this session: ${input.compactions}${input.compactions > 0 ? ' — each one replaced history, so details may already be gone' : ''}`
        : `- 本会话压缩次数：${input.compactions}${input.compactions > 0 ? '——每次都会替换掉一段历史，细节可能已经不在' : ''}`,
    )
  }
  if (input.contextWindowSource === false) {
    lines.push(
      english
        ? '- The context window size was not reported by the route, so the percentage is unavailable.'
        : '- 模型路由没有报告上下文窗口大小，所以算不出百分比。',
    )
  }
  lines.push('')

  lines.push(english ? '## Judge these yourself' : '## 需要你自己判断的')
  lines.push(
    english
      ? 'These are not measurements. Check them against what you have just seen; if two or more are true, the conversation is losing fidelity and a clause is worth writing now.'
      : '以下**不是测量值**。对照刚才的实际表现逐条看：如果中了两条以上，说明这个对话正在失去保真度，**现在就该写条例**。',
  )
  for (const symptom of SYMPTOMS) lines.push(`- [ ] ${english ? symptom.en : symptom.zh}`)
  lines.push('')

  lines.push(english ? '## What to do about it' : '## 该怎么办')
  lines.push(
    english
      ? '1. Update the project clause while you still remember why things were decided — `dev_env_handoff_write`, or the 项目条例 tab.'
      : '1. **趁你还记得"为什么这么定"的时候更新项目条例**——用「项目条例」页签，或 `dev_env_handoff_write`。',
  )
  lines.push(
    english
      ? '2. Start a new conversation; with `handoff.autoInject` on, the clause arrives as its premise, so nothing has to be re-explained.'
      : '2. 开新对话。若打开 `handoff.autoInject`，条例会作为大前提自动带入，不必重新解释一遍。',
  )
  lines.push(
    english
      ? '3. Keep this one open until the new one has demonstrably picked up; a clause is a summary, not a copy of the reasoning.'
      : '3. 在新对话**确认接上之前**先别关这个——条例是摘要，不是推理过程的副本。',
  )
  lines.push('')
  lines.push(
    english
      ? 'One honest limit: this cannot tell you whether the work is going well, only whether this conversation still has room. Those are different questions.'
      : '一条如实的边界：它**测不出**活干得好不好，只能告诉你这个对话还有没有余量。这是两件事。',
  )
  return lines.join('\n')
}
