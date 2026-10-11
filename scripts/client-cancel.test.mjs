/**
 * Behavioural test for the panel's Cancel button, driven through the real `client.js`.
 *
 * Why a hand-written shim instead of React + jsdom: `npm test` has no dependencies and stays
 * runnable on a bare checkout — that is deliberate, because this check is the one thing guarding a
 * release (1.1.0 shipped without `describe.js` precisely because nothing ran on install). Pulling in
 * React and jsdom to test one button would trade that away.
 *
 * The shim below is the smallest thing that honours what the panel actually uses — function
 * components plus useState/useCallback/useRef/useEffect — so clicking the rendered button runs the
 * real handler and the assertions after it see the real re-render.
 *
 * What it asserts (the roadmap's "done when" for step 1):
 *   · a running job's row offers Cancel, and offers no Delete (a running job must never be
 *     deletable — that was already true before, and this keeps it true);
 *   · clicking it POSTs exactly one /jobs/cancel with that job id, and locks the button meanwhile;
 *   · the row then reads cancelled, and the detail view names the cleanup boundary that applied —
 *     for a winget install we cannot remove the installer's own cache, and that has to be said
 *     rather than implied.
 *
 * Everything it installs on `globalThis` is restored before it returns.
 */

/**
 * @param {{ check: (name: string, fn: () => any) => Promise<void> }} harness
 */
export async function runClientCancelTests(harness) {
  // ---------------------------------------------------------------- fake timers
  // The panel polls /jobs recursively (setTimeout) and ticks a clock once a second. Both go through
  // here, so a test can move time forward instead of waiting for it.
  const timers = { seq: 0, queue: new Map(), now: 1_700_000_000_000 }

  const fakeSetTimeout = (fn, delay = 0) => {
    const id = ++timers.seq
    timers.queue.set(id, { at: timers.now + Number(delay || 0), fn, every: null })
    return id
  }
  const fakeSetInterval = (fn, delay = 0) => {
    const id = ++timers.seq
    const every = Math.max(1, Number(delay || 1))
    timers.queue.set(id, { at: timers.now + every, fn, every })
    return id
  }
  const fakeClear = (id) => timers.queue.delete(id)

  const drain = () => new Promise((resolve) => setImmediate(resolve))

  async function advance(ms) {
    const target = timers.now + ms
    for (;;) {
      const due = [...timers.queue.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      const [id, timer] = due
      timers.now = timer.at
      if (timer.every) timer.at = timers.now + timer.every
      else timers.queue.delete(id)
      try {
        timer.fn()
      } catch {
        /* a polling failure is not what is under test */
      }
      await drain()
    }
    timers.now = target
    await drain()
  }

  // ---------------------------------------------------------------- React shim
  function createShim() {
    const current = { hooks: [], cursor: 0, rerender: null }
    const queue = new Set()
    let afterRender = []

    const slotAt = (initial) => {
      const index = current.cursor++
      if (current.hooks.length <= index) current.hooks[index] = { value: initial }
      return current.hooks[index]
    }

    const useState = (initial) => {
      const slot = slotAt(initial)
      if (!slot.setter) {
        slot.setter = (action) => {
          const next = typeof action === 'function' ? action(slot.value) : action
          if (Object.is(next, slot.value)) return
          slot.value = next
          queue.add(current.rerender)
        }
      }
      return [slot.value, slot.setter]
    }

    const React = {
      createElement(type, props, ...children) {
        const flat = children.length > 1 ? children : children[0]
        return { type, props: Object.assign({}, props || {}, flat === undefined ? {} : { children: flat }) }
      },
      useState,
      useCallback(fn) {
        const slot = slotAt(undefined)
        if (!slot.value) slot.value = fn
        return slot.value
      },
      useRef(initial) {
        const slot = slotAt(undefined)
        if (!slot.value) slot.value = { current: initial }
        return slot.value
      },
      useEffect(fn) {
        // Deliberately simplified: each effect runs once, when it first appears. Reconstructing
        // React's dependency comparison here would mean also reconstructing useCallback's
        // memoisation, and an approximation of the two together re-runs effects that real React
        // would not — the panel's polling effect then restarts endlessly. Every effect this panel
        // mounts is a mount effect, so "once" is the honest behaviour to test against. The cost is
        // that re-running effects is not exercised here, which is not what this test is for.
        const slot = slotAt(undefined)
        if (slot.value === true) return
        slot.value = true
        afterRender.push({ fn })
      },
    }

    return {
      React,
      current,
      queue,
      takeAfterRender: () => {
        const effects = afterRender
        afterRender = []
        return effects
      },
    }
  }

  // ---------------------------------------------------------------- fake DOM
  // Note the absence of a `props` key: that is what tells the element-tree walker below not to
  // descend into these. Without it, a `<style>` element carrying its CSS string would be walked as
  // if that string were a child element.
  function fakeNode(tag, props = {}) {
    const node = {
      tag,
      className: props.className || '',
      style: props.style || {},
      textContent: '',
      children: [],
    }
    node.appendChild = (child) => node.children.push(child)
    node.setAttribute = () => undefined
    let handler = props.onClick
    Object.defineProperty(node, 'onclick', {
      get: () => handler,
      set: (value) => {
        handler = value
      },
    })
    return node
  }

  function walk(tree, visit) {
    if (tree === null || tree === undefined || tree === false || tree === true) return
    if (typeof tree === 'string' || typeof tree === 'number') return
    if (Array.isArray(tree)) {
      for (const child of tree) walk(child, visit)
      return
    }
    visit(tree)
    if (tree.props && tree.props.children !== undefined) walk(tree.props.children, visit)
  }

  const allNodes = (root) => {
    const found = []
    walk(root, (node) => found.push(node))
    return found
  }

  const textOf = (node) => {
    let text = ''
    walk(node, (child) => {
      // Skip the panel's `<style>` element: its CSS is not copy, and including it makes every
      // failure message start with a screenful of stylesheet instead of what the user sees.
      if (child.type === 'style') return
      const children = child.props && child.props.children
      if (typeof children === 'string') text += children
      else if (typeof children === 'number') text += String(children)
    })
    return text
  }

  /**
   * Visible text only. `textOf` deliberately walks everything, including the panel's `<style>`
   * element, so a substring assertion against it would be searching the CSS as often as the copy.
   */
  const visibleTextOf = (node) => {
    let text = ''
    const visit = (current, inStyle) => {
      if (current === null || current === undefined || typeof current === 'boolean') return
      if (typeof current === 'string' || typeof current === 'number') {
        if (!inStyle) text += String(current)
        return
      }
      if (Array.isArray(current)) {
        for (const child of current) visit(child, inStyle)
        return
      }
      const children = current.props && current.props.children
      visit(children, inStyle || current.type === 'style')
    }
    visit(node, false)
    return text
  }

  const buttonByText = (root, label) =>
    allNodes(root).find((node) => node.type === 'button' && textOf(node).trim() === label)

  /** Press a button the way a browser does: run the handler, then let React flush the update. */
  const press = (button) => {
    const handler = button.onclick || (button.props && button.props.onClick)
    if (typeof handler !== 'function') {
      throw new Error(
        `button has no click handler (type ${button.type}, props: ${Object.keys(button.props || {}).join(', ')})`,
      )
    }
    handler()
    // React re-renders synchronously enough that the very next read sees the new tree; the queue is
    // drained here so a test can assert on the in-flight state before the request is ever resolved.
    // Note that `render()` replaces the tree object, so callers must read `tree` (or a fresh query)
    // afterwards rather than holding on to a node captured before the press.
    const items = [...react.queue]
    react.queue.clear()
    for (const item of items) item()
  }

  const buttonLabels = (root) =>
    allNodes(root).filter((node) => node.type === 'button').map((node) => textOf(node).trim())

  /** Click a button by its visible label, failing loudly when there is nothing to click. */
  const clickButton = (root, label) => {
    const button = buttonByText(root, label)
    if (!button) throw new Error(`no button labelled ${label} (present: ${buttonLabels(root).join(' / ')})`)
    press(button)
  }

  // ---------------------------------------------------------------- harness
  const react = createShim()
  const storage = new Map()
  const fetchCalls = []
  const pending = []
  let tree = null
  let mock = null
  let component = null
  // The panel asks the optional client service `uiWorkspace` to open the real directory picker.
  // Tests install a stand-in before loading the plugin; `null` means "this DSH has no such service".
  let uiWorkspace = null

  const flush = async (limit = 60) => {
    for (let index = 0; index < limit; index += 1) {
      // Yield first. The loop body itself is synchronous, so without this a chain of pure
      // microtasks — awaiting the directory picker, for instance, which resolves without ever
      // hitting `fetch` — would never get a turn and every iteration would look like "nothing left".
      await drain()
      if (react.queue.size) {
        const items = [...react.queue]
        react.queue.clear()
        for (const item of items) item()
        await drain()
        continue
      }
      if (pending.length) {
        // Resolve every request that is waiting: the panel fires its inventory and jobs calls
        // together, and neither can proceed while the other is outstanding.
        for (const settle of [...pending]) settle()
        await drain()
        continue
      }
      const effects = react.takeAfterRender()
      if (effects.length) {
        for (const effect of effects) effect.fn()
        await drain()
        continue
      }
      break
    }
    await drain()
  }

  function render() {
    // Only the read cursor resets per render. Clearing the slots array would recreate every useState
    // slot from its initial value and re-register every effect — that is a remount, not a re-render.
    react.current.cursor = 0
    react.current.rerender = render
    tree = component()
  }

  // ---------------------------------------------------------------- globals
  const saved = {
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
    setTimeout: Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'),
    setInterval: Object.getOwnPropertyDescriptor(globalThis, 'setInterval'),
    clearTimeout: Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout'),
    clearInterval: Object.getOwnPropertyDescriptor(globalThis, 'clearInterval'),
    requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'),
    cancelAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame'),
  }

  const restore = (name) => {
    if (saved[name]) Object.defineProperty(globalThis, name, saved[name])
    else delete globalThis[name]
  }

  try {
    globalThis.setTimeout = fakeSetTimeout
    globalThis.setInterval = fakeSetInterval
    globalThis.clearTimeout = fakeClear
    globalThis.clearInterval = fakeClear
    globalThis.requestAnimationFrame = (fn) => fakeSetTimeout(() => fn(timers.now), 16)
    globalThis.cancelAnimationFrame = () => undefined

    const windowStub = {
      localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      },
    }
    globalThis.window = windowStub
    globalThis.document = {
      createElement: (tag) => fakeNode(String(tag)),
      head: fakeNode('head'),
      body: fakeNode('body'),
    }
    // Node >= 21 defines `navigator` as a getter-only global, so a plain assignment throws here.
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: async () => undefined } },
      configurable: true,
      writable: true,
    })

    globalThis.fetch = (url, options = {}) => {
      const target = String(url)
      const method = String(options.method || 'GET').toUpperCase()
      let body = {}
      try {
        body = options.body ? JSON.parse(options.body) : {}
      } catch {
        body = {}
      }
      fetchCalls.push({ path: target, method, body })
      const result = mock
        ? mock({ path: target, method, body })
        : { status: 404, body: { ok: false, error: 'no route in the test double' } }
      return new Promise((resolve) => {
        const settle = () => {
          pending.splice(pending.indexOf(settle), 1)
          resolve({ ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body })
        }
        pending.push(settle)
      })
    }

    // ---------------------------------------------------------------- load client.js
    let plugin = null
    windowStub.__ModuleLoader__ = { load: (definition) => { plugin = definition } }
    await import(new URL('../client.js', import.meta.url).href)
    if (!plugin || typeof plugin.factory !== 'function') throw new Error('client.js did not register a factory')

    // The panel component is not exported; it is whatever gets registered into the `main` slot.
    // The sidebar icon is registered too, so the slot name is what tells them apart.
    const module = plugin.factory((name) => {
      if (name === 'react') return react.React
      throw new Error(`the test double has no module for ${name}`)
    })
    const slots = {
      inject: (_name, register) => register(),
      register: (options, value) => {
        if (options && options.name === 'main' && typeof value === 'function') component = value
        return () => undefined
      },
    }
    /**
     * `apply` is the moment the panel asks for its optional services, so it has to run *after* a
     * test has installed them. Calling it per boot is also what really happens: a plugin applies
     * once, against the services that exist at that moment.
     */
    const bootApply = () => {
      module.apply({
        get: (name) => (name === 'uiWorkspace' ? uiWorkspace : undefined),
        effect: (fn) => fn(),
        slots,
      })
      if (!component) throw new Error('client.js did not register a panel component')
    }
    bootApply()

    // ---------------------------------------------------------------- fixtures
    const JOB = {
      id: 'job1',
      itemId: 'gcc',
      name: 'GCC',
      mode: 'winget',
      label: 'winget install --id GCC -e',
      status: 'running',
      phase: 'download',
      percent: 42,
      size: '12 MB',
      activity: 'Downloading 42%',
      startedAt: timers.now - 5_000,
      endedAt: null,
      exitCode: null,
      error: null,
      cleanup: null,
      log: ['Downloading 42%'],
    }

    const INVENTORY = {
      ok: true,
      scannedAt: new Date(timers.now).toISOString(),
      platform: 'win32',
      host: 'test',
      categories: [{ id: 'language', name: '语言运行时', nameEn: 'Language runtimes' }],
      items: [
        {
          id: 'gcc',
          name: 'GCC',
          nameEn: 'GCC',
          category: 'language',
          essential: true,
          installed: false,
          version: null,
          where: null,
          reason: '未找到 gcc',
          plans: [{ mode: 'winget', label: 'winget install --id GCC -e', url: null, note: null }],
          install: {},
        },
      ],
      summary: { total: 1, installed: 0, missing: 1, essentialMissing: 1 },
    }

    const cancelled = (job, cleanup) =>
      Object.assign({}, job, {
        status: 'cancelled',
        endedAt: timers.now,
        cleanup,
        log: [...job.log, '收到取消请求', '已终止进程树（PID 4242）'],
      })

    /**
     * A fresh panel holding one running job; `cancel` decides how the cancel route answers.
     *
     * `extra` can replace the inventory payload, install the directory picker, and pre-fill the
     * roots store — the extra-folders feature needs all three, and keeping it in the same harness
     * means the picker is exercised against the same panel the cancel tests drive.
     */
    async function boot(cancel, extra = {}) {
      storage.set('dsh-dev-env.lang', 'zh')
      fetchCalls.length = 0
      pending.length = 0
      timers.queue.clear()
      timers.now = 1_700_000_000_000
      react.current.hooks = []
      react.current.cursor = 0
      uiWorkspace = extra.uiWorkspace ?? null
      bootApply()
      let jobs = [extra.job ? Object.assign({}, JOB, extra.job) : JOB]
      let roots = extra.roots ?? []
      const inventory = extra.inventory ?? INVENTORY
      mock = ({ path: target, method, body }) => {
        if (target.includes('/inventory')) return { status: 200, body: inventory }
        if (target.includes('/roots')) {
          if (method === 'DELETE') {
            roots = roots.filter((root) => root.dir.toLowerCase() !== String(body.dir).toLowerCase())
            return { status: 200, body: { ok: true, roots } }
          }
          if (method === 'POST') {
            roots = [...roots, { dir: body.dir, source: 'picked', removable: true }]
            const answer = extra.onPost ? extra.onPost(body) : { status: 200, body: { ok: true, roots, verdict: null } }
            if (answer.body && !answer.body.roots) answer.body.roots = roots
            return answer
          }
          return { status: 200, body: { ok: true, roots, env: extra.env ?? [] } }
        }
        if (target.includes('/jobs/cancel')) {
          const answer = cancel(jobs[0])
          if (answer.jobs) jobs = answer.jobs
          return answer
        }
        if (target.includes('/jobs')) return { status: 200, body: { ok: true, jobs } }
        return { status: 404, body: { ok: false, error: 'no route in the test double' } }
      }
      render()
      await flush()
      // Stop the world before moving the clock. The panel's poll effect is registered once, so it
      // keeps re-arming itself; letting fake time run would keep firing it (real React would re-run
      // that effect against a fresh closure instead). Freezing is what a user's page effectively
      // does between clicks — and the "已用" counter, driven by the one-second interval, still
      // advances, which is the point of moving the clock at all.
      timers.queue.clear()
      await advance(1_200)
      await flush()
      timers.queue.clear()
      if (!tree) throw new Error('the panel did not render')
      return tree
    }

    // ---------------------------------------------------------------- cases

    await harness.check('a running job offers Cancel on its row, and no Delete', async () => {
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }))
      const cancelButton = buttonByText(root, '取消')
      if (!cancelButton) {
        throw new Error(`no Cancel button on the running job's row (buttons: ${buttonLabels(root).join(' / ')})`)
      }
      if (cancelButton.props.disabled === true) throw new Error('Cancel must be clickable while the job runs')
      if (buttonByText(root, '删除')) throw new Error('a running job must not offer Delete')
      if (!buttonByText(root, '详情')) throw new Error('the row should still offer Details')
      // The row has to look live, not frozen — that is the state someone cancels from.
      const text = visibleTextOf(root)
      if (!text.includes('已用')) throw new Error(`the running row should show elapsed time, got: ${text.slice(0, 200)}`)
    })

    await harness.check('clicking Cancel posts the job id once, and locks the button until it returns', async () => {
      const root = await boot((job) => {
        const done = cancelled(job, 'external-cache-untouched')
        return { status: 200, body: { ok: true, job: done, jobs: [done] } }
      })
      clickButton(root, '取消')
      // Left deliberately in flight: the button must already be locked at this point. The press
      // re-rendered the panel, so this reads the new tree rather than the pre-click one.
      const locked = buttonByText(tree, '取消中…')
      if (!locked) throw new Error(`the Cancel button should read 取消中… in flight (buttons: ${buttonLabels(tree).join(' / ')})`)
      if (locked.props.disabled !== true) throw new Error('the Cancel button must be disabled while the request is in flight')

      await flush()
      const cancels = fetchCalls.filter((call) => call.path.includes('/jobs/cancel'))
      if (cancels.length !== 1) throw new Error(`expected exactly one cancel request, got ${cancels.length}`)
      if (cancels[0].method !== 'POST') throw new Error(`cancel must be a POST, got ${cancels[0].method}`)
      if (cancels[0].body.id !== JOB.id) throw new Error(`cancel posted id ${JSON.stringify(cancels[0].body.id)}`)
    })

    await harness.check('after cancelling, the row reads cancelled and names the cleanup boundary', async () => {
      const root = await boot((job) => {
        const done = cancelled(job, 'external-cache-untouched')
        return { status: 200, body: { ok: true, job: done, jobs: [done] } }
      })
      clickButton(root, '取消')
      await flush()

      const text = visibleTextOf(tree)
      if (!text.includes('已取消')) throw new Error(`the row should read 已取消, got: ${text.slice(0, 200)}`)
      if (buttonByText(tree, '取消')) throw new Error('a cancelled job must not still offer Cancel')
      if (buttonByText(tree, '取消中…')) throw new Error('the in-flight label must not stick')
      if (!buttonByText(tree, '删除')) throw new Error('a cancelled job should be deletable')
      // A winget cache is not ours to delete: say which boundary applied rather than imply a clean sweep.
      if (!text.includes('安装器自己的缓存不是我们的，原样留下')) {
        throw new Error('the cleanup boundary should be shown, not implied')
      }
      if (text.includes('已删除我们自己下载的未完成残片')) {
        throw new Error('a winget job reports the external-cache boundary, not ours')
      }
    })

    await harness.check('a cancelled download reports the boundary the other way round', async () => {
      const root = await boot((job) => {
        const done = cancelled(job, 'partial-removed')
        return { status: 200, body: { ok: true, job: done, jobs: [done] } }
      })
      clickButton(root, '取消')
      await flush()
      if (!visibleTextOf(tree).includes('已删除我们自己下载的未完成残片')) {
        throw new Error('a transfer we ran ourselves should report its partial files as removed')
      }
    })

    await harness.check('a rejected cancel shows the reason and leaves the job usable', async () => {
      const root = await boot(() => ({ status: 400, body: { ok: false, error: '任务已经结束，不需要取消' } }))
      clickButton(root, '取消')
      await flush()
      if (!visibleTextOf(tree).includes('任务已经结束，不需要取消')) throw new Error('the server reason should be shown')
      if (!buttonByText(tree, '取消')) throw new Error('the row must stay usable so the user can retry')
    })

    await harness.check('a job we downloaded ourselves shows a real rate and ETA', async () => {
      // Only our own downloads have these numbers. A managed installer (winget etc.) prints no size
      // when its output is piped, so showing an invented rate there would be a lie.
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        job: {
          mode: 'download',
          status: 'running',
          phase: 'download',
          percent: 42,
          receivedBytes: 39_000_000,
          totalBytes: 90_631_635,
          bytesPerSecond: 13_300_000,
          etaSeconds: 4,
        },
      })
      clickButton(root, '详情')
      const text = visibleTextOf(tree)
      if (!/MB\/s/.test(text)) throw new Error(`the rate should be shown, got: ${text.slice(0, 300)}`)
      if (!text.includes('剩余')) throw new Error(`the ETA should be shown, got: ${text.slice(0, 300)}`)
      if (!text.includes('/ 86.4 MB')) throw new Error(`transferred and total should be shown, got: ${text.slice(0, 300)}`)
    })

    await harness.check('a managed installer job invents no rate', async () => {
      // The same row without those fields must stay silent about speed rather than print 0 B/s.
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        job: { mode: 'winget', status: 'running', phase: 'download', percent: 42 },
      })
      clickButton(root, '详情')
      const text = visibleTextOf(tree)
      if (/MB\/s|KB\/s/.test(text)) throw new Error(`no rate should be claimed, got: ${text.slice(0, 300)}`)
      if (text.includes('剩余')) throw new Error(`no ETA should be claimed, got: ${text.slice(0, 300)}`)
    })

    // ------------------------------------------------------------ extra folders    // The "already installed? pick its folder" feature. Two halves matter: which rows offer the
    // picker at all, and what the user is told after choosing.

    const PICK_LABEL = '📁 已经安装？选择对应文件夹'
    const jmeterItem = (hint) => ({
      id: 'jmeter',
      name: 'Apache JMeter',
      nameEn: 'Apache JMeter',
      category: 'language',
      essential: true,
      installed: false,
      version: null,
      where: null,
      reason: '候选路径都不存在或匹配不到版本号',
      hint,
      plans: [{ mode: 'winget', label: 'winget install --id Apache.JMeter -e', url: null, note: null }],
      install: {},
    })
    const inventoryWith = (item) => Object.assign({}, INVENTORY, { items: [item], summary: { total: 1, installed: 0, missing: 1, essentialMissing: 1 } })

    await harness.check('the folder picker is offered only where a folder could identify the tool', async () => {
      // `hint` non-null means a pathList probe, which is the only kind a picked folder can satisfy.
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        inventory: inventoryWith(jmeterItem('请选择目录名匹配 apache-jmeter-([\\d.]+) 的那一层，或者它的上一级目录。')),
        uiWorkspace: { pickDirectory: async () => null },
      })
      if (!buttonByText(root, PICK_LABEL)) {
        throw new Error(`a pathList entry should offer the picker (buttons: ${buttonLabels(root).join(' / ')})`)
      }
      if (!visibleTextOf(root).includes('apache-jmeter-([\\d.]+)')) throw new Error('the hint should be shown next to it')
    })

    await harness.check('a registry entry is never offered a folder picker', async () => {
      // Picking a folder for a registry/argv probe would achieve nothing; offering it would only
      // teach the user that the button is broken.
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        inventory: inventoryWith(jmeterItem(null)),
        uiWorkspace: { pickDirectory: async () => null },
      })
      if (buttonByText(root, PICK_LABEL)) throw new Error('hint === null must not render a picker')
      if (!buttonByText(root, '一键补齐')) throw new Error('the rest of the row should be unchanged')
    })

    await harness.check('with no picker service the button is absent, not broken', async () => {
      // uiWorkspace is an optional client service. Without it there is no way to obtain a real path.
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        inventory: inventoryWith(jmeterItem('请选择目录名匹配 apache-jmeter-([\\d.]+) 的那一层。')),
        uiWorkspace: null,
      })
      if (buttonByText(root, PICK_LABEL)) throw new Error('no uiWorkspace means no picker button')
    })

    await harness.check('picking a folder posts it, reports the verdict, and lists it as removable', async () => {
      const picked = 'D:\\Java\\测试工具\\apache-jmeter-5.6.3'
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        inventory: inventoryWith(jmeterItem('请选择目录名匹配 apache-jmeter-([\\d.]+) 的那一层。')),
        uiWorkspace: { pickDirectory: async () => picked },
        onPost: () => ({
          status: 200,
          body: {
            ok: true,
            verdict: { id: 'jmeter', ok: true, version: '5.6.3', missing: [], message: '已认出 Apache JMeter（5.6.3）' },
          },
        }),
      })
      clickButton(root, PICK_LABEL)
      await flush()

      const posts = fetchCalls.filter((call) => call.path.endsWith('/api/roots') && call.method === 'POST')
      if (posts.length !== 1) {
        throw new Error(
          `expected one POST, got ${posts.length}; all calls: ${fetchCalls.map((call) => `${call.method} ${call.path}`).join(', ')}; text: ${visibleTextOf(tree).slice(0, 200)}`,
        )
      }
      if (posts[0].body.dir !== picked) throw new Error(`posted ${JSON.stringify(posts[0].body.dir)}`)
      if (posts[0].body.id !== 'jmeter') throw new Error(`posted id ${JSON.stringify(posts[0].body.id)}`)
      if (!visibleTextOf(tree).includes('已认出 Apache JMeter（5.6.3）')) {
        const rootNodes = allNodes(tree).filter((node) => String(node.props?.className || '').includes('dsh-de-root'))
        throw new Error(`the verdict should be shown; panel says: ${rootNodes.map(textOf).join(' | ').replace(/\s+/g, ' ').slice(0, 500)}`)
      }
      // The store is now listed, tagged as hand-added, with a way to undo it.
      if (!visibleTextOf(tree).includes(picked)) throw new Error('the picked folder should be listed')
      if (!visibleTextOf(tree).includes('手动添加')) throw new Error('the row should say where the root came from')
      if (!buttonByText(tree, '移除')) throw new Error('a hand-added root must be removable')
    })

    await harness.check('cancelling the picker does nothing at all', async () => {
      // pickDirectory() resolves null on cancel — not an error, and definitely not a stored root.
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        inventory: inventoryWith(jmeterItem('请选择目录名匹配 apache-jmeter-([\\d.]+) 的那一层。')),
        uiWorkspace: { pickDirectory: async () => null },
      })
      clickButton(root, PICK_LABEL)
      await flush()
      const writes = fetchCalls.filter((call) => call.method !== 'GET')
      if (writes.length) throw new Error(`cancelling must not write anything, saw ${JSON.stringify(writes)}`)
      if (visibleTextOf(tree).includes('已认出')) throw new Error('cancelling must not claim success')
    })

    await harness.check('a refused pick explains what is missing', async () => {
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        inventory: inventoryWith(jmeterItem('请选择目录名匹配 apache-jmeter-([\\d.]+) 的那一层。')),
        uiWorkspace: { pickDirectory: async () => 'D:\\Java\\测试工具' },
        onPost: () => ({
          status: 200,
          body: {
            ok: true,
            verdict: {
              id: 'jmeter',
              ok: false,
              version: null,
              missing: ['目录名或文件内容不匹配 apache-jmeter-([\\d.]+)'],
              message: '这个目录里没有认出 Apache JMeter（目录名或文件内容不匹配 apache-jmeter-([\\d.]+)）。',
            },
          },
        }),
      })
      clickButton(root, PICK_LABEL)
      await flush()
      if (!visibleTextOf(tree).includes('没有认出 Apache JMeter')) throw new Error('the refusal reason should be shown')
    })

    await harness.check('additionally-stored roots from the environment are shown but not removable', async () => {
      // An administrator-set root cannot be deleted from the panel. Saying so beats a dead button.
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        roots: [
          { dir: 'D:\\Java\\测试工具', source: 'picked', removable: true },
          { dir: 'E:\\env-root', source: 'env', removable: false },
        ],
      })
      const text = visibleTextOf(tree)
      if (!text.includes('D:\\Java\\测试工具') || !text.includes('E:\\env-root')) {
        throw new Error(`both roots should be listed, got: ${text.slice(0, 300)}`)
      }
      if (!text.includes('来自环境变量')) throw new Error('the environment root should be labelled')
      const removeButtons = allNodes(root).filter((node) => node.type === 'button' && textOf(node).trim() === '移除')
      if (removeButtons.length !== 1) {
        throw new Error(`exactly one root is removable here, found ${removeButtons.length} remove buttons`)
      }
    })

    await harness.check('removing a stored root deletes it and rescans', async () => {
      const keep = { dir: 'E:\\env-root', source: 'env', removable: false }
      const root = await boot(() => ({ status: 200, body: { ok: true, jobs: [] } }), {
        roots: [{ dir: 'D:\\wrong-pick', source: 'picked', removable: true }, keep],
      })
      clickButton(root, '移除')
      await flush()
      const deletes = fetchCalls.filter((call) => call.method === 'DELETE')
      if (deletes.length !== 1) throw new Error(`expected one DELETE, got ${deletes.length}`)
      if (deletes[0].body.dir !== 'D:\\wrong-pick') throw new Error(`deleted ${JSON.stringify(deletes[0].body.dir)}`)
      if (visibleTextOf(tree).includes('D:\\wrong-pick')) throw new Error('the removed root should be gone from the list')
      if (!visibleTextOf(tree).includes('E:\\env-root')) throw new Error('the environment root must survive')
    })
  } finally {
    for (const name of Object.keys(saved)) restore(name)
  }
}
