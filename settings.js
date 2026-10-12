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
        value: current[def.key],
        default: def.default,
        label: english ? def.label.en : def.label.zh,
        why: english ? def.why.en : def.why.zh,
      })),
    })),
  }
}
