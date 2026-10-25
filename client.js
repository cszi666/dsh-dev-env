/**
 * dsh-dev-env — client 半边（浏览器插件模块）
 *
 * 由 dsh-client-modules 从 package.json 的 dsh.client 扫描出来，经 /plugins 路由下发。
 * 只做两件事：
 *   1) 在侧栏 sidebar.panellist 注册一个全局面板图标；
 *   2) 在 main（keyed，键 = 同一个 id）注册面板本体：环境清单 + 缺口 + 一键补齐。
 *
 * 所有数据都来自 host 半边的 HTTP API（/dsh-dev-env/api/*），本文件不复制任何业务逻辑。
 * 样式只用主题 token（--dsw-alias-*），浅色/深色自动跟随。
 */

window.__ModuleLoader__.load({
  id: 'dsh-dev-env',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-dev-env/api'
    const PANEL_ID = 'dev-env'
    const NS = 'dsh-dev-env'
    /**
     * 来源选择器的自动开始倒计时（秒）。
     *
     * 超时**会真的开始安装**——这是用户明确要求的："五秒未选择时默认第一条最稳定的路线"。
     * 之所以可以这样做，是因为倒计时只在**host 已经逐个验证过来源**之后才开始：默认那条是
     * 一条被证明能下的路，而不是一条希望。列表为空时不会自动开始任何东西。
     */
    const AUTO_START_SECONDS = 5

    // 内置词条：即使 locale 服务不可用，面板也完整可读
    const DICT_ZH = {
      panel: '开发环境',
      title: '开发环境探测',
      subtitle: '语言运行时 · IDE · 测试工具 · 数据库与构建工具',
      rescan: '重新扫描',
      scanning: '探测中…',
      tabMissing: '缺口',
      tabAll: '全部',
      allCategories: '全部分类',
      installed: '已安装',
      missing: '缺失',
      essentialMissing: '核心必备缺失',
      total: '共',
      items: '项',
      install: '一键补齐',
      installing: '安装中…',
      download: '下载页',
      command: '命令',
      copy: '复制命令',
      copied: '已复制',
      jobs: '补齐任务',
      noJobs: '还没有补齐任务。',
      log: '日志',
      empty: '没有需要补齐的项，环境完整。',
      versionUnknown: '版本未知',
      notInstalled: '未安装',
      scanFailed: '扫描失败',
      retry: '重试',
      loading: '正在读取环境…',
      essentialBadge: '必备',
      switchLanguage: '切换语言',
      learn: '了解',
      elapsed: '已用',
      phaseWaiting: '排队中',
      phaseDownload: '下载中',
      phaseVerify: '校验中',
      phaseInstall: '安装中',
      phaseDone: '完成',
      logTail: '日志尾部',
      detail: '详情',
      close: '收起',
      deleteJob: '删除',
      cancelJob: '取消',
      cancelling: '取消中…',
      phaseCancelled: '已取消',
      cleanupRemoved: '清理边界：已删除我们自己下载的未完成残片',
      cleanupExternal: '清理边界：安装器自己的缓存不是我们的，原样留下',
      clearFinished: '清空已结束',
      askDsh: '要讲解吗？',
      explainByDsh: '让 DSH 讲解',
      openOfficial: '打开官网',
      explainSent: '已交给 DSH，去看对话',
      noOfficialPage: '这个工具没有登记官网',
      pickFolder: '已经安装？选择对应文件夹',
      pickFolderTitle: '这个工具如果是你自己解压到某个文件夹里的，就选它',
      picking: '等待选择…',
      pickedOk: '已记住，并在这里认出了它',
      rootsTitle: '额外根目录',
      rootsHint: '有些工具是解压在自己文件夹里的，注册表和 PATH 都找不到。选一次，之后每次扫描都会搜这里。',
      rootsEmpty: '还没有添加任何目录。',
      rootsFromEnv: '来自环境变量',
      rootsFromPick: '手动添加',
      rootsRemove: '移除',
      uninstall: '卸载',
      uninstalling: '卸载中…',
      uninstallConfirm: '确定要从这台机器上移除它？',
      uninstallConfirmGo: '确认卸载',
      uninstallCancel: '不卸载',
      uninstallWarning: '这会真的卸载它，不能撤销。',
      uninstallEssential: '它是核心工具，DSH 或你正在做的项目可能依赖它。',
      uninstallInteractive: '这个卸载器会打开它自己的窗口，你要在那里完成。',
      uninstallExperimental: '只有它确实是以这种方式安装的才会成功。',
      uninstallNoWay: '解压即用的工具没有卸载器，只能手动删除它的目录。',
      phaseUninstall: '卸载中',
      uninstallGone: '复查：已经探测不到它了',
      uninstallStill: '复查：仍然能被探测到，卸载可能没有真正完成',
      askHelp: '让 DSH 帮我解决',
      askHelpTitle: '把这条任务的错误、命令和日志交给 DSH，让它诊断并给出这台机器上的下一步',
      askingHelp: '正在转交…',
      helpSent: '已交给 DSH，去看对话',
      pickSource: '选择下载来源',
      pickSourceHint: '只列出刚刚验证过、真的能下的来源。',
      pickSourceAuto: '秒后自动用第一条（最稳的路线）开始',
      pickSourceNow: '立即用这个来源开始',
      pickSourceChecking: '正在逐个验证来源…',
      pickSourceNone: '没有验证通过的来源。只能打开官网自己下载。',
      pickSourceFailed: '未通过验证（列表不可用或文件取不到）',
      pickSourceCancel: '先不装',
      tryInstead: '改用另一条路',
      tryInsteadWhy: 'winget 在不同的环境里适配度差别很大（没有 Store、源被策略禁用、需要管理员权限）。这条命令失败了，但这个条目有一条不依赖它的路。',
      handoff: '交接给对话',
      handoffPick: '交给哪个对话',
      handoffPickHint: '列表按最近活跃排序。只有能接收提问的会话才可选。',
      handoffAuto: '交给当前对话',
      handoffProject: '所属项目',
      handoffScopeSession: '未能识别项目目录，暂按对话保存',
      fillNow: '一键填充',
      filling: '已请 DSH 生成…',
      fillSent: '已请这个对话的模型总结；它调用工具写入后，这份记录会自动出现（可稍等再刷新）',
      fillCompactUnavailable: '这个环境里 compaction 不可用，无法用压缩方式总结。请在设置里改用「用子智能体总结」。',
      fillDone: '已由子智能体写好了条例',
      tagButton: '添加标签',
      tagPick: '给这份条例打标签',
      tagPickHint: '标签由你决定，插件不会自己打。全选会占用更多 token，但也让这份记录更容易被检索到。',
      tagAll: '全部打上（默认）',
      tagNone: '全部不打',
      tagConfirm: '确认标签',
      handoffSent: '已交接',
      handoffNoJobs: '现在没有任务可以交接',
      handoffLoading: '正在读取会话…',
      handoffNoSessions: '没有可用的会话',
      handoffRunning: '运行中',
      handoffTab: '项目条例',
      handoffSummary: '这个项目要做什么（目标与约束）',
      handoffTodo: '待办事项（一行一件）',
      handoffDoing: '正在进行',
      handoffDone: '已完成',
      handoffNext: '下一步',
      handoffNotes: '经验与坑（决策理由、试过不行的方法）',
      handoffOnePerLine: '一行一件',
      handoffSave: '保存条例',
      handoffSaved: '已保存',
      handoffSendCurrent: '投给当前对话，从这里接着做',
      handoffNoSession: '暂时拿不到这个对话的身份，所以无法读写项目条例。',
      clauseLeft: '需要提交的事',
      clauseRight: '任务清单',
      clauseLeftEmpty: '还没有登记需要提交的内容。',
      clauseRightEmpty: '还没有任务。',
      clauseUntagged: '未分类',
      clauseCount: '项',
      manualTools: 'DSH 可以调用的工具',
      manualSettings: '设置项一览',
      clauseDock: '项目条例',
      clauseDockHint: '把某个项目的条例作为大前提带进这个对话',
      clauseDockPick: '带上哪个项目的条例',
      clauseDockLoading: '正在读取…',
      clauseDockNone: '还没有任何项目条例。先在「项目条例」页签里写一份。',
      clauseDockCurrent: '当前项目',
      clauseDockEmpty: '（还没有摘要）',
      clauseDockSend: '带进这个对话',
      clauseSent: '已带入',
      clauseAutoInjected: '已自动带入本项目的条例',
      taskAdd: '添加',
      taskAddPlaceholder: '新任务，回车添加',
      taskDelete: '删除这条',
      taskToggle: '完成 / 取消完成',
      taskDragHint: '拖动调整顺序（顺序即优先级）',
      taskEditHint: '点文字可改名',
      clauseHint: '这是这个项目的条例：左边是已经/将要交出去的东西，右边是还要做的事。同一项目的任何对话看到的是同一份。',
      tagContinuation: '传承：接着往下做',
      tagProjectMaterial: '项目资料：需求/功能/接口',
      tagReusable: '可复用经验：做法与坑',
      tagDecision: '决策记录：为什么这么选',
      tagOpen: '仍待确认：未定的事',
      settingsTitle: 'Dev Env 设置',
      settingsIntro: '这些是默认行为。每一项都写明它会改变什么；改动保存后立即生效，不需要重启。',
      settingsSave: '保存设置',
      settingsSaved: '已保存',
      settingsUnavailable: '这台机器上不可用：',
      methodFork: '用子智能体总结（默认，不占用本对话上下文）',
      methodCurrent: '用当前对话总结（会占用本对话上下文）',
      methodCompact: '用 DSH 压缩服务总结（会就地压缩这段对话）',
      speed: '速率',
      eta: '剩余',
      fromOwnDownload: '自己下载',
      extResumed: '已续传',
      clauseReorder: '拖动可调顺序',
      editOpen: '编辑原文',
      editClose: '收起编辑',
      clearClause: '清空条例',
      clearConfirmTitle: '清空这份条例？',
      clearConfirmBody: '会把目标、已完成、经验、下一步和全部任务清空——**不能撤销**。项目身份与你打的标签会保留，所以清空后重新填充仍写回同一个项目。如果只是填充失败，也可以先试「用当前对话总结」。',
      clearConfirmGo: '确认清空',
      clearConfirmCancel: '不清空',
      stateTab: '状态',
      stateIntro: '这个对话还有多少余量——数字是实测的，清单是给你自己判断的。',
      stateUnknown: '无法确定',
      stateUnknownHint: '拿不到模型窗口大小，所以算不出百分比；这不是错误，只是这个路由没有报告它。',
      stateMessages: '保留消息数',
      stateCompactions: '已压缩次数',
      stateChecklist: '需要你自己判断',
      stateChecklistHint: '勾选只在本页有效、不会上报。中两条以上说明这个对话在失去保真度，该先写条例。',
      stateChecklistWarn: '中了两条以上：现在就该更新项目条例，然后换对话。',
      stateLimitNote: '说明：它测不出模型"累不累"——没有那个通道。它测的是上下文饱和，那才是"对话变长后状态变差"的真正原因。',
    }
    const DICT_EN = {
      panel: 'Dev Env',
      title: 'Development environment',
      subtitle: 'Language runtimes · IDEs · Test tools · Databases and build tools',
      rescan: 'Rescan',
      scanning: 'Scanning…',
      tabMissing: 'Gaps',
      tabAll: 'All',
      allCategories: 'All categories',
      installed: 'Installed',
      missing: 'Missing',
      essentialMissing: 'Essential gaps',
      total: 'Total',
      items: 'items',
      install: 'Install',
      installing: 'Installing…',
      download: 'Download page',
      command: 'Command',
      copy: 'Copy command',
      copied: 'Copied',
      jobs: 'Install jobs',
      noJobs: 'No install jobs yet.',
      log: 'Log',
      empty: 'Nothing to install — the environment is complete.',
      versionUnknown: 'version unknown',
      notInstalled: 'Not installed',
      scanFailed: 'Scan failed',
      retry: 'Retry',
      loading: 'Reading environment…',
      essentialBadge: 'essential',
      switchLanguage: 'Switch language',
      learn: 'Learn',
      elapsed: 'elapsed',
      phaseWaiting: 'Queued',
      phaseDownload: 'Downloading',
      phaseVerify: 'Verifying',
      phaseInstall: 'Installing',
      phaseDone: 'Done',
      logTail: 'log tail',
      detail: 'Details',
      close: 'Close',
      deleteJob: 'Delete',
      cancelJob: 'Cancel',
      cancelling: 'Cancelling…',
      phaseCancelled: 'Cancelled',
      cleanupRemoved: 'Cleanup: our own partial files were removed',
      cleanupExternal: 'Cleanup: the installer cache is not ours and was left alone',
      clearFinished: 'Clear finished',
      askDsh: 'Explain it?',
      explainByDsh: 'Let DSH explain',
      openOfficial: 'Open homepage',
      explainSent: 'Handed to DSH — check the conversation',
      noOfficialPage: 'No homepage recorded for this tool',
      pickFolder: 'Already installed? Pick its folder',
      pickFolderTitle: 'Use this if you unzipped the tool into a folder of your own',
      picking: 'Waiting for the picker…',
      pickedOk: 'Remembered — and recognised it there',
      rootsTitle: 'Extra folders',
      rootsHint: 'Some tools are unzipped into a folder of your own, where the registry and PATH cannot find them. Pick one once and every later scan searches it.',
      rootsEmpty: 'No folders added yet.',
      rootsFromEnv: 'from the environment variable',
      rootsFromPick: 'added by hand',
      rootsRemove: 'Remove',
      uninstall: 'Uninstall',
      uninstalling: 'Uninstalling…',
      uninstallConfirm: 'Remove it from this machine?',
      // The confirming button must not read the same as the row button that opened it: two identical
      // labels make "which one did I press" ambiguous for the user, and for anything that looks a
      // button up by text — which is exactly how this was caught.
      uninstallConfirmGo: 'Uninstall it',
      uninstallCancel: 'Keep it',
      uninstallWarning: 'This really uninstalls it, and cannot be undone.',
      uninstallEssential: "It is a core tool — DSH or the project you are working on may depend on it.",
      uninstallInteractive: 'This uninstaller opens its own window; finish it there.',
      uninstallExperimental: 'Only succeeds if it was really installed that way.',
      uninstallNoWay: 'Unpacked tools have no uninstaller — remove the folder by hand.',
      phaseUninstall: 'Uninstalling',
      uninstallGone: 'Re-check: it is no longer detected',
      uninstallStill: 'Re-check: it is still detected, so the uninstall may not have completed',
      askHelp: 'Let DSH fix this',
      askHelpTitle: 'Hand this job’s error, command and log to DSH so it can diagnose it and say what to do next on this machine',
      askingHelp: 'Handing over…',
      helpSent: 'Handed to DSH — check the conversation',
      pickSource: 'Choose a download source',
      pickSourceHint: 'Only sources that were just verified are listed.',
      pickSourceAuto: 's until the first (most reliable) route starts on its own',
      pickSourceNow: 'Start now with this source',
      pickSourceChecking: 'Verifying each source…',
      pickSourceNone: 'No source passed verification. Only the download page is left.',
      pickSourceFailed: 'did not verify (listing unavailable or file not fetchable)',
      pickSourceCancel: 'Not now',
      tryInstead: 'Take the other route',
      tryInsteadWhy: 'winget adapts very differently across environments (no Store, sources disabled by policy, needs admin). This command failed, but the entry has a route that does not depend on it.',
      handoff: 'Hand to a conversation',
      handoffPick: 'Which conversation',
      handoffPickHint: 'Ordered by recent activity. Only sessions that can accept a prompt are listed.',
      handoffAuto: 'Hand to the current conversation',
      handoffProject: 'Project',
      handoffScopeSession: 'no project directory recognised, kept per conversation',
      fillNow: 'Fill from this conversation',
      filling: 'Asked DSH to write it…',
      fillSent: 'Asked this conversation to summarise; the record appears once the tool call lands (refresh in a moment)',
      fillCompactUnavailable: 'Compaction is unavailable here, so it cannot summarise that way. Switch the setting to "summarise with a subagent".',
      fillDone: 'The clause was written by a subagent',
      tagButton: 'Tag it',
      tagPick: 'Tag this clause',
      tagPickHint: 'Tags are your call; the plugin never adds them on its own. Tagging everything costs more tokens but makes the record easier to find later.',
      tagAll: 'Tag everything (default)',
      tagNone: 'Tag nothing',
      tagConfirm: 'Save tags',
      handoffSent: 'Handed over',
      handoffNoJobs: 'There are no jobs to hand over right now',
      handoffLoading: 'Reading sessions…',
      handoffNoSessions: 'No conversation is available',
      handoffRunning: 'running',
      handoffTab: 'Project clause',
      handoffSummary: 'What this project is for (goal and constraints)',
      handoffTodo: 'To do (one per line)',
      handoffDoing: 'In progress',
      handoffDone: 'Done',
      handoffNext: 'Next step',
      handoffNotes: 'Lessons and traps (why a decision, what did not work)',
      handoffOnePerLine: 'one per line',
      handoffSave: 'Save clause',
      handoffSaved: 'Saved',
      handoffSendCurrent: 'Send to the current conversation and continue from here',
      handoffNoSession: 'This conversation has no identity available right now, so the project clause cannot be read or written.',
      clauseLeft: 'To be submitted',
      clauseRight: 'Task list',
      clauseLeftEmpty: 'Nothing registered for submission yet.',
      clauseRightEmpty: 'No tasks yet.',
      clauseUntagged: 'Untagged',
      clauseCount: 'items',
      stateTab: 'State',
      stateIntro: 'How much room this conversation has left — the numbers are measured, the checklist is yours to judge.',
      stateUnknown: 'Undetermined',
      stateUnknownHint: 'The model window size was not reported, so no percentage can be computed. Not an error — just a route that does not announce it.',
      stateMessages: 'messages retained',
      stateCompactions: 'compactions',
      stateChecklist: 'Judge these yourself',
      stateChecklistHint: 'Ticking is local to this tab and never reported. Two or more means this conversation is losing fidelity — write the clause first.',
      stateChecklistWarn: 'Two or more: update the project clause now, then move to a new conversation.',
      stateLimitNote: 'Note: this cannot measure whether the model is tired — there is no channel for that. It measures context saturation, which is the real cause of answers getting worse as a conversation grows.',
      clauseReorder: 'drag to reorder',
      editOpen: 'Edit raw fields',
      editClose: 'Hide raw fields',
      clearClause: 'Clear clause',
      clearConfirmTitle: 'Clear this clause?',
      clearConfirmBody: 'This empties the goal, what is done, the lessons, the next step and every task — **it cannot be undone**. The project identity and your tags are kept, so a later fill still writes to the same project. If the fill is what failed, try "summarise in this conversation" first.',
      clearConfirmGo: 'Clear it',
      clearConfirmCancel: 'Keep it',
      manualTools: 'Tools DSH can call',
      manualSettings: 'Settings at a glance',
      clauseDock: 'Project clause',
      clauseDockHint: 'Bring a project\'s clause into this conversation as its premise',
      clauseDockPick: 'Which project\'s clause',
      clauseDockLoading: 'Reading…',
      clauseDockNone: 'No project has a clause yet. Write one in the Project clause tab first.',
      clauseDockCurrent: 'this project',
      clauseDockEmpty: '(no summary yet)',
      clauseDockSend: 'Bring it in',
      clauseSent: 'Brought in',
      clauseAutoInjected: 'This project\'s clause was loaded automatically',
      taskAdd: 'Add',
      taskAddPlaceholder: 'New task, Enter to add',
      taskDelete: 'Delete this one',
      taskToggle: 'Done / not done',
      taskDragHint: 'Drag to reorder (order is priority)',
      taskEditHint: 'Click the text to rename',
      clauseHint: 'The clause for this project: the left column is what is or will be handed over, the right is what is still to do. Every conversation in this project sees the same one.',
      tagContinuation: 'Continuation: keep going from here',
      tagProjectMaterial: 'Project material: requirements, features, interfaces',
      tagReusable: 'Reusable: approaches and traps',
      tagDecision: 'Decisions: why this choice',
      tagOpen: 'Still open: undecided points',
      settingsTitle: 'Dev Env settings',
      settingsIntro: 'These are defaults. Each one says what it changes; saving takes effect immediately, with no restart.',
      settingsSave: 'Save settings',
      settingsSaved: 'Saved',
      settingsUnavailable: 'Unavailable on this machine: ',
      methodFork: 'Summarise with a subagent (default, costs no main context)',
      methodCurrent: 'Summarise in this conversation (spends this context)',
      methodCompact: 'Use DSH compaction (which rewrites this conversation)',
      speed: 'rate',
      eta: 'left',
      fromOwnDownload: 'own download',
      extResumed: 'resumed',
    }

    // ------------------------------------------------------------ language
    //
    // The panel owns its language instead of following the DSH locale: it ships both
    // dictionaries, defaults to Chinese, and the header button switches to English.
    // The choice is remembered per browser, so a reload keeps it.
    const LANG_KEY = 'dsh-dev-env.lang'

    /** The button always names the language you would switch TO, written in that language. */
    const OTHER_LANGUAGE = { zh: 'English', en: '中文' }

    function readLang() {
      try {
        const saved = window.localStorage.getItem(LANG_KEY)
        return saved === 'en' || saved === 'zh' ? saved : 'zh'
      } catch {
        return 'zh'
      }
    }

    let currentLang = readLang()
    const t = (key) => (currentLang === 'zh' ? DICT_ZH : DICT_EN)[key] ?? key
    const categoryLabel = (group) => (currentLang === 'zh' ? group.name : group.nameEn || group.name)
    const itemName = (item) => (currentLang === 'zh' ? item.name : item.nameEn || item.name)
    const itemDesc = (item) => (currentLang === 'zh' ? item.desc : item.descEn || item.desc) || ''

    function rememberLang(next) {
      currentLang = next === 'en' ? 'en' : 'zh'
      try {
        window.localStorage.setItem(LANG_KEY, currentLang)
      } catch {
        /* private mode: the choice simply does not persist */
      }
      return currentLang
    }

    // ------------------------------------------------------------ styles

    const CSS = `
.dsh-de-root{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);position:relative}
/* 来源选择器：浮在面板之上，而不是挤进某一行——它要的是"现在做一个决定"，不是"看一行详情"。 */
.dsh-de-modal{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:20}
.dsh-de-dialog{width:100%;max-width:520px;max-height:80%;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.dsh-de-dialog h2{margin:0 0 4px;font-size:14px;font-weight:600}
.dsh-de-dialog .dsh-de-pickq{margin-bottom:10px}
.dsh-de-count{font-size:12px;color:var(--dsw-alias-brand-primary);margin:10px 0 4px}
.dsh-de-bar-slim{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-bottom:10px}
.dsh-de-bar-slim span{display:block;height:100%;background:var(--dsw-alias-brand-primary);transition:width 1s linear}
.dsh-de-source{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin-bottom:6px;background:var(--dsw-alias-bg-layer-1)}
.dsh-de-source[data-first="1"]{border-color:var(--dsw-alias-brand-primary)}
.dsh-de-sourcemain{flex:1;min-width:0}
.dsh-de-sourcename{font-weight:500}
.dsh-de-sourcehost{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-de-sourcetag{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none}
.dsh-de-sourcebad{color:var(--dsw-alias-label-secondary);opacity:.7}
.dsh-de-scroll{flex:1;min-height:0;overflow:auto;padding:0 20px 28px;display:flex;flex-direction:column}
.dsh-de-head{padding:18px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-de-headrow{display:flex;align-items:flex-start;gap:12px}
.dsh-de-title{margin:0;font-size:16px;font-weight:600;line-height:22px}
.dsh-de-sub{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-de-spacer{flex:1}
.dsh-de-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:5px 10px;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap}
.dsh-de-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-de-btn:disabled{opacity:.5;cursor:default}
.dsh-de-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.dsh-de-btn.primary:hover:not(:disabled){color:#fff;opacity:.9}
.dsh-de-btn.ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);padding:4px 6px}
.dsh-de-btn.ghost:hover{color:var(--dsw-alias-brand-primary)}
/* 卸载是破坏性动作：红色、并且永远要经过一次确认。它不该和"复制命令"长得一样。 */
.dsh-de-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:transparent}
.dsh-de-btn.danger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary);color:#fff}
.dsh-de-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 10px 12px;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}
.dsh-de-confirmtext{font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary);flex:1;min-width:200px}
.dsh-de-confirmtext b{color:var(--dsw-alias-state-error-primary)}
.dsh-de-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.dsh-de-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-de-chip b{color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-de-chip.ok b{color:var(--dsw-alias-state-success-primary)}
.dsh-de-chip.bad b{color:var(--dsw-alias-state-warn-primary)}
.dsh-de-chip.crit b{color:var(--dsw-alias-state-error-primary)}
.dsh-de-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 10px}
.dsh-de-tab{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
.dsh-de-tab[data-on="1"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-de-select{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font-size:12px}
.dsh-de-group{margin-top:16px}
.dsh-de-groupname{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em;margin-bottom:6px}
.dsh-de-row{display:flex;align-items:center;gap:12px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;margin-bottom:6px}
.dsh-de-row[data-missing="1"]{border-color:var(--dsw-alias-border-l2)}
.dsh-de-name{font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-de-badge{font-size:11px;padding:1px 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);flex:none}
.dsh-de-badge.ess{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsh-de-ver{font-size:12px;color:var(--dsw-alias-state-success-primary);flex:none}
.dsh-de-no{font-size:12px;color:var(--dsw-alias-state-warn-primary);flex:none}
.dsh-de-where{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.dsh-de-cmd{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:2px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}
.dsh-de-actions{display:flex;gap:6px;flex:none}
.dsh-de-note{margin:-2px 0 10px 12px;font-size:11px;color:var(--dsw-alias-label-secondary)}
/* 任务区在 DOM 里仍是最后一个子元素，用 flex order 提到最前。
   用户最想先看到的是「正在发生什么」，而它原本被压在 82 行的目录列表底下，得滚到底才看得见。
   这样不改渲染结构，也就不必去动那段容易写错的 JSX。 */
.dsh-de-jobs{order:-1;margin:14px 0 22px;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:12px}
.dsh-de-job{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;margin-bottom:6px;background:var(--dsw-alias-bg-layer-1)}
.dsh-de-jobhead{display:flex;align-items:center;gap:8px;font-size:12px}
.dsh-de-state{font-size:11px;padding:1px 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1)}
.dsh-de-state.running{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-de-state.succeeded{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dsh-de-state.failed{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
/* 取消是用户自己按的，不是出错：用中性灰，也不再有那个"还在跑"的脉冲点。 */
.dsh-de-state.cancelled{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}
.dsh-de-pre{margin:6px 0 0;max-height:180px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:8px}
.dsh-de-msg{margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-de-err{margin-top:10px;font-size:12px;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.dsh-de-empty{margin-top:24px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-de-desc{margin:-3px 0 10px 12px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-de-learn{appearance:none;background:transparent;border:none;padding:0;margin-left:6px;font-size:11px;color:var(--dsw-alias-brand-primary);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.dsh-de-learn:hover{opacity:.75}
.dsh-de-rowbusy{font-size:11px;color:var(--dsw-alias-brand-primary);flex:none;display:inline-flex;align-items:center;gap:5px}
.dsh-de-progress{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-de-bar{position:relative;flex:1;min-width:130px;height:14px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;border:1px solid var(--dsw-alias-border-l1)}
.dsh-de-barfill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
/* 百分比叠在槽内：进度由「条」本身表达，旁边的数字只是补充 */
.dsh-de-barlabel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;color:var(--dsw-alias-label-primary);pointer-events:none}
.dsh-de-bar[data-indeterminate="1"] .dsh-de-barfill{width:35%;animation:dsh-de-slide 1.1s ease-in-out infinite}
@keyframes dsh-de-slide{0%{transform:translateX(-100%)}100%{transform:translateX(285%)}}
.dsh-de-activity{max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.dsh-de-state.running::after{content:'';display:inline-block;width:5px;height:5px;margin-left:5px;border-radius:50%;background:currentColor;animation:dsh-de-pulse 1s ease-in-out infinite}
@keyframes dsh-de-pulse{0%,100%{opacity:.25}50%{opacity:1}}
.dsh-de-ok{color:var(--dsw-alias-state-success-primary)}
.dsh-de-ask{display:flex;align-items:center;gap:6px;margin:-4px 0 10px 12px}
.dsh-de-askq{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-de-grouphead{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.dsh-de-job[data-open="1"]{border-color:var(--dsw-alias-brand-primary)}
.dsh-de-detail{margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l1)}
.dsh-de-kv{display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
/* 「已经安装？选择对应文件夹」是次要动作：它排在安装按钮旁边，但不该抢主按钮的注意力。 */
.dsh-de-pick{margin:-4px 0 10px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-de-pickq{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-de-pickmsg{font-size:11px;color:var(--dsw-alias-state-success-primary)}
.dsh-de-pickmsg.bad{color:var(--dsw-alias-state-warn-primary)}
.dsh-de-roots{margin:0 0 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}
.dsh-de-rootrow{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px}
.dsh-de-rootdir{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;color:var(--dsw-alias-label-primary)}
`

    // ------------------------------------------------------------ helpers

    function timeText(ms) {
      if (!ms) return ''
      try {
        return new Date(ms).toLocaleString()
      } catch {
        return ''
      }
    }

    /** 把毫秒说成「1分23秒」这种给人看的东西。 */
    function durationText(ms) {
      const total = Math.max(0, Math.round((ms || 0) / 1000))
      if (total < 60) return `${total}s`
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, '0')}s`
      return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
    }

    /**
     * 字节数说成人话。只用于**我们自己下载**的任务——winget / pip / npm 在管道下不打印体积，
     * 那种任务没有这些字段，也就不显示（编一个数比不显示更糟）。
     */
    function bytesText(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
    }

    /** 速率与剩余时间，只在拿得到真实数据时才返回内容。 */
    function transferText(job, lang) {
      const parts = []
      const speed = bytesText(job.bytesPerSecond)
      if (speed) parts.push(`${speed}/s`)
      if (typeof job.etaSeconds === 'number' && job.etaSeconds >= 0) parts.push(`${t('eta')} ${durationText(job.etaSeconds * 1000)}`)
      const transferred = bytesText(job.receivedBytes)
      const total = bytesText(job.totalBytes)
      if (transferred && total) parts.push(`${transferred} / ${total}`)
      return parts.length ? parts.join('  ·  ') : null
    }

    // 参考链接：中文界面走百度百科，英文界面走维基百科。
    // 都用「搜索」入口而不是具体词条 URL——词条名会被编辑改动，搜索入口永远能落到正确页面，
    // 也就不需要为 82 个条目各维护一个可能失效的链接。
    function referenceUrl(item, lang) {
      const term = lang === 'zh' ? item.name : item.nameEn || item.name
      return lang === 'zh'
        ? `https://baike.baidu.com/search/word?word=${encodeURIComponent(term)}`
        : `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(term)}`
    }

    /** 安装器只会说中英各半，统一翻译成面板语言。 */
    function phaseText(job, lang) {
      if (job.status === 'succeeded') return t('phaseDone')
      if (job.status === 'cancelled') return t('phaseCancelled')
      if (job.status === 'failed') return t('phaseInstall')
      const key = job.phase ? `phase${job.phase[0].toUpperCase()}${job.phase.slice(1)}` : 'phaseWaiting'
      return t(key)
    }

    /**
     * 任务结束时清理边界的说法。host 在取消时如实记录它删了什么、没删什么，
     * 这里只负责把那个字段翻成人话——猜一个更好听的结论就等于把边界藏起来。
     */
    function cleanupText(job) {
      if (job.status !== 'cancelled' || !job.cleanup) return null
      return job.cleanup === 'partial-removed' ? t('cleanupRemoved') : t('cleanupExternal')
    }

    /** 进度条：能从输出里读到百分比就画确定进度，否则画不确定进度（诚实，不假装知道）。 */
    function progressOf(job) {
      if (job.status === 'succeeded') return { percent: 100, indeterminate: false }
      if (typeof job.percent === 'number') return { percent: job.percent, indeterminate: false }
      // 已经停下的任务不该继续画不确定进度——那条滑动的条看起来像"还在下载"。
      // 要么停在最后一个已知百分比，要么是一条空的确定进度条，即"没有更多进展了"。
      if (job.status === 'cancelled' || job.status === 'failed') return { percent: 0, indeterminate: false }
      return { percent: 0, indeterminate: true }
    }

    async function api(path, options) {
      const response = await fetch(API + path, Object.assign({ cache: 'no-store' }, options || {}))
      const data = await response.json().catch(() => null)
      if (!response.ok || !data || data.ok === false) {
        throw new Error((data && data.error) || `HTTP ${response.status}`)
      }
      return data
    }

    // 「选择一个文件夹」只能由 DSH 打开（浏览器给不了真实的本地路径），而那是 host 的能力，
    // 所以走客户端服务 uiWorkspace。它是可选服务：拿不到时按钮直接不显示，
    // 而不是让用户点一个必然报错的按钮。由 apply() 在激活时取一次，之后不再重查——
    // 服务在插件活着的时候不会消失，反复 ctx.get 只会把"有没有"这个问题拖到渲染期。
    let pickDirectoryFn = null

    function pickFolder() {
      return pickDirectoryFn ? pickDirectoryFn() : Promise.resolve(null)
    }

    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text)
        const area = document.createElement('textarea')
        area.value = text
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      } catch {
        /* ignore */
      }
      return Promise.resolve()
    }

    // ------------------------------------------------------------ session handover

    /**
     * 从 owner 交给组件的 props 里取当前会话身份。
     *
     * 会话身份的确切位置取决于 owner 如何 materialize 标准 props，所以按可能性从具体到宽泛依次找。
     * **找不到就不猜**：宁可显示"拿不到会话身份"，也不要把它写到错误的会话上——交接写错会话比不写更糟。
     */
    function sessionIdFrom(props) {
      if (!props) return ''
      const standard = props.standard || {}
      const fromHook =
        typeof standard.useSession === 'function' ? (standard.useSession() || {}).sessionId : undefined
      for (const value of [standard.sessionId, props.sessionId, fromHook]) {
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
      return ''
    }

    /**
     * 「交接」页签：一个对话的精简任务状态，用来在对话到达上限后接着做。
     *
     * 刻意是**结构化的小记录**而不是摘要：还需要做什么、正在做什么、已经做完、下一步。三份清单分开列，
     * 正是因为"已经做完"能阻止新对话把做完的事再推一遍——而那正是交接存在的理由。
     */
    function DevEnvHandoffView(props) {
      const sessionId = sessionIdFrom(props)
      // 两层：`project` 是这份记录属于谁（界面上要显示出来，用户才知道自己在改哪个项目的箱子），
      // `record` 是内容 + 标签。
      const [project, setProject] = React.useState(null)
      const [record, setRecord] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [saved, setSaved] = React.useState(false)
      const [sent, setSent] = React.useState(null)
      const [filling, setFilling] = React.useState(false)
      const [filled, setFilled] = React.useState(false)
      // host 对这次填充的说明（例如"已降级为当前对话"）。必须显示，见 fill() 里的注释。
      const [fillNote, setFillNote] = React.useState(null)
      // 标签选择：{ open, picked }。用户按按钮决定，插件从不自己打标签。
      const [tagChoice, setTagChoice] = React.useState(null)
      // 清空确认：**必须显式确认**。这是条例页签里唯一会删内容的动作，误点一次就丢了整份记录。
      const [confirmClear, setConfirmClear] = React.useState(false)
      // 原始编辑面默认收起：上面两栏已经把这同一份内容只读地摆出来了。
      const [editing, setEditing] = React.useState(false)
      // 设置（只读）：一键填充的方式、标签默认是否全选。
      const [settings, setSettings] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        api(`/settings?lang=${currentLang}`)
          .then((payload) => {
            if (alive) setSettings((payload.settings || {}).values || {})
          })
          .catch(() => {
            /* 读不到设置就按默认行为走，不影响交接本身 */
          })
        return () => {
          alive = false
        }
      }, [])

      // 一次性自检：把组件实际收到的 props 形状打到控制台。会话身份的位置在不同版本里可能不同，
      // 与其猜，不如让第一次运行把事实说出来。
      React.useEffect(() => {
        try {
          console.log('[dsh-dev-env] handover view props:', Object.keys(props || {}), 'sessionId=', sessionId)
        } catch {
          /* 控制台不可用不影响功能 */
        }
      }, [])

      React.useEffect(() => {
        if (!sessionId) return undefined
        let alive = true
        api(`/handoff?sessionId=${encodeURIComponent(sessionId)}`)
          .then((payload) => {
            if (!alive) return
            setProject(payload.project || null)
            setRecord(payload.record || null)
          })
          .catch((err) => {
            if (alive) setError(String((err && err.message) || err))
          })
        return () => {
          alive = false
        }
      }, [sessionId])

      if (!sessionId) {
        return h(
          'div',
          { className: 'dsh-de-handoff' },
          h('style', null, HANDOFF_CSS),
          h('div', { className: 'dsh-de-msg' }, t('handoffNoSession')),
        )
      }
      if (!record) {
        return h(
          'div',
          { className: 'dsh-de-handoff' },
          h('style', null, HANDOFF_CSS),
          h('div', { className: 'dsh-de-msg' }, error || t('loading')),
        )
      }

      // 内容住在 record.handoff 里；标签住在 record.tags。分开是因为生命周期不同：
      // 内容会被反复改写，标签是你按按钮才落下的。
      const handoff = record.handoff || {}

      const patch = (fields) => {
        setSaved(false)
        setRecord((current) => Object.assign({}, current, { handoff: Object.assign({}, current.handoff, fields) }))
      }

      const save = async () => {
        try {
          const payload = await api('/handoff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, record }),
          })
          setProject(payload.project || project)
          setRecord(payload.record || record)
          setSaved(true)
          setError(null)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      /** 把这份交接投给当前对话（host 按活跃度挑选）——"到上限后无缝衔接"的执行动作。 */
      const send = async () => {
        try {
          const payload = await api('/handoff/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // 按**项目**投递，而不是按对话：投出去的是一份项目资料，
            // 所以接手方可以是同项目的另一个对话，也可以是别的项目来取用。
            body: JSON.stringify({ projectKey: project?.key, lang: currentLang }),
          })
          setSent(payload.sessionId || t('handoffAuto'))
          setError(null)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      /** 一键填充：请一个**继承本对话上下文**的子智能体写出条例（或退回用当前对话）。 */
      const fill = async () => {
        setFilling(true)
        setError(null)
        setFilled(false)
        try {
          // 先问能力：选了一条做不到的路径必须**当场报错**，而不是静默换一条——它们的代价不同。
          const capability = (await api(`/handoff/capability?sessionId=${encodeURIComponent(sessionId)}`)).capability || {}
          const preferred = (settings && settings['handoff.autoFillMethod']) || 'fork'
          // 设置里选的那条不可用时，退回"用当前对话"并**说明**，不假装那条成了。
          const method = preferred === 'fork' && !capability.canSubagentFill
            ? 'current'
            : preferred === 'compact' && !capability.canCompact
              ? 'current'
              : preferred
          const payload = await api('/handoff/fill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, method, lang: currentLang }),
          })
          // `fork` 是**同步**完成的：它直接把新记录还给我，所以立刻显示，也能确认真的写入了。
          if (payload.record) {
            setProject(payload.project || project)
            setRecord(payload.record)
            setFilled(true)
          } else {
            // `current` 是异步的（模型随后才调工具），只能先说"已请它写"。
            // **host 的解释必须显示出来**：降级到 current 意味着这次会占用本对话的上下文，
            // 而那是用户选 fork 想避开的东西。把 note 丢掉等于让他为没选的代价买单。
            setFilled(true)
            setFillNote(typeof payload.note === 'string' && payload.note ? payload.note : null)
          }
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setFilling(false)
        }
      }

      /**
       * 打标签。**由用户按按钮决定全部或部分**，插件自己不填——
       * `handoff.tagOnGenerate` 只决定这个选择的**初始状态**。
       */
      const openTags = () => {
        const preset = settings && settings['handoff.tagOnGenerate'] === true ? TAG_CHOICES.map((row) => row.key) : []
        setTagChoice({ open: true, picked: preset })
      }

      const saveTags = async () => {
        const picked = (tagChoice && tagChoice.picked) || []
        setTagChoice(null)
        try {
          const payload = await api('/handoff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, record: Object.assign({}, record, { tags: picked }) }),
          })
          setProject(payload.project || project)
          setRecord(payload.record || record)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      /** 任务清单的就地保存（勾选、增删、拖动都走这里）。 */
      const saveTasks = async (listName, tasks) => {
        // 用 `record.handoff` 而不是 `handoff`：后者在本组件里声明得更晚（TDZ），
        // 而这个函数在渲染期间就会被调用。
        const before = (record && record.handoff) || {}
        const nextHandoff = Object.assign({}, before, { [listName]: tasks })
        // 先本地更新，界面立刻响应；请求失败时再回滚成服务端的真值。
        setRecord((current) => Object.assign({}, current, { handoff: nextHandoff }))
        try {
          const payload = await api('/handoff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, record: Object.assign({}, record, { handoff: nextHandoff }) }),
          })
          setProject(payload.project || project)
          setRecord(payload.record || record)
        } catch (err) {
          setError(String((err && err.message) || err))
          // 回滚：否则界面显示的是没保存成功的内容，而用户以为已经存了。
          setRecord((current) => Object.assign({}, current, { handoff: before }))
        }
      }

      /** 清空条例内容（保留项目身份与标签）。带确认，见 confirmClear。 */
      const clearClause = async () => {
        setConfirmClear(false)
        try {
          const payload = await api('/handoff/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, projectKey: project && project.key }),
          })
          setProject(payload.project || project)
          setRecord(payload.record || record)
          setSaved(false)
          setFilled(false)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      const textField = (key, label, rows) =>
        h(
          'div',
          { className: 'dsh-de-hf' },
          h('label', { className: 'dsh-de-hflabel' }, label),
          h('textarea', {
            className: 'dsh-de-hflist',
            rows,
            value: handoff[key] || '',
            onChange: (event) => patch({ [key]: event.target.value }),
          }),
        )

      const listField = (key, label) =>
        h(
          'div',
          { className: 'dsh-de-hf' },
          h('label', { className: 'dsh-de-hflabel' }, label),
          h('textarea', {
            className: 'dsh-de-hflist',
            rows: 4,
            placeholder: t('handoffOnePerLine'),
            value: (handoff[key] || []).join('\n'),
            // 空行丢掉：清单里的一行就是一件事，空行没有含义。
            onChange: (event) =>
              patch({ [key]: event.target.value.split('\n').map((row) => row.trim()).filter(Boolean) }),
          }),
        )

      return h(
        'div',
        { className: 'dsh-de-handoff' },
        h('style', null, HANDOFF_CSS),
        h(
          'div',
          { className: 'dsh-de-hfhead' },
          h('h2', null, t('handoffTab')),
          saved ? h('span', { className: 'dsh-de-ok' }, t('handoffSaved')) : null,
          sent ? h('span', { className: 'dsh-de-ok' }, `${t('handoffSent')} → ${sent}`) : null,
          h('span', { className: 'dsh-de-spacer' }),
          h('button', { className: 'dsh-de-btn', onClick: fill, disabled: filling }, filling ? t('filling') : t('fillNow')),
          h('button', { className: 'dsh-de-btn danger', onClick: () => setConfirmClear(true) }, t('clearClause')),
          h('button', { className: 'dsh-de-btn', onClick: openTags }, t('tagButton')),
          h('button', { className: 'dsh-de-btn', onClick: () => setEditing((cur) => !cur) }, editing ? t('editClose') : t('editOpen')),
          h('button', { className: 'dsh-de-btn', onClick: save }, t('handoffSave')),
        ),
        filled ? h('div', { className: 'dsh-de-ok' }, fillNote || t('fillSent')) : null,
        // 已打的标签显示出来，让人一眼知道这份记录带着什么用途标记。
        record.tags && record.tags.length
          ? h(
              'div',
              { className: 'dsh-de-pick' },
              record.tags.map((tag) => h('span', { className: 'dsh-de-chip ok', key: tag }, tag)),
            )
          : null,
        h('div', { className: 'dsh-de-pickq' }, t('clauseHint')),
        // 两栏：左「需要提交的事」、右「任务清单（按标签分组）」。
        h(ClauseColumns, {
          handoff,
          tags: record.tags,
          // 标签显示名与任务保存都从这里传进去：子组件不该再自己取一次翻译或会话身份。
          tagOf: (key) => {
            const choice = TAG_CHOICES.find((row) => row.key === key)
            return choice ? choice.label() : key
          },
          onSaveTasks: saveTasks,
        }),
        // 显示这份记录属于哪个项目。用户必须知道自己在改哪个箱子——这正是"末影箱"与"私人笔记"
        // 的区别，藏起来会让人以为它是这个对话的私产。
        h(
          'div',
          { className: 'dsh-de-sourcehost' },
          project
            ? `${t('handoffProject')}: ${project.path || project.key}${project.scope === 'session' ? ` (${t('handoffScopeSession')})` : ''}`
            : '',
        ),
        error ? h('div', { className: 'dsh-de-err' }, error) : null,
        // 原始编辑面**默认收起**。上面两栏已经把同一份内容只读地摆出来了，同时再摊开六个文本框
        // 等于同一份东西显示两遍：读的人要跳过一遍，改的人还容易在两种表示之间打架。
        editing
          ? h(
              'div',
              { className: 'dsh-de-editor' },
              textField('summary', t('handoffSummary'), 2),
              listField('todo', t('handoffTodo')),
              listField('doing', t('handoffDoing')),
              listField('done', t('handoffDone')),
              textField('next', t('handoffNext'), 2),
              textField('notes', t('handoffNotes'), 3),
            )
          : null,
        h(
          'div',
          { className: 'dsh-de-pick' },
          h('button', { className: 'dsh-de-btn', onClick: send }, t('handoffSendCurrent')),
        ),
        // 标签选择。默认全选（或按设置），但**必须按按钮确认**——这是 token 与准确度的取舍点，
        // 交给用户而不是插件替他决定。
        tagChoice
          ? h(
              'div',
              { className: 'dsh-de-modal' },
              h(
                'div',
                { className: 'dsh-de-dialog' },
                h('h2', null, t('tagPick')),
                h('div', { className: 'dsh-de-pickq' }, t('tagPickHint')),
                h(
                  'div',
                  { className: 'dsh-de-pick' },
                  h(
                    'button',
                    { className: 'dsh-de-btn', onClick: () => setTagChoice({ open: true, picked: TAG_CHOICES.map((row) => row.key) }) },
                    t('tagAll'),
                  ),
                  h('button', { className: 'dsh-de-btn', onClick: () => setTagChoice({ open: true, picked: [] }) }, t('tagNone')),
                ),
                TAG_CHOICES.map((choice) =>
                  h(
                    'label',
                    { className: 'dsh-de-setlabel', key: choice.key },
                    h('input', {
                      type: 'checkbox',
                      checked: tagChoice.picked.includes(choice.key),
                      onChange: (event) =>
                        setTagChoice((current) => ({
                          open: true,
                          picked: event.target.checked
                            ? current.picked.concat(choice.key)
                            : current.picked.filter((row) => row !== choice.key),
                        })),
                    }),
                    h('span', null, `${choice.label()}  ·  ${choice.key}`),
                  ),
                ),
                h(
                  'div',
                  { className: 'dsh-de-pick' },
                  h('button', { className: 'dsh-de-btn', onClick: saveTags }, t('tagConfirm')),
                  h('button', { className: 'dsh-de-btn', onClick: () => setTagChoice(null) }, t('pickSourceCancel')),
                ),
              ),
            )
          : null,
        // 清空确认。用模态而不是 window.confirm：后者会阻塞渲染线程，而且在嵌入式 webview 里
        // 表现不一致。文案里写清**保留什么**（项目身份与标签），因为"清空"最容易让人担心这一层。
        confirmClear
          ? h(
              'div',
              { className: 'dsh-de-modal' },
              h(
                'div',
                { className: 'dsh-de-dialog' },
                h('h2', null, t('clearConfirmTitle')),
                h('div', { className: 'dsh-de-pickq' }, t('clearConfirmBody')),
                h(
                  'div',
                  { className: 'dsh-de-pick' },
                  h('button', { className: 'dsh-de-btn danger', onClick: clearClause }, t('clearConfirmGo')),
                  h('button', { className: 'dsh-de-btn', onClick: () => setConfirmClear(false) }, t('clearConfirmCancel')),
                ),
              ),
            )
          : null,
      )
    }

    /**
     * 右栏的任务清单：可勾选、可增删、**可拖动排序**（顺序即优先级）。
     *
     * 拖动用原生 HTML5 draggable，而不是引第三方库：这个插件是零依赖的，为一个列表引入一个拖拽库
     * 不划算。代价是触屏上拖不动，而这是一个桌面应用的侧栏。
     */
    function TaskList({ listName, tasks, tagOf, onSave }) {
      const [dragging, setDragging] = React.useState(null)
      const [over, setOver] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [editing, setEditing] = React.useState(null)

      /** 改一项就整份写回：每条一次请求会让连续拖动变成一串请求。 */
      const commit = (next) => onSave(listName, next)

      const toggle = (id) => commit(tasks.map((row) => (row.id === id ? Object.assign({}, row, { done: !row.done }) : row)))
      const remove = (id) => commit(tasks.filter((row) => row.id !== id))
      const rename = (id, text) => commit(tasks.map((row) => (row.id === id ? Object.assign({}, row, { text }) : row)))

      const add = () => {
        const text = draft.trim()
        if (!text) return
        // id 本地生成即可；host 会再归一化一次并保证唯一。
        commit(tasks.concat({ id: `t${Date.now().toString(36)}`, text, done: false, tag: null }))
        setDraft('')
      }

      /** 按 **id** 而不是下标移动：拖动过程中下标会变，按下标会移到错误的位置。 */
      const move = (fromId, toId) => {
        if (fromId === toId) return
        const from = tasks.findIndex((row) => row.id === fromId)
        const to = tasks.findIndex((row) => row.id === toId)
        if (from < 0 || to < 0) return
        const next = tasks.slice()
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        commit(next)
      }

      return h(
        'div',
        { className: 'dsh-de-tasks' },
        tasks.length
          ? tasks.map((task, index) =>
              h(
                'div',
                {
                  key: task.id,
                  className: `dsh-de-task${over === task.id ? ' over' : ''}${dragging === task.id ? ' dragging' : ''}`,
                  draggable: 'true',
                  onDragStart: () => setDragging(task.id),
                  onDragOver: (event) => {
                    // 必须 preventDefault，否则浏览器不把这里当落点。
                    if (event && event.preventDefault) event.preventDefault()
                    setOver(task.id)
                  },
                  onDragLeave: () => setOver((cur) => (cur === task.id ? null : cur)),
                  onDrop: () => {
                    if (dragging) move(dragging, task.id)
                    setDragging(null)
                    setOver(null)
                  },
                  onDragEnd: () => {
                    setDragging(null)
                    setOver(null)
                  },
                },
                h('span', { className: 'dsh-de-taskgrip', title: t('taskDragHint') }, '⋮⋮'),
                h('span', { className: 'dsh-de-taskno' }, String(index + 1)),
                h('input', {
                  type: 'checkbox',
                  checked: task.done === true,
                  onChange: () => toggle(task.id),
                  title: t('taskToggle'),
                }),
                editing === task.id
                  ? h('input', {
                      className: 'dsh-de-taskedit',
                      value: task.text,
                      onChange: (event) => rename(task.id, event.target.value),
                      onBlur: () => setEditing(null),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') setEditing(null)
                      },
                    })
                  : h(
                      'span',
                      {
                        className: `dsh-de-tasktext${task.done ? ' done' : ''}`,
                        onClick: () => setEditing(task.id),
                        title: t('taskEditHint'),
                      },
                      task.text,
                    ),
                task.tag ? h('span', { className: 'dsh-de-tasktag' }, tagOf(task.tag)) : null,
                h('button', { className: 'dsh-de-taskdel', onClick: () => remove(task.id), title: t('taskDelete') }, '×'),
              ),
            )
          : h('div', { className: 'dsh-de-msg' }, t('clauseRightEmpty')),
        h(
          'div',
          { className: 'dsh-de-taskadd' },
          h('input', {
            className: 'dsh-de-taskedit',
            placeholder: t('taskAddPlaceholder'),
            value: draft,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') add()
            },
          }),
          h('button', { className: 'dsh-de-btn', onClick: add }, t('taskAdd')),
        ),
      )
    }

    /** 用途标签的候选。**只在这里定义一次**，界面与文档都取它，免得两处清单漂移。 */
    const TAG_CHOICES = [
      { key: 'continuation', label: () => t('tagContinuation') },
      { key: 'project-material', label: () => t('tagProjectMaterial') },
      { key: 'reusable', label: () => t('tagReusable') },
      { key: 'decision', label: () => t('tagDecision') },
      { key: 'handover-open', label: () => t('tagOpen') },
    ]

    /**
     * 条例的两栏。
     *
     * **左栏「需要提交的事」**＝这个项目对外要交出去的东西：目标与约束、已完成（产出物）、经验与坑、
     * 下一步。**右栏「任务清单」**＝待办与进行中，**按标签分组**（未打标签的归到「未分类」），
     * 因为标签就是"这件事属于哪一类工作"的分组依据。
     *
     * 两栏的区别不是装饰：左栏是"已经/将要交出去什么"，右栏是"还要做什么"。
     */
    function ClauseColumns({ handoff, tags, tagOf, onSaveTasks }) {
      // 右栏按标签分组，但**每一组内部仍是可拖动的任务清单**；分组只是视觉归类。
      const byTag = new Map()
      for (const choice of TAG_CHOICES) byTag.set(choice.key, [])
      byTag.set('__untagged__', [])
      for (const row of handoff.todo || []) {
        const key = tags.find((tag) => byTag.has(tag)) || '__untagged__'
        byTag.get(key).push(row)
      }

      const leftBlock = (title, text) =>
        text ? h('div', { className: 'dsh-de-cl-block' }, h('h4', null, title), h('div', { className: 'dsh-de-cl-body' }, text)) : null
      const allTasks = handoff.todo || []

      return h(
        'div',
        { className: 'dsh-de-clause' },
        h(
          'div',
          { className: 'dsh-de-cl-col' },
          h('h3', { className: 'dsh-de-cl-title' }, t('clauseLeft')),
          leftBlock(t('handoffSummary'), handoff.summary),
          (handoff.done || []).length
            ? h(
                'div',
                { className: 'dsh-de-cl-block' },
                h('h4', null, t('handoffDone')),
                h('ul', { className: 'dsh-de-cl-list' }, (handoff.done || []).map((text) => h('li', { key: text }, text))),
              )
            : null,
          leftBlock(t('handoffNotes'), handoff.notes),
          leftBlock(t('handoffNext'), handoff.next),
          !handoff.summary && !handoff.notes && !handoff.next && !(handoff.done || []).length
            ? h('div', { className: 'dsh-de-msg' }, t('clauseLeftEmpty'))
            : null,
        ),
        h(
          'div',
          { className: 'dsh-de-cl-col' },
          h(
            'h3',
            { className: 'dsh-de-cl-title' },
            `${t('clauseRight')} · ${allTasks.length} ${t('clauseCount')}`,
            h('span', { className: 'dsh-de-cl-sub' }, t('clauseReorder')),
          ),
          // 拖动排序要求整份列表在一个容器里，所以按标签分组时**每个分组各带一个清单**，
          // 组内可拖动——跨组拖动会改变意义（换标签），那是另一件事，不做。
          allTasks.length
            ? tags.length
              ? [...byTag.entries()]
                  .filter(([, items]) => items.length)
                  .map(([key, items]) => {
                    const choice = TAG_CHOICES.find((row) => row.key === key)
                    return h(
                      'div',
                      { className: 'dsh-de-cl-group', key },
                      h(
                        'div',
                        { className: 'dsh-de-cl-grouptitle' },
                        choice ? choice.label() : t('clauseUntagged'),
                        h('span', { className: 'dsh-de-cl-count' }, String(items.length)),
                      ),
                      h(TaskList, { listName: 'todo', tasks: items, tagOf, onSave: onSaveTasks, t }),
                    )
                  })
              : h(TaskList, { listName: 'todo', tasks: allTasks, tagOf, onSave: onSaveTasks, t })
            : h(TaskList, { listName: 'todo', tasks: [], tagOf, onSave: onSaveTasks, t }),
        ),
      )
    }

    /**
     * 输入框上方的项目条例选择器（`conversation.input.dock`）。
     *
     * 这个位置是 **list 型、replaceRisk 为 none**，所以加自己的 id 只会**落在现有条目旁边**
     * （todo / goal / queue），不顶掉任何东西。新对话界面（hero）那三个位置都是**单占**且已被占用，
     * 注册进去会覆盖 DSH 自带 UI，所以没在那里做。
     *
     * 两件事：
     *   ① **手动传递**：勾选一份条例，把它作为大前提发进当前对话。
     *   ② **自动带入**：新对话建立时问一次 host 要不要带。开关在设置里，**默认关**（要花 token）。
     *      刻意做成**幂等**：一个会话只试一次，刷新不会重复投递。
     */
    function DevEnvClauseDock(props) {
      const sessionId = sessionIdFrom(props)
      const [projects, setProjects] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const [error, setError] = React.useState(null)
      // 自动带入只做一次：这个组件的每次挂载对应一个会话，重复投递会污染上下文。
      const seeded = React.useRef(false)

      React.useEffect(() => {
        if (!sessionId || seeded.current) return
        seeded.current = true
        api('/handoff/seed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, lang: currentLang }),
        })
          .then((payload) => {
            if (payload && payload.injected) setNote(t('clauseAutoInjected'))
          })
          .catch(() => {
            /* 自动带入失败不打扰用户：它是可选增强，报错只会在新对话里制造噪音 */
          })
      }, [sessionId])

      const load = async () => {
        if (projects) return
        try {
          const payload = await api(`/handoff/projects?sessionId=${encodeURIComponent(sessionId)}`)
          setProjects(payload.projects || [])
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      const send = async (projectKey) => {
        setBusy(true)
        setError(null)
        try {
          const payload = await api('/handoff/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectKey, sessionId, lang: currentLang }),
          })
          setNote(payload.summary || t('clauseSent'))
          setOpen(false)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      if (!sessionId) return null

      return h(
        'div',
        { className: 'dsh-de-dock' },
        h('style', null, DOCK_CSS),
        h(
          'button',
          {
            className: 'dsh-de-dockbtn',
            onClick: () => {
              setOpen((cur) => !cur)
              load()
            },
            title: t('clauseDockHint'),
          },
          `📋 ${t('clauseDock')}`,
        ),
        note ? h('span', { className: 'dsh-de-ok' }, note) : null,
        error ? h('span', { className: 'dsh-de-err' }, error) : null,
        open
          ? h(
              'div',
              { className: 'dsh-de-dockpanel' },
              h('div', { className: 'dsh-de-pickq' }, t('clauseDockPick')),
              projects === null
                ? h('div', { className: 'dsh-de-msg' }, t('clauseDockLoading'))
                : projects.length
                  ? projects.map((project) =>
                      h(
                        'div',
                        {
                          className: 'dsh-de-source',
                          key: project.projectKey,
                          'data-first': project.isCurrent ? '1' : '0',
                        },
                        h(
                          'div',
                          { className: 'dsh-de-sourcemain' },
                          h(
                            'div',
                            { className: 'dsh-de-sourcename' },
                            `${project.projectPath || project.projectKey}${project.isCurrent ? ` · ${t('clauseDockCurrent')}` : ''}`,
                          ),
                          h(
                            'div',
                            { className: 'dsh-de-sourcehost' },
                            `${project.summary || t('clauseDockEmpty')} · ${project.open} ${t('clauseCount')}`,
                          ),
                        ),
                        h(
                          'button',
                          { className: 'dsh-de-btn', disabled: busy, onClick: () => send(project.projectKey) },
                          t('clauseDockSend'),
                        ),
                      ),
                    )
                  : h('div', { className: 'dsh-de-msg' }, t('clauseDockNone')),
            )
          : null,
      )
    }

    const DOCK_CSS = `
.dsh-de-dock{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 4px;font-size:12px;position:relative}
.dsh-de-dockbtn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:999px;padding:2px 10px;font-size:12px;cursor:pointer}
.dsh-de-dockbtn:hover{border-color:var(--dsw-alias-brand-primary)}
.dsh-de-dockpanel{position:absolute;bottom:100%;left:0;margin-bottom:6px;z-index:30;width:min(560px,90vw);max-height:340px;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
`

    /**
     * 「状态」页签：把 `dev_env_state` 用到的那些数字**画出来**。
     *
     * 与工具读的是**同一个测量函数**（host 的 `/api/state` 调 `measureState`），所以页签上的百分比
     * 和模型看到的一致——否则用户会以为模型在报一个它自己都没看到的数。
     *
     * 页签只读：不写任何东西，也不给"健康分数"。数字是死的，判断在用户手里。
     */
    function DevEnvStateView(props) {
      const sessionId = sessionIdFrom(props)
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [ticked, setTicked] = React.useState({})

      React.useEffect(() => {
        if (!sessionId) return undefined
        let alive = true
        // 每 10 秒自己刷新：状态随时间变，只在打开时取一次会让它一进来就过时。
        const load = () => {
          api(`/state?sessionId=${encodeURIComponent(sessionId)}&lang=${currentLang}`)
            .then((payload) => {
              if (alive) setState(payload.state)
            })
            .catch((err) => {
              if (alive) setError(String((err && err.message) || err))
            })
        }
        load()
        const timer = setInterval(load, 10000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [sessionId])

      const shell = (body) => h('div', { className: 'dsh-de-state' }, h('style', null, STATE_CSS), body)

      if (!sessionId) return shell(h('div', { className: 'dsh-de-msg' }, t('handoffNoSession')))
      if (!state) return shell(h('div', { className: 'dsh-de-msg' }, error || t('loading')))

      const pressure = state.pressure || {}
      const ratio = typeof pressure.ratio === 'number' ? pressure.ratio : null
      const band = (state.bands || []).find((row) => row.id === pressure.band) || null
      const percent = ratio === null ? null : Math.max(0, Math.min(100, ratio * 100))
      // 越接近上限越醒目。颜色在这里定，阈值仍由 host 的档位给出——不在两处各写一遍。
      const color =
        pressure.band === 'critical'
          ? 'var(--dsw-alias-danger-primary, #d33)'
          : pressure.band === 'hot'
            ? 'var(--dsw-alias-warning-primary, #d80)'
            : 'var(--dsw-alias-brand-primary)'
      const tickCount = Object.values(ticked).filter(Boolean).length
      const num = (value) => (typeof value === 'number' ? value.toLocaleString() : '—')

      return shell(
        h(
          'div',
          null,
          h('h2', { className: 'dsh-de-stateh' }, t('stateTab')),
          h('div', { className: 'dsh-de-pickq' }, t('stateIntro')),

          // 主视觉：一根饱和度条 + 一个大数字——"调用的数字"里最需要被看见的那个。
          h(
            'div',
            { className: 'dsh-de-gauge' },
            h(
              'div',
              { className: 'dsh-de-gaugehead' },
              h('span', { className: 'dsh-de-gaugeval' }, percent === null ? '—' : `${percent.toFixed(1)}%`),
              h('span', { className: 'dsh-de-gaugeband' }, band ? (currentLang === 'zh' ? band.zh : band.en) : t('stateUnknown')),
            ),
            h('div', { className: 'dsh-de-bar' }, h('span', { style: { width: `${percent === null ? 0 : percent}%`, background: color } })),
            h(
              'div',
              { className: 'dsh-de-gaugesub' },
              percent === null ? pressure.reason || t('stateUnknownHint') : `${num(pressure.usedTokens)} / ${num(pressure.contextWindow)} tokens`,
            ),
            band ? h('div', { className: 'dsh-de-gaugeadvice' }, currentLang === 'zh' ? band.advice.zh : band.advice.en) : null,
          ),

          // 次要数字：它们解释"上下文为什么涨上来的"。
          h(
            'div',
            { className: 'dsh-de-figs' },
            h('div', { className: 'dsh-de-fig' }, h('b', null, num(state.messages)), h('span', null, t('stateMessages'))),
            h('div', { className: 'dsh-de-fig' }, h('b', null, num(state.compactions)), h('span', null, t('stateCompactions'))),
          ),

          // 清单：**勾选只在本页有效、不上报**。它是给人自查用的，不是数据。
          h(
            'div',
            { className: 'dsh-de-setgroup' },
            h('div', { className: 'dsh-de-setgrouptitle' }, `${t('stateChecklist')}${tickCount ? ` · ${tickCount}` : ''}`),
            h('div', { className: 'dsh-de-setwhy' }, t('stateChecklistHint')),
            (state.checklist || []).map((symptom) =>
              h(
                'label',
                { className: 'dsh-de-statecheck', key: symptom.id },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(ticked[symptom.id]),
                  onChange: (event) => setTicked((cur) => Object.assign({}, cur, { [symptom.id]: event.target.checked })),
                }),
                h('span', null, currentLang === 'zh' ? symptom.zh : symptom.en),
              ),
            ),
            tickCount >= 2 ? h('div', { className: 'dsh-de-err' }, t('stateChecklistWarn')) : null,
          ),

          h('div', { className: 'dsh-de-setwhy' }, t('stateLimitNote')),
        ),
      )
    }

    const STATE_CSS = `
.dsh-de-state{padding:16px 18px;font-size:13px;color:var(--dsw-alias-label-primary);overflow:auto;height:100%;box-sizing:border-box}
.dsh-de-stateh{margin:0 0 4px;font-size:14px;font-weight:600}
.dsh-de-gauge{margin:14px 0 16px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dsh-de-gaugehead{display:flex;align-items:baseline;gap:10px}
.dsh-de-gaugeval{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums}
.dsh-de-gaugeband{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-de-bar{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin:8px 0 6px}
.dsh-de-bar span{display:block;height:100%;border-radius:999px;transition:width .4s ease}
.dsh-de-gaugesub{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-de-gaugeadvice{font-size:12px;line-height:1.6;margin-top:6px}
.dsh-de-figs{display:flex;gap:10px;margin-bottom:14px}
.dsh-de-fig{flex:1;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:2px}
.dsh-de-fig b{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.dsh-de-fig span{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-de-statecheck{display:flex;align-items:flex-start;gap:7px;padding:4px 2px;font-size:12px;line-height:1.5;cursor:pointer}
`

    /** 页签自己的样式。面板那份 CSS 是另一个座位的，不该互相依赖。 */
    const HANDOFF_CSS = `
.dsh-de-handoff{padding:16px 18px;font-size:13px;color:var(--dsw-alias-label-primary);overflow:auto;height:100%;box-sizing:border-box}
.dsh-de-hfhead{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.dsh-de-hfhead h2{margin:0;font-size:14px;font-weight:600}
.dsh-de-hf{margin-top:10px}
.dsh-de-hflabel{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.dsh-de-hflist{width:100%;box-sizing:border-box;resize:vertical;font:inherit;font-size:12px;line-height:1.5;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
/* 两栏条例。窄的时候换行成上下，因为半栏宽度的长文本读起来很糟。 */
.dsh-de-clause{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
@media (max-width:720px){.dsh-de-clause{grid-template-columns:1fr}}
.dsh-de-cl-col{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.dsh-de-cl-title{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}
.dsh-de-cl-sub{font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-de-cl-block{margin-bottom:10px}
.dsh-de-cl-block h4{margin:0 0 3px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dsh-de-cl-body{font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.dsh-de-cl-group{margin-bottom:10px}
.dsh-de-cl-grouptitle{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;margin-bottom:4px}
.dsh-de-cl-count{font-weight:400;opacity:.7}
.dsh-de-cl-list{margin:0;padding-left:18px;font-size:12px;line-height:1.6}
.dsh-de-cl-list li{margin-bottom:2px;word-break:break-word}
/* 任务行：整行可拖动。抓手给一个可见提示，否则没人知道能拖。 */
.dsh-de-tasks{display:flex;flex-direction:column;gap:2px}
.dsh-de-task{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:5px;border:1px solid transparent;font-size:12px;line-height:1.5}
.dsh-de-task:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-de-task.dragging{opacity:.5}
.dsh-de-task.over{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-de-taskgrip{cursor:grab;color:var(--dsw-alias-label-secondary);opacity:.55;flex:none;letter-spacing:-2px}
.dsh-de-taskno{flex:none;min-width:14px;text-align:right;color:var(--dsw-alias-label-secondary);font-size:11px}
.dsh-de-tasktext{flex:1;min-width:0;word-break:break-word;cursor:text}
.dsh-de-tasktext.done{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}
.dsh-de-tasktag{flex:none;font-size:10px;padding:1px 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-de-taskdel{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:1;padding:0 3px}
.dsh-de-taskdel:hover{color:var(--dsw-alias-brand-primary)}
.dsh-de-taskedit{flex:1;min-width:0;font:inherit;font-size:12px;padding:2px 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsh-de-taskadd{display:flex;gap:6px;margin-top:6px}
`

    // ------------------------------------------------------------ settings page

    /**
     * 设置页（注册进 `settings.section`）。
     *
     * 一页而不是往 General 里塞几行：这些设置是**一组**默认行为，放在一起才看得出它们怎样互相影响
     * （比如"优先官方源"与"显示国内镜像"）。每一项都显示一句**它会改变什么**——一个说不清的开关
     * 比没有这个开关更糟。
     */
    function DevEnvSettingsSection() {
      const [view, setView] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [saved, setSaved] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        api(`/settings?lang=${currentLang}`)
          .then((payload) => {
            if (alive) setView(payload.settings)
          })
          .catch((err) => {
            if (alive) setError(String((err && err.message) || err))
          })
        return () => {
          alive = false
        }
      }, [])

      if (!view) {
        return h('div', { className: 'dsh-de-settings' }, h('div', { className: 'dsh-de-msg' }, error || t('loading')))
      }

      const set = (key, value) => {
        setSaved(false)
        setView((current) =>
          Object.assign({}, current, { values: Object.assign({}, current.values, { [key]: value }) }),
        )
      }

      const save = async () => {
        try {
          const payload = await api('/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: view.values, lang: currentLang }),
          })
          // 用**读回**的值刷新：类型不符的键会被回落到默认，界面必须显示实际生效的那个，
          // 否则用户会以为自己的值被接受了。
          setView(payload.settings)
          setSaved(true)
          setError(null)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      return h(
        'div',
        { className: 'dsh-de-settings' },
        h('style', null, SETTINGS_CSS),
        h(
          'div',
          { className: 'dsh-de-sethead' },
          h('h2', null, t('settingsTitle')),
          saved ? h('span', { className: 'dsh-de-ok' }, t('settingsSaved')) : null,
          h('span', { className: 'dsh-de-spacer' }),
          h('button', { className: 'dsh-de-btn', onClick: save }, t('settingsSave')),
        ),
        h('div', { className: 'dsh-de-pickq' }, t('settingsIntro')),
        error ? h('div', { className: 'dsh-de-err' }, error) : null,
        view.groups.map((group) =>
          h(
            'div',
            { className: 'dsh-de-setgroup', key: group.id },
            h('div', { className: 'dsh-de-setgrouptitle' }, group.label),
            group.items.map((item) => {
              // 当前选中的那个恰好不可用（配置文件里早就写着 `compact`）：选项一样禁用——否则用户把
              // 它再选一次时不会遇到任何阻止——同时在下面写明它为什么不会被接受。**不禁用整个下拉**：
              // 那会让唯一能用的几个选项也点不动。
              const blockedCurrent = (item.unavailable || []).find((row) => row.value === item.value)
              return h(
                'div',
                { className: 'dsh-de-setrow', key: item.key },
                // enum 用下拉、布尔用复选框：把"二选一"画成勾选框会让人以为可以都不选。
                item.type === 'enum'
                  ? h(
                      'label',
                      { className: 'dsh-de-setlabel' },
                      h(
                        'select',
                        {
                          className: 'dsh-de-setselect',
                          value: view.values[item.key],
                          onChange: (event) => set(item.key, event.target.value),
                        },
                        (item.values || []).map((value) => {
                          // 运行时探测判定一定失败的候选值直接禁掉：一个选了才知道不行的选项，
                          // 等于把失败推迟到最不方便的时刻。
                          const blocked = (item.unavailable || []).find((row) => row.value === value)
                          return h(
                            'option',
                            {
                              value,
                              key: value,
                              disabled: Boolean(blocked),
                              title: blocked ? blocked.reason : undefined,
                            },
                            t(value === 'fork' ? 'methodFork' : value === 'compact' ? 'methodCompact' : 'methodCurrent'),
                          )
                        }),
                      ),
                      h('span', null, item.label),
                    )
                  : h(
                      'label',
                      { className: 'dsh-de-setlabel' },
                      h('input', {
                        type: 'checkbox',
                        checked: Boolean(view.values[item.key]),
                        onChange: (event) => set(item.key, event.target.checked),
                      }),
                      h('span', null, item.label),
                    ),
                h('div', { className: 'dsh-de-setwhy' }, item.why),
                blockedCurrent
                  ? h(
                      'div',
                      { className: 'dsh-de-setwarn' },
                      `${t('settingsUnavailable')}${blockedCurrent.reason}`,
                    )
                  : null,
                h('div', { className: 'dsh-de-setkey' }, item.key),
              )
            }),
          ),
        ),
      )
    }

    /**
     * 设置里的说明书页。内容来自 `/api/manual`，与 `dev_env_manual` 工具**同源**——
     * 界面显示的和 DSH 读到的不可能不一致，否则模型会照着与界面不符的说明做事。
     */
    function DevEnvManualSection() {
      const [view, setView] = React.useState(null)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        api(`/manual?lang=${currentLang}`)
          .then((payload) => {
            if (alive) setView(payload.manual)
          })
          .catch((err) => {
            if (alive) setError(String((err && err.message) || err))
          })
        return () => {
          alive = false
        }
      }, [])

      if (!view) {
        return h('div', { className: 'dsh-de-settings' }, h('div', { className: 'dsh-de-msg' }, error || t('loading')))
      }

      /** 说明书正文里有 `**粗体**` 与反引号——渲染成真实样式，而不是把标记原样显示。 */
      const rich = (text) => {
        const nodes = []
        let rest = String(text)
        let key = 0
        for (;;) {
          const bold = /\*\*([^*]+)\*\*/.exec(rest)
          const code = /`([^`]+)`/.exec(rest)
          const next = [bold, code].filter(Boolean).sort((a, b) => a.index - b.index)[0]
          if (!next) {
            if (rest) nodes.push(rest)
            break
          }
          if (next.index > 0) nodes.push(rest.slice(0, next.index))
          nodes.push(
            next === bold
              ? h('b', { key: `b${key++}` }, next[1])
              : h('code', { className: 'dsh-de-cmd', key: `c${key++}` }, next[1]),
          )
          rest = rest.slice(next.index + next[0].length)
        }
        return nodes
      }

      return h(
        'div',
        { className: 'dsh-de-settings' },
        h('style', null, SETTINGS_CSS),
        h('div', { className: 'dsh-de-sethead' }, h('h2', null, view.title)),
        h('div', { className: 'dsh-de-pickq' }, view.intro),
        error ? h('div', { className: 'dsh-de-err' }, error) : null,
        view.sections.map((section) =>
          h(
            'div',
            { className: 'dsh-de-setgroup', key: section.id },
            h('div', { className: 'dsh-de-setgrouptitle' }, section.title),
            section.body.map((paragraph, index) => h('div', { className: 'dsh-de-setwhy', key: index }, rich(paragraph))),
          ),
        ),
        h(
          'div',
          { className: 'dsh-de-setgroup' },
          h('div', { className: 'dsh-de-setgrouptitle' }, t('manualTools')),
          view.tools.map((tool) =>
            h(
              'div',
              { className: 'dsh-de-setrow', key: tool.name },
              h(
                'div',
                { className: 'dsh-de-setlabel' },
                h('code', { className: 'dsh-de-cmd' }, tool.name),
                h('span', null, ` — ${tool.when}`),
              ),
              h('div', { className: 'dsh-de-setwhy' }, rich(tool.does)),
              h('div', { className: 'dsh-de-setkey' }, tool.note),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dsh-de-setgroup' },
          h('div', { className: 'dsh-de-setgrouptitle' }, t('manualSettings')),
          view.settings.map((row) =>
            h(
              'div',
              { className: 'dsh-de-setrow', key: row.key },
              h('div', { className: 'dsh-de-setwhy' }, rich(row.text)),
              h('div', { className: 'dsh-de-setkey' }, row.key),
            ),
          ),
        ),
      )
    }

    const SETTINGS_CSS = `
.dsh-de-settings{padding:16px 18px;font-size:13px;color:var(--dsw-alias-label-primary);overflow:auto;height:100%;box-sizing:border-box}
.dsh-de-sethead{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.dsh-de-sethead h2{margin:0;font-size:14px;font-weight:600}
.dsh-de-setgroup{margin-top:16px}
.dsh-de-setgrouptitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.dsh-de-setrow{padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin-bottom:6px;background:var(--dsw-alias-bg-layer-1)}
.dsh-de-setlabel{display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer}
.dsh-de-setwhy{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin-top:4px}
.dsh-de-setwarn{font-size:12px;line-height:1.6;color:var(--dsw-alias-warning-primary, #b45309);margin-top:4px}
.dsh-de-setkey{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.65;margin-top:3px}
`

    // ------------------------------------------------------------ sidebar icon

    function DevEnvIcon(props) {
      const size = (props && props.size) || 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', {
          x: 1.7,
          y: 2.6,
          width: 12.6,
          height: 10.8,
          rx: 2,
          stroke: 'currentColor',
          strokeWidth: 1.4,
        }),
        h('path', {
          d: 'M4.8 6.3 7 8 4.8 9.7',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M8.6 9.9h2.8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    // ------------------------------------------------------------ page

    function DevEnvPage() {
      const [data, setData] = React.useState(null)
      const [jobs, setJobs] = React.useState([])
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(null)
      const [tab, setTab] = React.useState('missing')
      const [category, setCategory] = React.useState('')
      const [copied, setCopied] = React.useState(null)
      const [lang, setLang] = React.useState(currentLang)
      const [now, setNow] = React.useState(() => Date.now())
      const [detail, setDetail] = React.useState(null)
      const [ask, setAsk] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      // 正在取消的任务 id。取消要杀的是整棵进程树，可能要等一会儿才返回，
      // 这期间按钮必须自己锁住，否则用户会连点，而第二次请求只会拿到「任务已经结束」。
      const [cancelling, setCancelling] = React.useState(null)
      const [roots, setRoots] = React.useState([])
      // 正在等目录选择器的条目 id。打开系统对话框期间按钮要锁住，否则会开出第二个对话框。
      const [picking, setPicking] = React.useState(null)
      // 选完之后每个条目各自的结果：认出来了 / 缺什么。放在行下面，而不是顶部那一条全局错误里，
      // 因为用户刚在**这一行**做了选择，回执就该出现在这一行。
      const [pickResult, setPickResult] = React.useState(null)
      // 卸载：正在等哪个条目的请求、以及哪个条目正在等二次确认。
      // 确认状态必须落到 UI 上（而不是 window.confirm），因为它是这个面板里唯一
      // 会真的删东西的动作，提示文案也要能带上"这是核心工具"这类上下文。
      const [uninstalling, setUninstalling] = React.useState(null)
      const [confirmUninstall, setConfirmUninstall] = React.useState(null)
      // 正在把哪条任务转交给 DSH 求助（按钮要锁住，避免重复投递同一份日志）。
      const [helping, setHelping] = React.useState(null)
      // 下载来源选择器：{ itemId, sources, checking, secondsLeft }。
      // 只对"我们自己下载"的条目出现——winget/pip/npm 怎么取包不由我们决定，列出源就是假选项。
      const [picker, setPicker] = React.useState(null)
      // 任务列表的"交给某个对话"：{ sessions, loading, error }。多对话传递的入口。
      const [handoff, setHandoff] = React.useState(null)
      // 交接成功后的提示。单独一个状态，不复用按条目键控的 notice——任务列表不是"某个条目"。
      const [handoffNotice, setHandoffNotice] = React.useState(null)
      const runningRef = React.useRef(0)

      const load = React.useCallback(async (refresh) => {
        setLoading(true)
        try {
          // 根目录列表和清单一起取：面板要在同一次刷新里既显示"缺什么"，也显示"都在搜哪些目录"，
          // 分成两次会让两者短暂不一致。
          const [payload, rootsPayload] = await Promise.all([
            api(`/inventory${refresh ? '?refresh=1' : ''}`),
            api('/roots').catch(() => null),
          ])
          setData(payload)
          if (rootsPayload) setRoots(rootsPayload.roots || [])
          setError(null)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        load(false)
      }, [load])

      // 轮询补齐任务；有任务刚从 running 结束时自动刷新清单。
      // 有任务在跑时把间隔压到 1 秒——否则进度条读起来像"卡死了"。
      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          try {
            const payload = await api('/jobs')
            if (!alive) return
            const list = payload.jobs || []
            setJobs(list)
            const running = list.filter((job) => job.status === 'running').length
            if (runningRef.current > 0 && running < runningRef.current) load(true)
            runningRef.current = running
            timer = setTimeout(tick, running > 0 ? 1000 : 2000)
          } catch {
            /* 轮询失败不打扰用户，退到慢速重试 */
            if (alive) timer = setTimeout(tick, 4000)
          }
        }
        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [load])

      // 每秒重画一次，让「已用 12s」自己走字。纯前端计时，不为这个打扰服务端。
      React.useEffect(() => {
        if (!jobs.some((job) => job.status === 'running')) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [jobs])

      const install = async (item, mode, source) => {
        setBusy(item.id)
        try {
          const body = { id: item.id, mode: mode || 'auto' }
          // 只有用户/倒计时真的选了来源才带上它；不带就是 host 的默认来源。
          if (source) body.source = source
          await api('/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const payload = await api('/jobs')
          setJobs(payload.jobs || [])
          runningRef.current = (payload.jobs || []).filter((job) => job.status === 'running').length
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy(null)
        }
      }

      /** 从任务详情里按 mode 重新走一次安装（用于"改用自己下载"这种退路）。 */
      const installById = (itemId, mode) => {
        const item = items.find((row) => row.id === itemId)
        if (item) install(item, mode)
      }

      /**
       * 把一个对话的现状交接给另一个对话。
       *
       * 这是"多对话传递"的入口：sessionId 省略时交给**用户正在看的那个**会话（和求助按钮一致），
       * 指定时投给用户选的那个。面板只负责选中转站，不代 DSH 决定投给谁。
       */
      const openHandoff = async () => {
        if (!jobs.length) {
          setError(t('handoffNoJobs'))
          return
        }
        setHandoff({ sessions: null, loading: true })
        try {
          const payload = await api('/sessions')
          setHandoff({ sessions: (payload.sessions || []).filter((row) => row.available), loading: false })
        } catch (err) {
          setHandoff(null)
          setError(String((err && err.message) || err))
        }
      }

      const sendHandoff = async (sessionId) => {
        setHandoff(null)
        try {
          const body = { handoff: true, lang: currentLang }
          if (sessionId) body.sessionId = sessionId
          await api('/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          setHandoffNotice(t('handoffSent'))
          setTimeout(() => setHandoffNotice(null), 4000)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      const onCopy = (item, label) => {
        copyText(label).then(() => {
          setCopied(item.id)
          setTimeout(() => setCopied((current) => (current === item.id ? null : current)), 1600)
        })
      }

      // 参考链接不再直接跳百科：百度百科覆盖不全，跳到空词条对新手毫无价值。
      // 现在先给用户两个选择——让 DSH 讲解，或者打开这个工具的官网。
      const openOfficial = async (item) => {
        const url = (item.install && item.install.page) || null
        if (!url) {
          setError(t('noOfficialPage'))
          return
        }
        try {
          await api('/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          })
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      const explainByDsh = async (item) => {
        setAsk(null)
        setBusy(item.id)
        try {
          await api('/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, lang: currentLang }),
          })
          setNotice({ itemId: item.id, text: t('explainSent') })
          setTimeout(() => setNotice((current) => (current && current.itemId === item.id ? null : current)), 4000)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy(null)
        }
      }

      const deleteJob = async (id) => {
        try {
          const payload = await api('/jobs/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          setJobs(payload.jobs || [])
          setDetail((current) => (current === id ? null : current))
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      const clearFinished = async () => {
        try {
          const payload = await api('/jobs/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: 'finished' }),
          })
          setJobs(payload.jobs || [])
          setDetail(null)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      /**
       * 取消一个正在跑的任务。host 会杀整棵进程树（winget 拉起来的 msiexec 也得一起走），
       * 所以这里必须等它返回再解锁——提前解锁会让用户以为没生效，再按一次。
       * 取消不改动磁盘上的工具，所以不需要重新扫描清单；下一次轮询就会显示 cancelled。
       */
      const cancelJob = async (id) => {
        setCancelling(id)
        try {
          const payload = await api('/jobs/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          setJobs(payload.jobs || [])
          // 列表里直接摊开清理边界：用户刚按了取消，最想知道的就是"它留下了什么"。
          setDetail(id)
          runningRef.current = (payload.jobs || []).filter((job) => job.status === 'running').length
        } catch (err) {
          setError(String((err && err.message) || err))
          // 失败最常见的原因是任务在这几百毫秒里自己结束了；顺手对齐一次，别让面板停在旧状态。
          try {
            const payload = await api('/jobs')
            setJobs(payload.jobs || [])
          } catch {
            /* 拉不到就保持现状，error 已经说明问题了 */
          }
        } finally {
          setCancelling(null)
        }
      }

      /**
       * 「已经安装？选择对应文件夹」：让 DSH 打开系统目录选择器，把选中的目录记成一个额外根目录，
       * 然后立刻重新扫描——用户要看到的是"这一下到底管不管用"，而不是"已经保存"。
       *
       * 取消（返回 null）是正常操作，不报错、不提示，只是什么都没发生。
       */
      const pickFolderFor = async (item) => {
        setPicking(item.id)
        setPickResult(null)
        try {
          const dir = await pickFolder()
          if (!dir) return
          const payload = await api('/roots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir, id: item.id }),
          })
          setRoots(payload.roots || [])
          const verdict = payload.verdict
          setPickResult({
            itemId: item.id,
            ok: Boolean(verdict && verdict.ok),
            text: verdict ? verdict.message : `${t('pickedOk')}：${dir}`,
          })
          // 认出来了才值得重扫；没认出来时重扫只会白等几秒，结论不会变。
          if (verdict && verdict.ok) await load(true)
        } catch (err) {
          setPickResult({ itemId: item.id, ok: false, text: String((err && err.message) || err) })
        } finally {
          setPicking(null)
        }
      }

      /** 撤销一条手动添加的根目录。选错必须能收回，否则用户只能去手改 JSON。 */
      const removeRootDir = async (dir) => {
        try {
          const payload = await api('/roots', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir }),
          })
          setRoots(payload.roots || [])
          setPickResult(null)
          // 移除会改变"某些条目还算不算已安装"，所以要重扫。
          await load(true)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      /**
       * 卸载一个已安装的工具。host 会真的执行卸载器，之后还会**复查**它是否真的消失了——
       * 所以这里不预判成功，只把请求发出去、把任务列表拿回来，让用户去看那个任务的结论。
       */
      const uninstallItem = async (item) => {
        setConfirmUninstall(null)
        setUninstalling(item.id)
        try {
          const payload = await api('/uninstall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id }),
          })
          const jobsPayload = await api('/jobs')
          setJobs(jobsPayload.jobs || [])
          runningRef.current = (jobsPayload.jobs || []).filter((job) => job.status === 'running').length
          // 直接展开这个任务的详情：用户刚按了卸载，最想看的是它到底做了什么。
          if (payload.job?.id) setDetail(payload.job.id)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setUninstalling(null)
        }
      }

      /**
       * 打开下载来源选择器：先让 host **逐个验证**来源，再开始 5 秒倒计时。
       *
       * 倒计时是刻意从"来源已验证"那一刻开始的，而不是从点击那一刻：如果验证慢，用户在倒计时
       * 还没结束时就看着一个空列表，超时后自动开始的那条他根本没机会看清。验证结果只会包含真能
       * 下的来源，所以"默认第一条"是一条被验证过的路，而不是一条希望。
       */
      const openSourcePicker = async (item) => {
        autoStartedRef.current = false
        setPicker({ item, itemId: item.id, sources: null, checking: true, secondsLeft: null })
        try {
          const payload = await api(`/sources?id=${encodeURIComponent(item.id)}`)
          const sources = (payload.sources || []).filter((entry) => entry.verified)
          setPicker({ item, itemId: item.id, sources, checking: false, secondsLeft: AUTO_START_SECONDS })
        } catch (err) {
          setPicker(null)
          setError(String((err && err.message) || err))
        }
      }

      const closePicker = () => {
        // 关掉就必须把待触发的定时器撤掉：否则用户点了"先不装"，几秒后仍会自己开始安装。
        if (countdownRef.current) clearTimeout(countdownRef.current)
        autoStartedRef.current = true
        setPicker(null)
      }

      // install 定义在后面；用 ref 让倒计时的副作用不必依赖声明顺序。
      const installRef = React.useRef(null)
      // 倒计时的定时器与"是否已经自动开始"的标记。放在 ref 里，避免重渲染把待触发的定时器清掉。
      const countdownRef = React.useRef(null)
      const autoStartedRef = React.useRef(false)

      // 倒计时：只在**来源已验证**（checking 结束）之后跑。归零就自动用第一条开始——
      // 这是用户明确要的语义。列表为空时什么都不做：没有验证过的路可走，就不该自动动手。
      //
      // 定时器放在 ref 里，而不是让 effect 的清理函数去管：面板每 1 秒左右会因为轮询和时钟重渲染，
      // 而每次重渲染都会先跑清理——那样一个 1 秒的定时器永远等不到到期，倒计时会卡住不动，
      // 超时也就永远不会自动开始。（第一版就是这样，靠"tick 只出现一次"才看出来。）
      //
      // 条目随 picker 一起存下来（picker.item），而不是从 `items` 里现查：`items` 定义在下面，
      // 在这里引用它是暂时性死区——这个错误在本文件里已经犯过一次了。
      React.useEffect(() => {
        if (!picker || picker.checking || picker.secondsLeft === null) return undefined
        if (picker.secondsLeft <= 0) {
          // 只自动开始一次，否则重渲染会反复触发。
          if (autoStartedRef.current) return undefined
          autoStartedRef.current = true
          const first = picker.sources[0]?.name
          if (first === undefined) return undefined
          const { item } = picker
          setPicker(null)
          installRef.current?.(item, 'download', first)
          return undefined
        }
        countdownRef.current = setTimeout(() => {
          setPicker((cur) => (cur ? { ...cur, secondsLeft: cur.secondsLeft - 1 } : cur))
        }, 1000)
        return () => {
          if (countdownRef.current) clearTimeout(countdownRef.current)
        }
        // 只依赖倒计时本身与"是否已验证"：这两者才是决定行为的东西。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [picker?.secondsLeft, picker?.checking, picker?.itemId])

      /** 用户确认（或倒计时归零）后真正开始：带上选中的来源。 */
      const startFromPicker = (item, sourceName) => {
        const chosen = sourceName ?? picker?.sources?.[0]?.name ?? undefined
        if (countdownRef.current) clearTimeout(countdownRef.current)
        autoStartedRef.current = true
        setPicker(null)
        install(item, 'download', chosen)
      }
      installRef.current = install

      /**
       * 把一条失败/卡住的任务交给 DSH 求助。
       *
       * 面板只把**事实**送过去（状态、命令、错误、日志尾部），让 DSH 去查证和解决——
       * 面板不做诊断，否则就出现了第二份判断逻辑。
       */
      const helpJob = async (job) => {
        setHelping(job.id)
        try {
          await api('/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: job.id, lang: currentLang }),
          })
          setNotice({ itemId: job.id, text: t('helpSent') })
          setTimeout(() => setNotice((current) => (current && current.itemId === job.id ? null : current)), 4000)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setHelping(null)
        }
      }

      const items = (data && data.items) || []
      const summary = (data && data.summary) || { total: 0, installed: 0, missing: 0, essentialMissing: 0 }
      const visible = items
        .filter((item) => (tab === 'missing' ? !item.installed : true))
        .filter((item) => (category ? item.category === category : true))
      const groups = []
      for (const group of (data && data.categories) || []) {
        const rows = visible.filter((item) => item.category === group.id)
        if (rows.length) groups.push({ id: group.id, name: group.name, nameEn: group.nameEn, rows })
      }

      const chip = (className, label, value) =>
        h('span', { className: `dsh-de-chip ${className}` }, h('b', null, String(value)), h('span', null, label))

      /**
       * 来源选择器。刻意在**根节点这一层**渲染，而不是放进页签分支里：它覆盖整块面板，而且它
       * 带着一个会自己到点的倒计时。放进 `tab === 'missing'` 分支的话，用户切到「全部」再点补齐时
       * 状态照常更新、抽屉却根本没画出来——倒计时会在看不见的地方跑完并自动装上一个他看不到的任务。
       */
      const sourcePicker = picker
        ? h(
            'div',
            { className: 'dsh-de-modal' },
            h(
              'div',
              { className: 'dsh-de-dialog' },
              h('h2', null, `${t('pickSource')} · ${itemName(picker.item || { name: picker.itemId })}`),
              h('div', { className: 'dsh-de-pickq' }, t('pickSourceHint')),
              picker.checking
                ? h('div', { className: 'dsh-de-msg' }, t('pickSourceChecking'))
                : picker.sources.length
                  ? [
                      // 倒计时条：让"还剩几秒就自动开始"看得见，而不是一件突然发生的事。
                      h('div', { className: 'dsh-de-count', key: 'count' }, `${picker.secondsLeft} ${t('pickSourceAuto')}`),
                      h(
                        'div',
                        { className: 'dsh-de-bar-slim', key: 'bar' },
                        h('span', {
                          style: { width: `${Math.max(0, Math.min(100, (picker.secondsLeft / AUTO_START_SECONDS) * 100))}%` },
                        }),
                      ),
                      ...picker.sources.map((source, index) =>
                        h(
                          'div',
                          { className: 'dsh-de-source', key: source.name ?? index, 'data-first': index === 0 ? '1' : '0' },
                          h(
                            'div',
                            { className: 'dsh-de-sourcemain' },
                            h('div', { className: 'dsh-de-sourcename' }, source.label || source.name || '默认来源'),
                            h(
                              'div',
                              { className: 'dsh-de-sourcehost' },
                              `${source.host ?? ''}${source.version ? ` · v${source.version}` : ''}`,
                            ),
                          ),
                          index === 0 ? h('span', { className: 'dsh-de-sourcetag' }, '默认') : null,
                          h(
                            'button',
                            { className: 'dsh-de-btn', onClick: () => startFromPicker(picker.item, source.name) },
                            t('pickSourceNow'),
                          ),
                        ),
                      ),
                    ]
                  : h('div', { className: 'dsh-de-msg' }, t('pickSourceNone')),
              h(
                'div',
                { className: 'dsh-de-pick' },
                h('button', { className: 'dsh-de-btn', onClick: closePicker }, t('pickSourceCancel')),
              ),
            ),
          )
        : null

      /**
       * 会话选择器（多对话传递）。同样在根节点渲染：它浮在整块面板之上，且不该受页签影响。
       *
       * `handoffAuto` 是"交给当前对话"——省略 sessionId 时 host 会挑最活跃的那个，这正是面板默认的
       * 行为，所以给一个显式按钮比让用户猜要好。
       */
      const handoffPicker = handoff
        ? h(
            'div',
            { className: 'dsh-de-modal' },
            h(
              'div',
              { className: 'dsh-de-dialog' },
              h('h2', null, t('handoffPick')),
              h('div', { className: 'dsh-de-pickq' }, t('handoffPickHint')),
              handoff.loading
                ? h('div', { className: 'dsh-de-msg' }, t('handoffLoading'))
                : h(
                    'div',
                    null,
                    h(
                      'div',
                      { className: 'dsh-de-source', 'data-first': '1' },
                      h('div', { className: 'dsh-de-sourcemain' }, h('div', { className: 'dsh-de-sourcename' }, t('handoffAuto'))),
                      h('button', { className: 'dsh-de-btn', onClick: () => sendHandoff(null) }, t('handoff')),
                    ),
                    handoff.sessions.length
                      ? handoff.sessions.map((row) =>
                          h(
                            'div',
                            { className: 'dsh-de-source', key: row.sessionId, 'data-first': '0' },
                            h(
                              'div',
                              { className: 'dsh-de-sourcemain' },
                              h('div', { className: 'dsh-de-sourcename' }, row.cwd || row.sessionId),
                              h(
                                'div',
                                { className: 'dsh-de-sourcehost' },
                                `${row.sessionId}${row.running ? ` · ${t('handoffRunning')}` : ''}`,
                              ),
                            ),
                            h('button', { className: 'dsh-de-btn', onClick: () => sendHandoff(row.sessionId) }, t('handoff')),
                          ),
                        )
                      : h('div', { className: 'dsh-de-msg' }, t('handoffNoSessions')),
                  ),
              h(
                'div',
                { className: 'dsh-de-pick' },
                h('button', { className: 'dsh-de-btn', onClick: () => setHandoff(null) }, t('pickSourceCancel')),
              ),
            ),
          )
        : null

      return h(
        'div',
        { className: 'dsh-de-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dsh-de-head' },
          h(
            'div',
            { className: 'dsh-de-headrow' },
            h(
              'div',
              null,
              h('h1', { className: 'dsh-de-title' }, t('title')),
              h('p', { className: 'dsh-de-sub' }, t('subtitle')),
            ),
            h('div', { className: 'dsh-de-spacer' }),
            h(
              'button',
              {
                className: 'dsh-de-btn',
                title: t('switchLanguage'),
                'aria-label': t('switchLanguage'),
                onClick: () => setLang(rememberLang(lang === 'zh' ? 'en' : 'zh')),
              },
              OTHER_LANGUAGE[lang],
            ),
            h(
              'button',
              { className: 'dsh-de-btn', onClick: () => load(true), disabled: loading },
              loading ? t('scanning') : t('rescan'),
            ),
          ),
          h(
            'div',
            { className: 'dsh-de-chips' },
            chip('ok', t('installed'), summary.installed),
            chip(summary.missing ? 'bad' : 'ok', t('missing'), summary.missing),
            chip(summary.essentialMissing ? 'crit' : 'ok', t('essentialMissing'), summary.essentialMissing),
            chip('', t('total'), summary.total),
            data && data.scannedAt
              ? h('span', { className: 'dsh-de-chip' }, h('span', null, `${timeText(Date.parse(data.scannedAt))}`))
              : null,
          ),
        ),
        h(
          'div',
          { className: 'dsh-de-scroll' },
          error ? h('div', { className: 'dsh-de-err' }, `${t('scanFailed')}：${error}`) : null,
          !data && loading ? h('div', { className: 'dsh-de-msg' }, t('loading')) : null,
          data
            ? h(
                'div',
                { className: 'dsh-de-toolbar' },
                h(
                  'button',
                  { className: 'dsh-de-tab', 'data-on': tab === 'missing' ? '1' : '0', onClick: () => setTab('missing') },
                  `${t('tabMissing')} (${summary.missing})`,
                ),
                h(
                  'button',
                  { className: 'dsh-de-tab', 'data-on': tab === 'all' ? '1' : '0', onClick: () => setTab('all') },
                  `${t('tabAll')} (${summary.total})`,
                ),
                h(
                  'select',
                  { className: 'dsh-de-select', value: category, onChange: (event) => setCategory(event.target.value) },
                  h('option', { value: '' }, t('allCategories')),
                  ((data && data.categories) || []).map((group) =>
                    h('option', { key: group.id, value: group.id }, categoryLabel(group)),
                  ),
                ),
                h('div', { className: 'dsh-de-spacer' }),
                h(
                  'button',
                  { className: 'dsh-de-btn ghost', onClick: () => load(true), disabled: loading },
                  `↻ ${t('rescan')}`,
                ),
              )
            : null,
          data && !groups.length && !error ? h('div', { className: 'dsh-de-empty' }, t('empty')) : null,
          // 额外根目录区块：列出现在实际在搜的目录，手动添加的那条可以单独撤销。
          // 来自环境变量的一条**没有**移除按钮——面板删不掉它，给一个按了没反应的按钮不如说清楚。
          h(
            'div',
            { className: 'dsh-de-roots' },
            h(
              'div',
              { className: 'dsh-de-grouphead' },
              h('span', { className: 'dsh-de-groupname' }, `${t('rootsTitle')} · ${roots.length}`),
              h('span', { className: 'dsh-de-spacer' }),
              h('span', { className: 'dsh-de-pickq' }, t('rootsHint')),
            ),
            roots.length
              ? roots.map((root) =>
                  h(
                    'div',
                    { className: 'dsh-de-rootrow', key: root.dir },
                    h('span', { className: 'dsh-de-rootdir', title: root.dir }, root.dir),
                    h('span', { className: 'dsh-de-badge' }, root.removable ? t('rootsFromPick') : t('rootsFromEnv')),
                    root.removable
                      ? h(
                          'button',
                          { className: 'dsh-de-btn ghost', onClick: () => removeRootDir(root.dir) },
                          t('rootsRemove'),
                        )
                      : null,
                  ),
                )
              : h('div', { className: 'dsh-de-msg' }, t('rootsEmpty')),
          ),
          groups.map((group) =>
            h(
              'div',
              { className: 'dsh-de-group', key: group.id },
              h('div', { className: 'dsh-de-groupname' }, `${categoryLabel(group)} · ${group.rows.length}`),
              group.rows.map((item) => {
                const mainPlan = (item.plans || []).find((plan) => plan.mode !== 'page') || (item.plans || [])[0]
                const pagePlan = (item.plans || []).find((plan) => plan.mode === 'page')
                // 这条正在装？那整个安装期间都要禁用按钮，否则用户会重复点。
                const runningJob = jobs.find((job) => job.itemId === item.id && job.status === 'running')
                const isBusy = busy === item.id || Boolean(runningJob)
                return h(
                  'div',
                  { key: item.id },
                  h(
                    'div',
                    { className: 'dsh-de-row', 'data-missing': item.installed ? '0' : '1' },
                    h('span', { className: 'dsh-de-name' }, itemName(item)),
                    item.essential ? h('span', { className: 'dsh-de-badge ess' }, t('essentialBadge')) : null,
                    item.installed
                      ? h('span', { className: 'dsh-de-ver' }, item.version || t('versionUnknown'))
                      : h('span', { className: 'dsh-de-no' }, t('notInstalled')),
                    h('span', { className: 'dsh-de-where', title: item.where || item.reason || '' },
                      item.installed ? item.where || '' : item.reason || ''),
                    runningJob
                      ? h(
                          'span',
                          { className: 'dsh-de-rowbusy' },
                          `${phaseText(runningJob, currentLang)} · ${durationText(now - runningJob.startedAt)}`,
                        )
                      : null,
                    !item.installed && mainPlan
                      ? h('code', { className: 'dsh-de-cmd', title: mainPlan.label }, mainPlan.label)
                      : null,
                    !item.installed
                      ? h(
                          'div',
                          { className: 'dsh-de-actions' },
                          mainPlan
                            ? h(
                                'button',
                                {
                                  className: 'dsh-de-btn',
                                  disabled: isBusy,
                                  onClick: () => onCopy(item, mainPlan.label),
                                },
                                copied === item.id ? t('copied') : t('copy'),
                              )
                            : null,
                          pagePlan
                            ? h(
                                'button',
                                {
                                  className: 'dsh-de-btn',
                                  disabled: isBusy,
                                  onClick: () => install(item, 'page'),
                                },
                                t('download'),
                              )
                            : null,
                          mainPlan
                            ? h(
                                'button',
                                {
                                  className: 'dsh-de-btn primary',
                                  disabled: isBusy,
                                  onClick: () => (item.plans || []).find((plan) => plan.mode === 'download')?.sources
                                    ? openSourcePicker(item)
                                    : install(item, 'auto'),
                                },
                                isBusy ? t('installing') : t('install'),
                              )
                            : null,
                        )
                      : null,
                    // 已安装的条目才可能卸载。`item.uninstall` 由 host 在扫描时算好：
                    // 只有真的存在可靠卸载方式时它才非 null，所以这里不会出现"按下去没反应"的按钮。
                    item.installed && item.uninstall
                      ? h(
                          'div',
                          { className: 'dsh-de-actions' },
                          h(
                            'button',
                            {
                              className: 'dsh-de-btn danger',
                              disabled: isBusy || uninstalling === item.id,
                              onClick: () =>
                                setConfirmUninstall((current) => (current === item.id ? null : item.id)),
                            },
                            uninstalling === item.id ? t('uninstalling') : t('uninstall'),
                          ),
                        )
                      : null,
                  ),
                  // 二次确认。破坏性动作不接受"一点就删"：必须经过一次明确确认，而且确认文案
                  // 要带上这个工具特有的风险（核心工具 / 会弹向导 / 只在某种装法下有效）。
                  confirmUninstall === item.id
                    ? h(
                        'div',
                        { className: 'dsh-de-confirm' },
                        h(
                          'span',
                          { className: 'dsh-de-confirmtext' },
                          `${t('uninstallConfirm')} `,
                          h('b', null, itemName(item)),
                          ` — ${t('uninstallWarning')}`,
                          item.essential ? ` ${t('uninstallEssential')}` : '',
                          item.uninstall.interactive ? ` ${t('uninstallInteractive')}` : '',
                          item.uninstall.experimental ? ` ${t('uninstallExperimental')}` : '',
                          h('code', { className: 'dsh-de-cmd', title: item.uninstall.label }, item.uninstall.label),
                        ),
                        h('button', { className: 'dsh-de-btn danger', onClick: () => uninstallItem(item) }, t('uninstallConfirmGo')),
                        h('button', { className: 'dsh-de-btn', onClick: () => setConfirmUninstall(null) }, t('uninstallCancel')),
                      )
                    : null,
                  itemDesc(item)
                    ? h(
                        'div',
                        { className: 'dsh-de-desc' },
                        itemDesc(item),
                        h(
                          'button',
                          {
                            className: 'dsh-de-learn',
                            onClick: () => setAsk((current) => (current === item.id ? null : item.id)),
                          },
                          `↗ ${t('learn')}`,
                        ),
                        notice && notice.itemId === item.id ? h('span', { className: 'dsh-de-ok' }, ` ${notice.text}`) : null,
                      )
                    : null,
                  ask === item.id
                    ? h(
                        'div',
                        { className: 'dsh-de-ask' },
                        h('span', { className: 'dsh-de-askq' }, t('askDsh')),
                        h('button', { className: 'dsh-de-btn primary', onClick: () => explainByDsh(item) }, t('explainByDsh')),
                        h(
                          'button',
                          {
                            className: 'dsh-de-btn',
                            onClick: () => {
                              setAsk(null)
                              openOfficial(item)
                            },
                          },
                          t('openOfficial'),
                        ),
                      )
                    : null,
                  !item.installed && mainPlan && mainPlan.note
                    ? h('div', { className: 'dsh-de-note' }, mainPlan.note)
                    : null,
                  // 「已经安装？选择对应文件夹」。只在这个条目**确实能靠一个目录认出来**时出现
                  // （hint 非 null，也就是 pathList 类探针）。对注册表/PATH 类条目显示它，
                  // 用户选完什么也不会发生，只会以为插件坏了。
                  !item.installed && item.hint && pickDirectoryFn
                    ? h(
                        'div',
                        { className: 'dsh-de-pick' },
                        h(
                          'button',
                          {
                            className: 'dsh-de-btn',
                            title: t('pickFolderTitle'),
                            disabled: picking === item.id,
                            onClick: () => pickFolderFor(item),
                          },
                          picking === item.id ? t('picking') : `📁 ${t('pickFolder')}`,
                        ),
                        h('span', { className: 'dsh-de-pickq' }, item.hint),
                      )
                    : null,
                  pickResult && pickResult.itemId === item.id
                    ? h('div', { className: `dsh-de-pickmsg${pickResult.ok ? '' : ' bad'}` }, pickResult.text)
                    : null,
                )
              }),
            ),
          ),
          h(
            'div',
            { className: 'dsh-de-jobs' },
            h(
              'div',
              { className: 'dsh-de-grouphead' },
              h('span', { className: 'dsh-de-groupname' }, `${t('jobs')} · ${jobs.length}`),
              handoffNotice ? h('span', { className: 'dsh-de-ok' }, handoffNotice) : null,
              h('span', { className: 'dsh-de-spacer' }),
              // 多对话传递的入口：把这份列表的现状交给一个对话。
              jobs.length ? h('button', { className: 'dsh-de-btn ghost', onClick: openHandoff }, t('handoff')) : null,
              jobs.some((job) => job.status !== 'running')
                ? h('button', { className: 'dsh-de-btn ghost', onClick: clearFinished }, t('clearFinished'))
                : null,
            ),
            jobs.length
              ? jobs.map((job) => {
                  const progress = progressOf(job)
                  const elapsed = durationText((job.endedAt || now) - job.startedAt)
                  // 列表里只留一行摘要，进度细节进「详情」——失败的安装不该继续占着版面。
                  return h(
                    'div',
                    { className: 'dsh-de-job', key: job.id, 'data-open': detail === job.id ? '1' : '0' },
                    h(
                      'div',
                      { className: 'dsh-de-jobhead' },
                      h('span', { className: `dsh-de-state ${job.status}` }, phaseText(job, currentLang)),
                      h('b', null, job.name),
                      h('span', { className: 'dsh-de-where' }, job.label),
                      h('span', { className: 'dsh-de-spacer' }),
                      h('span', { className: 'dsh-de-badge' }, `${t('elapsed')} ${elapsed}`),
                      h(
                        'button',
                        {
                          className: 'dsh-de-btn ghost',
                          onClick: () => setDetail((current) => (current === job.id ? null : job.id)),
                        },
                        detail === job.id ? t('close') : t('detail'),
                      ),
                      job.status === 'running'
                        ? h(
                            'button',
                            {
                              className: 'dsh-de-btn',
                              disabled: cancelling === job.id,
                              onClick: () => cancelJob(job.id),
                            },
                            cancelling === job.id ? t('cancelling') : t('cancelJob'),
                          )
                        : h('button', { className: 'dsh-de-btn ghost', onClick: () => deleteJob(job.id) }, t('deleteJob')),
                    ),
                    h(
                      'div',
                      { className: 'dsh-de-progress' },
                      h(
                        'div',
                        { className: 'dsh-de-bar', 'data-indeterminate': progress.indeterminate ? '1' : '0' },
                        h('div', {
                          className: 'dsh-de-barfill',
                          style: progress.indeterminate ? undefined : { width: `${progress.percent}%` },
                        }),
                        progress.indeterminate
                          ? null
                          : h('span', { className: 'dsh-de-barlabel' }, `${progress.percent}%`),
                      ),
                      job.size ? h('span', { className: 'dsh-de-badge' }, job.size) : null,
                      // 速率/ETA/已传字节：只有我们自己下载的任务才有这些字段。
                      // 托管安装器（winget 等）在管道下不给体积，这里就什么都不显示。
                      transferText(job, currentLang)
                        ? h('span', { className: 'dsh-de-badge' }, transferText(job, currentLang))
                        : null,
                    ),
                    // 详情：下载/安装进度、当前活动行、完整日志都在这里。
                    detail === job.id
                      ? h(
                          'div',
                          { className: 'dsh-de-detail' },
                          h('div', { className: 'dsh-de-kv' },
                            h('span', null, `${t('phaseInstall')}: ${phaseText(job, currentLang)}`),
                            h('span', null, `${t('elapsed')}: ${elapsed}`),
                            job.percent === null || job.percent === undefined ? null : h('span', null, `${job.percent}%`),
                            job.size ? h('span', null, job.size) : null,
                            job.exitCode === null || job.exitCode === undefined ? null : h('span', null, `exit ${job.exitCode}`),
                            job.bytesPerSecond ? h('span', null, `${t('speed')}: ${bytesText(job.bytesPerSecond)}/s`) : null,
                            typeof job.etaSeconds === 'number' && job.etaSeconds >= 0
                              ? h('span', null, `${t('eta')}: ${durationText(job.etaSeconds * 1000)}`)
                              : null,
                          ),
                          cleanupText(job) ? h('div', { className: 'dsh-de-msg' }, cleanupText(job)) : null,
                          // 卸载后的复查结论。这是用户唯一能据以判断"到底卸干净没有"的东西——
                          // 卸载器退出码 0 并不等于它真的消失了。
                          job.uninstall
                            ? h(
                                'div',
                                {
                                  className: `dsh-de-pickmsg${job.uninstall.stillInstalled ? ' bad' : ''}`,
                                },
                                job.uninstall.stillInstalled
                                  ? t('uninstallStill')
                                  : `${t('uninstallGone')}${job.uninstall.version ? `（${job.uninstall.version}）` : ''}`,
                              )
                            : null,
                          job.activity ? h('div', { className: 'dsh-de-activity' }, job.activity) : null,
                          job.error ? h('div', { className: 'dsh-de-err' }, job.error) : null,
                          // winget 失败时的退路。**不自动重试**：换一种方式改动系统仍要用户点头，
                          // 而自动重试会让一次点击变成两次安装尝试。
                          job.fallback
                            ? h(
                                'div',
                                { className: 'dsh-de-pick' },
                                h(
                                  'button',
                                  { className: 'dsh-de-btn', onClick: () => installById(job.itemId, job.fallback.mode) },
                                  `${t('tryInstead')}：${t('fromOwnDownload')}`,
                                ),
                                h('span', { className: 'dsh-de-pickq' }, t('tryInsteadWhy')),
                              )
                            : null,
                          // 失败或还在跑都能求助：卡住的任务往往比失败的任务更需要人来看。
                          // 成功的任务不给——那时没有需要解决的问题，给了只会是噪音。
                          job.status === 'failed' || job.status === 'running'
                            ? h(
                                'div',
                                { className: 'dsh-de-pick' },
                                h(
                                  'button',
                                  {
                                    className: 'dsh-de-btn',
                                    title: t('askHelpTitle'),
                                    disabled: helping === job.id,
                                    onClick: () => helpJob(job),
                                  },
                                  helping === job.id ? t('askingHelp') : `🆘 ${t('askHelp')}`,
                                ),
                                notice && notice.itemId === job.id
                                  ? h('span', { className: 'dsh-de-pickmsg' }, notice.text)
                                  : h('span', { className: 'dsh-de-pickq' }, t('askHelpTitle')),
                              )
                            : null,
                          h('div', { className: 'dsh-de-groupname' }, t('logTail')),
                          job.log && job.log.length
                            ? h('pre', { className: 'dsh-de-pre' }, job.log.slice(-200).join('\n'))
                            : h('div', { className: 'dsh-de-msg' }, t('noJobs')),
                        )
                      : null,
                  )
                })
              : h('div', { className: 'dsh-de-msg' }, t('noJobs')),
          ),
        ),
        // 在根节点渲染：它覆盖整块面板，并且带着一个会自己到点的倒计时，
        // 所以绝不能藏在某个页签分支里面（藏在里面时，切到别的页签会让倒计时在看不见的地方跑完）。
        sourcePicker,
        handoffPicker,
      )
    }

    // ------------------------------------------------------------ plugin

    return {
      inject: ['slots'],
      apply(ctx) {
        // The locale service is optional and is used only to publish the dictionary under
        // NS, so slot owners that ask for `locale: NS` resolve. It deliberately does NOT
        // drive `t`: the panel's own language toggle (defaulting to Chinese) wins.
        try {
          const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
          if (locale && typeof locale.register === 'function') {
            ctx.effect(() => locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'dsh-dev-env: locale')
          }
        } catch {
          /* locale 不可用时保持内置词条 */
        }

        // uiWorkspace 只提供「打开系统的目录选择器」这一件事，而浏览器给不了真实路径。
        // 它同样是可选服务：拿不到就不显示那个按钮（见 DevEnvPage 里的判断），
        // 因为面板其余部分（清单、安装、取消）都不该被它的缺失拖住。
        try {
          const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
          // 取方法而不是服务对象：调用时不需要再带着 uiWorkspace 这个接收者。
          pickDirectoryFn =
            workspace && typeof workspace.pickDirectory === 'function'
              ? (path) => workspace.pickDirectory(path)
              : null
        } catch {
          /* 没有这个服务就退化为「不显示选目录入口」 */
        }

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, DevEnvPage),
        )
        // 红框里那个位置的第三个页签：交接（handoff）。和宿主侧 handoff.js 配套。
        //
        // 注册进 `conversation.view` 的原因：那个槽位是**会话级**的，owner 会把它知道的会话身份作为
        // 标准 prop 交给我的组件；而我现在所在的 `main/dev-env` 没有会话绑定（main 的 standardProps
        // 里没有 sessionId）。交接必须知道"这是哪个对话的交接"，所以只能在那个座位实现。
        //
        // 注册方式照官方示例：`{ name, id, order, label }` + 组件，用**自己的 id** 就落在旁边一格，
        // 不会顶掉 chat/trajectory。
        try {
          ctx.slots.inject('conversation.view', () =>
            ctx.slots.register(
              { name: 'conversation.view', id: 'dev-env-handoff', order: 20, locale: NS, label: () => t('handoffTab') },
              DevEnvHandoffView,
            ),
          )
        } catch {
          /* 没有这个槽位（旧版本 DSH）就退化为"只有面板"，不影响其余功能 */
        }
        // 设置页：加一个**自己的** section（id 用自己的，才不会顶掉 account/general/models…）。
        try {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'dev-env', order: 25, locale: NS, label: () => t('settingsTitle') },
              DevEnvSettingsSection,
            ),
          )
        } catch {
          /* 没有这个槽位（旧版本 DSH）就退化为"改 settings.json"，功能不受影响 */
        }
        // 「状态」页签，就在「项目条例」旁边（order 30 > 20）。同样用自己的 id，
        // 所以是**加一格**而不是顶掉 chat/trajectory。
        try {
          ctx.slots.inject('conversation.view', () =>
            ctx.slots.register(
              { name: 'conversation.view', id: 'dev-env-state', order: 30, locale: NS, label: () => t('stateTab') },
              DevEnvStateView,
            ),
          )
        } catch {
          /* 没有这个槽位就退化为"只能用 dev_env_state 工具问" */
        }
        // 设置里的说明书页。同一个 settings.section 槽位用另一个 id，所以它是**独立的一页**，
        // 不会和「Dev Env 设置」挤在一起。
        try {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'dev-env-manual', order: 26, locale: NS, label: () => t('manualTitle') },
              DevEnvManualSection,
            ),
          )
        } catch {
          /* 旧版本没有这个槽位就退化为"只有设置页" */
        }
        // 输入框上方的条例选择器。这个槽位是 list 型、replaceRisk 为 none，
        // 所以加自己的 id 只会落在 todo/goal/queue 旁边，不顶掉任何已有条目。
        try {
          ctx.slots.inject('conversation.input.dock', () =>
            ctx.slots.register(
              { name: 'conversation.input.dock', id: 'dev-env-clause', order: 30, locale: NS, label: () => t('clauseDock') },
              DevEnvClauseDock,
            ),
          )
        } catch {
          /* 旧版本没有这个槽位就退化为"只能在项目条例页签里传递" */
        }
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') },
            DevEnvIcon,
          ),
        )
      },
    }
  },
})
