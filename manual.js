// 插件说明书：**单一来源**。
//
// 为什么是结构化数据而不是一篇 Markdown：说明书有两个读者——**人**（在设置里看）和**DSH**（通过工具读）。
// 若各写一份，两边迟早不一致，而"说明书与实现不一致"比没有说明书更糟：模型会照着过时的说明做事。
// 所以内容在这里定义一次，界面按节渲染，工具按节读出，`scripts/check.mjs` 再断言它没有漏掉任何工具、
// 设置或已知边界——那些漂移是**可检测**的，所以我让它可检测。

/** 工具清单：与 index.js 里 `ctx.tools.register` 的四处保持一致（有守卫检查）。 */
export const MANUAL_TOOLS = [
  {
    name: 'dev_env_inventory',
    when: { zh: '想知道这台机器装了什么、缺什么', en: 'To see what this machine has and what is missing' },
    does: {
      zh: '扫描语言运行时、IDE、测试工具、数据库与构建工具，返回精确版本、路径，以及与完整工具链目录比对后的缺口。默认带 60 秒缓存，refresh=true 强制重扫。',
      en: 'Scans runtimes, IDEs, test tools, databases and build tools; returns exact versions, paths, and the gaps against a full toolchain list. Cached for 60s; refresh=true forces a rescan.',
    },
    note: {
      zh: '写代码或跑测试前先调它，能避免对不存在的编译器做出错误假设。',
      en: 'Call it before writing code or running tests, to avoid assuming a compiler that is not there.',
    },
  },
  {
    name: 'dev_env_install',
    when: { zh: '要补一个缺失的工具', en: 'To fill a missing tool' },
    does: {
      zh: '按条目声明的方案启动安装：winget / npm / pip / 自己下载 / 打开官方页。返回任务 id，用 dev_env_job 查进度。',
      en: 'Starts an install through the route the entry declares: winget / npm / pip / own download / open the official page. Returns a job id; poll it with dev_env_job.',
    },
    note: {
      zh: 'winget 在这台机器上是坏的（0 字节别名），所以脚本里实际可用的是"自己下载"这条路。安装是一条后台任务，不要假设它立即完成。',
      en: 'winget is broken on this machine (a 0-byte alias), so the practical route is the own-download one. An install is a background job; do not assume it is done.',
    },
  },
  {
    name: 'dev_env_job',
    when: { zh: '要看某个安装/卸载任务怎么样了', en: 'To check on an install or uninstall job' },
    does: {
      zh: '列出任务或查一个任务的进度、阶段、速率、退出码与日志尾部。',
      en: 'Lists jobs, or reports one job\'s progress, phase, rate, exit code and log tail.',
    },
    note: {
      zh: '失败的任务会在 job.fallback 里带上另一条可用路线（例如改用自己下载）。',
      en: 'A failed job carries an alternative route in job.fallback (for example, downloading it ourselves).',
    },
  },
  {
    name: 'dev_env_handoff_write',
    when: { zh: '要把当前工作的条例写下来', en: 'To write the clause for the current work' },
    does: {
      zh: '按 DSH 压缩摘要的五节结构写入项目条例（summary / done / discoveries / todo / doing / next / preserve）。项目由会话的工作目录决定，调用方不需要也给不出路径。',
      en: 'Writes the project clause in DSH\'s five-section compaction shape (summary / done / discoveries / todo / doing / next / preserve). The project comes from the session\'s working directory; the caller neither needs nor can supply a path.',
    },
    note: {
      zh: '只在用户要求生成或更新条例时调用。它写入的是项目级的记录，不是这个对话的私产。',
      en: 'Call it only when the user asks for the clause to be written or updated. It writes a project-level record, not something private to this conversation.',
    },
  },
  {
    name: 'dev_env_tasks',
    when: { zh: '要知道接下来该做什么，或记下一件新事项', en: 'To find out what is next, or to record something new' },
    does: {
      zh: '读写项目条例里的任务清单：list / add / update / move / remove / clear。任务有稳定 id，顺序即优先级。',
      en: 'Reads and writes the clause\'s task list: list / add / update / move / remove / clear. Tasks have stable ids and their order is their priority.',
    },
    note: {
      zh: '开新对话时先 list 一次，比重新问用户"接下来做什么"更省事，也更准确。',
      en: 'Calling list once at the start of a conversation beats asking the user what is next — cheaper and more accurate.',
    },
  },
  {
    name: 'dev_env_manual',
    when: {
      zh: '不确定这个插件能做什么、或不知道该调哪个工具',
      en: 'When unsure what this plugin can do, or which tool to call',
    },
    does: {
      zh: '读出这份说明书本身，可以只取一节（what / install / clause / limits / tools）。',
      en: 'Reads this manual, optionally a single section (what / install / clause / limits / tools).',
    },
    note: {
      zh: '先读 limits 那一节最省事：它写明这台机器上哪些路走不通，能省掉一轮试错。',
      en: 'Reading the limits section first saves the most: it states which routes cannot work here, and spares a round of trial and error.',
    },
  },
  {
    name: 'dev_env_state',
    when: {
      zh: '想知道这个对话还剩多少余量、该不该先写条例再换对话',
      en: 'To see how much room this conversation has left, and whether to write the clause before switching',
    },
    does: {
      zh: '用 tokenMeter 实测的 token 数与模型窗口算出上下文占用百分比，并给出保留消息数、压缩次数，以及一份需要自己判断的行为征兆清单。',
      en: 'Computes context usage from the token count tokenMeter actually measures against the model window, and reports retained messages, compaction count, and a checklist of behavioural symptoms to judge yourself.',
    },
    note: {
      zh: '它**测不出**模型累不累——没有那个通道，这类模型也不会像人那样疲惫。它测的是上下文饱和，那才是"对话变长后状态变差"的真正原因。拿不到窗口大小时它说 unknown，不猜。',
      en: 'It cannot measure whether the model is tired — there is no channel for that, and a model of this kind does not tire the way a person does. It measures context saturation, which is the real cause of "answers got worse as the conversation grew". When the window size is not reported it says unknown rather than guessing.',
    },
  },
]

/** 设置项：与 settings.js 的 SETTING_DEFS 一致（有守卫检查）。 */
export const MANUAL_SETTINGS = [
  { key: 'download.preferOfficial', zh: '下载优先用官方源（关掉则自动选国内镜像）', en: 'Prefer the official source (off picks a domestic mirror)' },
  { key: 'download.showMirrors', zh: '来源列表里显示国内镜像', en: 'Offer domestic mirrors in the source list' },
  { key: 'handoff.autoFillMethod', zh: '一键填充的方式：fork（默认）/ current / compact', en: 'How one-click fill works: fork (default) / current / compact' },
  { key: 'handoff.autoInject', zh: '新对话自动带入本项目条例（默认关，会耗 token）', en: 'Load this project\'s clause into a new conversation (off by default; spends tokens)' },
  { key: 'handoff.tagOnGenerate', zh: '生成条例时默认打上全部标签', en: 'Tag everything when generating the clause' },
  { key: 'handoff.showAdvanced', zh: '条例默认展开详细档', en: 'Show the detailed clause fields by default' },
]

/** 说明书正文。`id` 用于锚点，`body` 是段落数组。 */
export const MANUAL_SECTIONS = [
  {
    id: 'what',
    title: { zh: '这个插件是做什么的', en: 'What this plugin does' },
    body: {
      zh: [
        '它管两件事：**这台机器上的开发环境**，以及**每个项目的条例**。',
        '环境部分：扫描已装工具，指出缺口，并用条目自己声明的方案去补齐。它不自己发明安装方式——每条目的 install 声明就是它唯一的事实来源。',
        '条例部分：「项目条例」是挂在**项目目录**上的记录，而不是某个对话的私产。同一项目的任何对话看到的是同一份——这是刻意的，因为"分支项目要它的全部资料""别的项目要它的经验"这两个场景，只有项目键控才能表达。',
      ],
      en: [
        'It looks after two things: **the development environment on this machine**, and **each project\'s clause**.',
        'Environment: it scans installed tools, names the gaps, and fills them through the route each entry declares. It never invents an install method — the entry\'s install declaration is its only source of truth.',
        'Clause: a clause hangs on a **project directory**, not on a conversation. Every conversation in that project sees the same one, deliberately: "a branch needs the parent project\'s material" and "another project wants the lessons" can only be expressed when the record belongs to the project.',
      ],
    },
  },
  {
    id: 'install',
    title: { zh: '补齐工具怎么走', en: 'How filling a gap works' },
    body: {
      zh: [
        '每个条目按优先级声明可用方案：winget → npm/pip → 自己下载 → 打开官方页。面板与工具走的是同一份声明。',
        '**自己下载**的方案指向**目录列表**而不是写死的 URL：dlcdn 之类的镜像只保留当前版本，写死的地址会在下个版本发布时无声腐烂（404 与网络不通长得一样）。',
        '可选来源（官方 + 国内镜像）会在使用前**逐个真验证**：解析列表并 HEAD 探测文件。不可用的源直接不列出——给出一个选了没反应的选项比没有更糟。',
        '**winget 的环境差异很大**：没有 Store、源被策略禁用、需要管理员权限，从用户角度看都是"一个非 0 退出码"。所以失败时任务会记下另一条路线，面板给出按钮，而**不自动重试**——换一种方式改动系统仍要用户点头。',
      ],
      en: [
        'Each entry declares its routes in priority order: winget → npm/pip → own download → open the official page. The panel and the tools read the same declaration.',
        'An **own-download** route points at a **directory listing**, never a pinned URL: mirrors like dlcdn keep only the current release, so a pinned address rots silently at the next release — a 404 and an unreachable network look identical.',
        'Optional sources (official plus domestic mirrors) are **each verified for real** before use: the listing is resolved and the file probed. A source that cannot deliver is not listed at all — offering a choice that does nothing is worse than offering none.',
        '**winget varies a lot across environments**: no Store, sources disabled by policy, or no administrator rights all reach the user as "a non-zero exit code". So a failure records an alternative route and the panel offers it, never retrying on its own — changing mechanism still changes the machine, which still needs a click.',
      ],
    },
  },
  {
    id: 'clause',
    title: { zh: '项目条例怎么用', en: 'How the project clause works' },
    body: {
      zh: [
        '条例有**两栏**：左边是「需要提交的事」（目标与约束、已完成、经验与坑、下一步），右边是「任务清单」（可勾选、增删、**拖动排序**，顺序即优先级）。',
        '它按**项目目录**键控。拿不到目录时会退回按对话保存，并在界面上如实说明——**假装是项目级比退回更糟**。',
        '**一键填充**有三种方式：`fork`（默认，起一个继承本对话上下文的子智能体，不占用主对话上下文）、`current`（用当前对话总结，会占用上下文）、`compact`（DSH 压缩服务，会**就地改写这段对话的历史**）。',
        '**标签由用户按按钮决定**，插件从不自己打标签；设置只决定那个选择的初始状态。',
        '条例可以**带进对话**：输入框上方的选择器手动传递，或打开 `handoff.autoInject` 让新对话自动带入（默认关）。两者都是**一条普通消息**，看得见、能撤销。',
      ],
      en: [
        'The clause has **two columns**: the left is what is or will be handed over (goal and constraints, what is done, lessons and traps, next step); the right is the task list, which can be ticked, added to, deleted from and **dragged into order** — order is priority.',
        'It is keyed by **project directory**. With no directory it falls back to per-conversation and says so in the UI — **pretending to be project-level is worse than falling back**.',
        '**One-click fill** has three routes: `fork` (default — a subagent that inherits this conversation\'s context and spends none of the main one), `current` (summarise in this conversation, spending its context), and `compact` (DSH\'s compaction service, which **rewrites this conversation\'s history in place**).',
        '**Tags are the user\'s decision**, pressed as a button; the plugin never adds one. The setting only sets the initial state of that choice.',
        'A clause can be **carried into a conversation**: the picker above the composer sends it by hand, or `handoff.autoInject` loads it automatically into a new conversation (off by default). Both arrive as an ordinary message — visible and revocable.',
      ],
    },
  },
  {
    id: 'limits',
    title: { zh: '已知边界（照实说）', en: 'Known limits, stated plainly' },
    body: {
      zh: [
        '**winget 在这台机器上不可用**：`winget.exe` 是 0 字节的 Store 别名，执行无输出、退出码 `0x8A150001`。健康检查会因此不提供任何 winget 方案，而不是给出一个点不动的按钮。',
        '**github.com 不通**：因此 ninja、cmake、gh、allure 这些把发布挂在 GitHub 上的工具**没有**自己下载的方案。这不是"没找地址"，是那些地址在这里取不到。',
        '**compaction 服务不可用**：所以设置里的 `compact` 方式在这台机器上跑不通，界面会退回手动方式并说明。',
        '**面板不能自己启动进程**：面板是浏览器代码。要"启动工具"必须走 host 路由，而一条接受页面传来命令的路由等于**以用户身份任意执行代码**。目前没有这条路由，这是有意为之。',
        '**交接的解析是文本解析，不是 JSON**：上一版让模型拼 JSON，一个转义过度的 Windows 路径就让整轮 `MALFORMED_RESPONSE`，连带同轮成功的写入一起作废。现在改由宿主解析纯文本，那个失败模式被消除而非缓解。',
        '**诊断脚本留在 `tools/diagnostics/`**：它们记录的是真机测量结果（镜像可达性、winget 包 id、324 条注册表卸载项快照），不是运行时代码，也不参与发布。',
      ],
      en: [
        '**winget is unusable on this machine**: `winget.exe` is a 0-byte Store alias that prints nothing and exits `0x8A150001`. The health check therefore offers no winget route instead of a button that cannot work.',
        '**github.com is unreachable**: so ninja, cmake, gh and allure — which publish through GitHub — have **no** own-download route. That is not a missing address; those addresses cannot be fetched here.',
        '**The compaction service is unavailable**: so the `compact` fill route cannot work on this machine, and the interface falls back and says so.',
        '**The panel cannot start processes itself**: it is browser code. Launching a tool must be a host route, and a route that accepts a command from the page is **arbitrary code execution as the user**. No such route exists, on purpose.',
        '**Clause parsing is text parsing, not JSON**: the previous version had the model build JSON, and one over-escaped Windows path ended a whole turn with `MALFORMED_RESPONSE`, discarding the successful writes that shared it. The host parses plain text now, which removes that failure mode rather than mitigating it.',
        '**Diagnostic scripts live in `tools/diagnostics/`**: they record real measurements (mirror reachability, winget package ids, a 324-entry registry uninstall snapshot). They are not runtime code and are not published.',
      ],
    },
  },
]

/** 说明书在设置里的渲染数据。 */
export function manualView(lang) {
  const english = lang === 'en'
  return {
    title: english ? 'Dev Env manual' : 'Dev Env 说明书',
    intro: english
      ? 'What this plugin does, how each tool is meant to be used, and what it cannot do here. DSH can read this same text through the dev_env_manual tool, so the two can never disagree.'
      : '这个插件做什么、每个工具该怎么用、以及它在这台机器上做不到什么。DSH 可以通过 dev_env_manual 工具读到同一份文本，所以两者不会不一致。',
    sections: MANUAL_SECTIONS.map((section) => ({
      id: section.id,
      title: english ? section.title.en : section.title.zh,
      body: english ? section.body.en : section.body.zh,
    })),
    tools: MANUAL_TOOLS.map((tool) => ({
      name: tool.name,
      when: english ? tool.when.en : tool.when.zh,
      does: english ? tool.does.en : tool.does.zh,
      note: english ? tool.note.en : tool.note.zh,
    })),
    settings: MANUAL_SETTINGS.map((row) => ({ key: row.key, text: english ? row.en : row.zh })),
  }
}

/**
 * 给 DSH 读的纯文本版本。
 *
 * 刻意复用同一份数据：工具的输出必须是**人能看到的同一份说明**，否则模型会照着与界面不符的说明做事。
 */
export function manualText(lang, sectionId) {
  const view = manualView(lang)
  const english = lang === 'en'
  const sections = sectionId ? view.sections.filter((row) => row.id === sectionId) : view.sections
  if (sectionId && !sections.length) {
    return {
      ok: false,
      error: `没有这一节：${sectionId}（可选：${view.sections.map((row) => row.id).join(', ')}）`,
    }
  }
  const lines = []
  lines.push(`# ${view.title}`)
  lines.push('')
  lines.push(view.intro)
  for (const section of sections) {
    lines.push('')
    lines.push(`## ${section.title}`)
    for (const paragraph of section.body) lines.push(paragraph)
  }
  if (!sectionId || sectionId === 'tools') {
    lines.push('')
    lines.push(english ? '## Tools DSH can call' : '## DSH 可以调用的工具')
    for (const tool of view.tools) {
      lines.push(`- ${tool.name} — ${tool.when}`)
      lines.push(`  ${tool.does}`)
      lines.push(`  ${tool.note}`)
    }
  }
  return { ok: true, text: lines.join('\n'), sections: view.sections.map((row) => row.id) }
}
