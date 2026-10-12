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
      handoffHint: '把上面这份任务列表的现状交给一个对话，让它接着看',
      handoffPick: '交给哪个对话',
      handoffPickHint: '列表按最近活跃排序。只有能接收提问的会话才可选。',
      handoffAuto: '交给当前对话',
      handoffSent: '已交接',
      handoffNoJobs: '现在没有任务可以交接',
      handoffLoading: '正在读取会话…',
      handoffNoSessions: '没有可用的会话',
      handoffRunning: '运行中',
      speed: '速率',
      eta: '剩余',
      fromOwnDownload: '自己下载',
      extResumed: '已续传',
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
      handoffHint: 'Give this task list, as it stands, to a conversation so it can pick up from here',
      handoffPick: 'Which conversation',
      handoffPickHint: 'Ordered by recent activity. Only sessions that can accept a prompt are listed.',
      handoffAuto: 'Hand to the current conversation',
      handoffSent: 'Handed over',
      handoffNoJobs: 'There are no jobs to hand over right now',
      handoffLoading: 'Reading sessions…',
      handoffNoSessions: 'No conversation is available',
      handoffRunning: 'running',
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
