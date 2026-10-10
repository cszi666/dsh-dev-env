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
.dsh-de-root{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.dsh-de-scroll{flex:1;min-height:0;overflow:auto;padding:0 20px 28px}
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
.dsh-de-jobs{margin-top:20px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}
.dsh-de-job{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;margin-bottom:6px;background:var(--dsw-alias-bg-layer-1)}
.dsh-de-jobhead{display:flex;align-items:center;gap:8px;font-size:12px}
.dsh-de-state{font-size:11px;padding:1px 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1)}
.dsh-de-state.running{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-de-state.succeeded{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dsh-de-state.failed{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-de-pre{margin:6px 0 0;max-height:180px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:8px}
.dsh-de-msg{margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-de-err{margin-top:10px;font-size:12px;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.dsh-de-empty{margin-top:24px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
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

    async function api(path, options) {
      const response = await fetch(API + path, Object.assign({ cache: 'no-store' }, options || {}))
      const data = await response.json().catch(() => null)
      if (!response.ok || !data || data.ok === false) {
        throw new Error((data && data.error) || `HTTP ${response.status}`)
      }
      return data
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
      const runningRef = React.useRef(0)

      const load = React.useCallback(async (refresh) => {
        setLoading(true)
        try {
          const payload = await api(`/inventory${refresh ? '?refresh=1' : ''}`)
          setData(payload)
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

      // 轮询补齐任务；有任务刚从 running 结束时自动刷新清单
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const payload = await api('/jobs')
            if (!alive) return
            const list = payload.jobs || []
            setJobs(list)
            const running = list.filter((job) => job.status === 'running').length
            if (runningRef.current > 0 && running < runningRef.current) load(true)
            runningRef.current = running
          } catch {
            /* 轮询失败不打扰用户 */
          }
        }
        tick()
        const timer = setInterval(tick, 2000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [load])

      const install = async (item, mode) => {
        setBusy(item.id)
        try {
          await api('/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, mode: mode || 'auto' }),
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

      const onCopy = (item, label) => {
        copyText(label).then(() => {
          setCopied(item.id)
          setTimeout(() => setCopied((current) => (current === item.id ? null : current)), 1600)
        })
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
          groups.map((group) =>
            h(
              'div',
              { className: 'dsh-de-group', key: group.id },
              h('div', { className: 'dsh-de-groupname' }, `${categoryLabel(group)} · ${group.rows.length}`),
              group.rows.map((item) => {
                const mainPlan = (item.plans || []).find((plan) => plan.mode !== 'page') || (item.plans || [])[0]
                const pagePlan = (item.plans || []).find((plan) => plan.mode === 'page')
                const isBusy = busy === item.id
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
                                  onClick: () => install(item, 'auto'),
                                },
                                isBusy ? t('installing') : t('install'),
                              )
                            : null,
                        )
                      : null,
                  ),
                  !item.installed && mainPlan && mainPlan.note
                    ? h('div', { className: 'dsh-de-note' }, mainPlan.note)
                    : null,
                )
              }),
            ),
          ),
          h(
            'div',
            { className: 'dsh-de-jobs' },
            h('div', { className: 'dsh-de-groupname' }, `${t('jobs')} · ${jobs.length}`),
            jobs.length
              ? jobs.map((job) =>
                  h(
                    'div',
                    { className: 'dsh-de-job', key: job.id },
                    h(
                      'div',
                      { className: 'dsh-de-jobhead' },
                      h('span', { className: `dsh-de-state ${job.status}` }, job.status),
                      h('b', null, job.name),
                      h('span', { className: 'dsh-de-where' }, job.label),
                      h('span', { className: 'dsh-de-spacer' }),
                      h('span', { className: 'dsh-de-badge' }, timeText(job.startedAt)),
                    ),
                    job.error ? h('div', { className: 'dsh-de-err' }, job.error) : null,
                    job.log && job.log.length ? h('pre', { className: 'dsh-de-pre' }, job.log.slice(-40).join('\n')) : null,
                  ),
                )
              : h('div', { className: 'dsh-de-msg' }, t('noJobs')),
          ),
        ),
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
