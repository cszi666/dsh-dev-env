// 插件的用户设置。
//
// 为什么单独一份文件而不是 Cordis Config：这些是**用户偏好**（默认下载器、标签、交接），不是插件
// 的部署参数。放 Profil 的 JSON 里可以随时改、可以带默认值、改坏了也只影响这一个文件，而 Config
// 的每次改动都要走 Loader。规则和 roots.json / handoffs.json 一致：跟着 profile 走。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 默认值，也是唯一的事实来源：界面只渲染这些键，缺的键一律回落到这里。
 * 每个设置都带一句 `why`——设置页把它显示出来，因为"这个开关会改变什么"比开关本身更重要。
 */
export const SETTING_DEFS = [
  {
    key: 'download.preferOfficial',
    type: 'boolean',
    default: true,
    group: 'download',
    label: { zh: '下载优先用官方源', en: 'Prefer the official source' },
    why: {
      zh: '打开时，一键补齐与自动开始都用列表里的第一个来源（官方站）。关掉时自动开始会优先选国内镜像，源站慢的时候更快。手动选择来源不受这个影响。',
      en: 'When on, one-click install and the five-second auto-start use the first source in the list (the official one). When off, auto-start prefers a domestic mirror, which helps when the origin is slow. Picking a source by hand is never affected.',
    },
  },
  {
    key: 'download.showMirrors',
    type: 'boolean',
    default: true,
    group: 'download',
    label: { zh: '在来源列表里显示国内镜像', en: 'Offer domestic mirrors' },
    why: {
      zh: '关掉后来源选择器只列官方源，界面更短。已经验证过的镜像仍然写在目录里，只是不再列出来。',
      en: 'When off, the source picker lists only official sources. Verified mirrors stay in the catalog, they are just not offered.',
    },
  },
  {
    key: 'handoff.autoFillMethod',
    type: 'enum',
    values: ['fork', 'current', 'compact'],
    default: 'fork',
    group: 'handoff',
    label: { zh: '一键填充的方式', en: 'How one-click fill works' },
    why: {
      zh: '"fork"（默认）：起一个**继承了这段对话上下文**的子智能体来总结——它能真读到这段对话，而且**不占用主对话的上下文**。"current"：交给主对话的模型，最直接，但会占用你正缺的上下文。"compact"：改用 DSH 的压缩服务——按它的契约会**就地改写这段对话的历史**（把一段消息替换成一个摘要节点），所以它是顺带压缩了对话，而不只是产出一份能带走的记录。',
      en: '"fork" (default) starts a subagent that **inherits this conversation\'s context**: it can actually read the conversation, and it does **not** spend the main context. "current" hands the content to the main conversation\'s model — most direct, but it spends the context you are short of. "compact" uses DSH\'s compaction service, which by its contract **rewrites this conversation\'s history** (a span of messages becomes one summary node), so it compacts as a side effect rather than only producing a portable record.',
    },
  },
  {
    key: 'handoff.autoInject',
    type: 'boolean',
    default: false,
    group: 'handoff',
    label: { zh: '新对话自动带入项目条例', en: 'Load the project clause into a new conversation' },
    why: {
      zh: '打开时，在这个项目里新开一个对话，条例会**自动**作为大前提投进去，你不需要先问一遍。默认关闭：它**每次都会消耗 token**，而且**过时的前提比没有前提更糟**。手动传递（输入框上方的选择器）不受这个开关影响，随时可用。',
      en: 'When on, starting a conversation in this project automatically posts the clause as its premise, so you never have to ask for it first. Off by default: it spends tokens every time, and **a stale premise is worse than none** — the clause is only as good as your last save. Manual sending (the picker above the composer) is always available regardless of this switch.',
    },
  },
  {
    key: 'handoff.tagOnGenerate',
    type: 'boolean',
    default: false,
    group: 'handoff',
    label: { zh: '生成交接时默认打上全部标签', en: 'Tag everything when generating a handover' },
    why: {
      zh: '这里只决定那个"全部 / 部分"选择的**初始状态**：打开时默认全选，关掉时默认不选。无论哪种，标签最终都由你按按钮确认，插件不会自作主张写标签。',
      en: 'This only sets the initial state of the all-or-some choice: on means everything starts selected, off means nothing does. Either way you confirm with a button; the plugin never writes tags on its own.',
    },
  },
  {
    key: 'handoff.showAdvanced',
    type: 'boolean',
    default: false,
    group: 'handoff',
    label: { zh: '交接默认展开详细档', en: 'Show the detailed handover fields by default' },
    why: {
      zh: '详细档会多出需求、功能、接口、经验、坑、可复用片段这些字段。默认收起，只留最基础的四项。',
      en: 'The detailed tier adds requirements, features, interfaces, lessons, traps and reusable pieces. Collapsed by default so only the four basic fields show.',
    },
  },
]

export const SETTING_KEYS = SETTING_DEFS.map((def) => def.key)

/** 一组全默认值的设置。 */
export function defaultSettings() {
  const out = {}
  for (const def of SETTING_DEFS) out[def.key] = def.default
  return out
}

/**
 * 归一化：未知键丢弃、类型不符回落到默认值。
 * 类型检查是必要的——设置文件是用户能直接编辑的文本，期望一个布尔值却读到字符串会让下游
 * 静默走错分支（`'false'` 在 JS 里是真值，这类 bug 很难看出来）。
 */
export function normaliseSettings(input) {
  const source = input && typeof input === 'object' ? input : {}
  const out = defaultSettings()
  for (const def of SETTING_DEFS) {
    const value = source[def.key]
    if (value === undefined) continue
    if (def.type === 'boolean') {
      if (typeof value === 'boolean') out[def.key] = value
      else if (value === 'true') out[def.key] = true
      else if (value === 'false') out[def.key] = false
    } else if (def.type === 'string') {
      if (typeof value === 'string') out[def.key] = value
    } else if (def.type === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[def.key] = value
    } else if (def.type === 'enum') {
      // 只接受清单里的值。一个拼错的枚举会静默走错分支，而"走错分支"在这里意味着用错的方式去总结
      // 整段对话——所以宁可回落到默认值。
      if (typeof value === 'string' && def.values.includes(value)) out[def.key] = value
    }
  }
  return out
}

export function loadSettings(file) {
  try {
    if (!file || !existsSync(file)) return defaultSettings()
    return normaliseSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    // 读坏了就回到默认值：设置是辅助，不该因为它让插件起不来。
    return defaultSettings()
  }
}

export function saveSettings(file, settings) {
  try {
    if (!file) return false
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(normaliseSettings(settings), null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 设置页要显示的东西：定义 + 当前值 + 本地化文案。
 * 面板不做文案映射，所以 `label`/`why` 只回当前语言的那一条。
 */
export function settingsView(file, lang) {
  const english = lang === 'en'
  const current = loadSettings(file)
  return {
    file,
    values: current,
    defaults: defaultSettings(),
    groups: [
      { id: 'download', label: { zh: '下载', en: 'Downloads' } },
      { id: 'handoff', label: { zh: '交接与标签', en: 'Handover and tags' } },
    ].map((group) => ({
      id: group.id,
      label: english ? group.label.en : group.label.zh,
      items: SETTING_DEFS.filter((def) => def.group === group.id).map((def) => ({
        key: def.key,
        type: def.type,
        // enum 的候选值必须一起带出去：面板只渲染 host 给它的东西，拿不到 values 的下拉是空的
        // ——那是一个"存在但用不了"的控件，比没有更糟。
        values: def.values ?? null,
        value: current[def.key],
        default: def.default,
        label: english ? def.label.en : def.label.zh,
        why: english ? def.why.en : def.why.zh,
      })),
    })),
  }
}
