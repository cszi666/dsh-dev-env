/**
 * dsh-dev-env — 下载引擎（host 半边）
 *
 * 为什么需要它：winget / pip / npm 都是「托管安装器」——它们自己取包，我们只能看到它们的输出。
 * 而它们的输出在管道（非终端）下**连体积和速率都不打印**，也没有续传接口。所以要做「像浏览器那样」
 * 的进度、速率、断点续传和干净的取消，只有一条路：对**我们自己有 URL 的条目**，自己下载。
 *
 * 这个模块只做一件事，并且把这个做到可靠：
 *   · 流式下载到 `<file>.part`，旁边挂 `<file>.part.meta.json`
 *   · 续传前先验校验符（ETag / Last-Modified）与总字节数，不盲信 Content-Length
 *   · 速度用滑动窗口实时估算，并按 host 记住历史均值（「下载经验」）
 *   · 取消 = 中断 + 删除 .part 与 meta，不留残骸
 *   · 启动时能列出未完成项，并给出「续传 / 重下 / 已完成」的判定
 *
 * 本模块不读环境变量、不决定目录：下载目录由调用方传入，所以它在测试里可以被喂入假的 fetch
 * 和临时目录，行为完全可离线验证。
 */

import { createWriteStream, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export const PART_SUFFIX = '.part'
export const META_SUFFIX = '.part.meta.json'

export const partPathFor = (file) => `${file}${PART_SUFFIX}`
export const metaPathFor = (file) => `${file}${META_SUFFIX}`

/**
 * 续传决策——这是整个引擎里最该被单独测试的一段纯逻辑。
 *
 * 返回值是三种动作之一：
 *   { action: 'complete' }                      .part 已有完整字节，交给完成流程去校验/改名
 *   { action: 'resume', from: number }          从 from 字节处续
 *   { action: 'restart', reason: string }       现有残片不可用，必须从零重下（调用方负责删除）
 *
 * `probe` 是服务器对 HEAD / Range 探测的回答（可能为 null，比如探测失败）：
 *   { total, acceptRanges, etag, lastModified }
 *
 * 判定顺序刻意是「先判能不能续，再判要不要重下」，因为重下要多花用户一次完整流量。
 */
export function decideResume(meta, probe) {
  if (!meta || !Number.isFinite(meta.total) || meta.total <= 0) {
    return { action: 'restart', reason: '没有可用的元数据' }
  }
  const have = Number.isFinite(meta.received) ? meta.received : 0
  if (have <= 0) return { action: 'restart', reason: '残片为空' }
  if (have === meta.total) return { action: 'complete' }
  if (have > meta.total) return { action: 'restart', reason: '残片比资源本身还大' }

  // 服务器换了内容就不能续——续下去会得到两个版本拼接出的坏文件。
  if (!probe) return { action: 'restart', reason: '无法确认远端资源是否已变化' }
  if (Number.isFinite(probe.total) && probe.total !== meta.total) {
    return { action: 'restart', reason: `资源大小已变化（${meta.total} → ${probe.total}）` }
  }
  if (meta.etag && probe.etag && meta.etag !== probe.etag) {
    return { action: 'restart', reason: 'ETag 已变化' }
  }
  if (!meta.etag && meta.lastModified && probe.lastModified && meta.lastModified !== probe.lastModified) {
    return { action: 'restart', reason: 'Last-Modified 已变化' }
  }
  if (probe.acceptRanges === false) return { action: 'restart', reason: '服务器不支持断点续传' }

  return { action: 'resume', from: have }
}

/** 把字节数说成人话，面板与工具输出共用。 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '–'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/**
 * 速度计：滑动窗口 + host 历史均值。
 *
 * 「按下载经验判断」的落地方式是把两者都留着，而不是二选一：
 *   live()      最近窗口内的真实速度——网络变化时它先反应过来
 *   expected()  窗口样本不够时用该 host 的历史均值兜底——刚起步就不至于显示 0 B/s 或乱跳
 * ETA 用 expected()，面板则建议同时展示 live()，让用户自己看到"现在 vs 平均"。
 */
export function createSpeedMeter({ windowMs = 8000, historyBytesPerSecond = 0 } = {}) {
  let samples = []
  let lastTotal = 0

  return {
    /** 报告"到目前为止总共收了多少字节"。可重复用同一个值调用，重复的不会污染窗口。 */
    sample(received, at = Date.now()) {
      if (!Number.isFinite(received) || received < lastTotal) return
      if (received === lastTotal && samples.length) return
      lastTotal = received
      samples.push({ at, received })
      const cutoff = at - windowMs
      while (samples.length > 2 && samples[0].at < cutoff) samples.shift()
    },
    /** 最近窗口的真实速度（字节/秒）。样本不足 1 秒时返回 null——不猜。 */
    live() {
      if (samples.length < 2) return null
      const first = samples[0]
      const last = samples[samples.length - 1]
      const seconds = (last.at - first.at) / 1000
      if (seconds <= 0.5) return null
      return Math.max(0, (last.received - first.received) / seconds)
    },
    /** live 可用就用 live，否则退回历史均值。这就是 ETA 用的那个数。 */
    expected() {
      return this.live() ?? (historyBytesPerSecond > 0 ? historyBytesPerSecond : null)
    },
    received() {
      return lastTotal
    },
  }
}

/** host 历史速度表：跨次运行积累「下载经验」。缺失或损坏时退化成空表，绝不因此失败。 */
export function loadHistory(file) {
  try {
    if (!existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveHistory(file, history) {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(history, null, 2)}\n`, 'utf8')
  } catch {
    /* 记不住历史不是致命问题 */
  }
}

/** 用指数滑动平均更新某个 host 的速度经验；首次直接采用观测值。 */
export function recordSpeed(history, host, bytesPerSecond) {
  if (!host || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return history
  const previous = Number.isFinite(history[host]) ? history[host] : null
  history[host] = previous === null ? Math.round(bytesPerSecond) : Math.round(previous * 0.7 + bytesPerSecond * 0.3)
  return history
}

const EXTRA_HEADERS = { 'user-agent': 'dsh-dev-env downloader' }

/**
 * 探测远端：总大小、是否支持 Range、校验符。
 * 先 HEAD；有些服务器拒 HEAD，于是退回一个 `Range: bytes=0-0` 的 GET——那既能拿到头部，
 * 也只花一个字节。探测失败返回 null，让 decideResume 走"无法确认→重下"这条保守路径。
 */
export async function probeRemote(url, { fetchImpl = fetch, signal, timeoutMs = 15000 } = {}) {
  const attempt = async (init) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetchImpl(url, { ...init, redirect: 'follow', signal: controller.signal, headers: { ...EXTRA_HEADERS, ...(init.headers || {}) } })
      const range = response.headers.get('content-range') // bytes 0-0/12345
      const total = range ? Number(range.split('/').pop()) : Number(response.headers.get('content-length'))
      const value = {
        status: response.status,
        total: Number.isFinite(total) && total > 0 ? total : null,
        acceptRanges: response.headers.get('accept-ranges') === 'bytes' || response.status === 206 ? true : response.headers.get('accept-ranges') === 'none' ? false : null,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      }
      // 立刻放掉正文，否则 Range: bytes=0-0 之外的服务器可能让我们挂着
      try {
        await response.body?.cancel()
      } catch {
        /* ignore */
      }
      return value
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }

  const head = await attempt({ method: 'HEAD' })
  if (head && head.status >= 200 && head.status < 300) return head
  const ranged = await attempt({ method: 'GET', headers: { range: 'bytes=0-0' } })
  if (ranged && (ranged.status === 206 || ranged.status === 200)) return ranged
  return null
}

/**
 * 真正下载一个文件。
 *
 * 稳定优先于速度，具体体现在这几条上：
 *   · 先探测，再决定续传还是重下；残片不可用就**先删干净**再重来，不叠加
 *   · 完成前校验收到字节数等于预期总大小，不等就当作失败（宁可报错也不交付半个文件）
 *   · 只有在 `.part` 完整之后才 rename 成最终文件名，所以最终文件永远不是半成品
 *   · 取消 = abort + 删除 `.part` 与 meta（调用方不需要再操心残骸）
 *
 * 返回一个句柄：{ promise, cancel, progress() }。progress() 是给面板/工具轮询用的快照。
 */
export function startDownload(options) {
  const {
    url,
    file,
    total: knownTotal = null,
    fetchImpl = fetch,
    signal: externalSignal,
    onProgress = () => {},
    meter = createSpeedMeter(),
    history = {},
    historyFile = null,
    host = null,
    resume = true,
  } = options

  const part = partPathFor(file)
  const metaFile = metaPathFor(file)
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', abort, { once: true })
  }

  mkdirSync(path.dirname(file), { recursive: true })

  let received = 0
  let total = Number.isFinite(knownTotal) && knownTotal > 0 ? knownTotal : null
  let phase = 'probing'
  let note = null
  let settled = false

  const snapshot = () => {
    const live = meter.live()
    const expected = meter.expected()
    const remaining = total !== null ? Math.max(0, total - received) : null
    return {
      phase,
      received,
      total,
      percent: total ? Math.min(100, Math.round((received / total) * 1000) / 10) : null,
      liveBytesPerSecond: live,
      expectedBytesPerSecond: expected,
      etaSeconds: remaining !== null && expected ? Math.round(remaining / expected) : null,
      note,
    }
  }

  const cleanup = () => {
    for (const target of [part, metaFile]) {
      try {
        rmSync(target, { force: true })
      } catch {
        /* ignore */
      }
    }
  }

  const run = async () => {
    // ---- 1. 读取残片状态，判断能否续传
    let from = 0
    let existing = null
    try {
      existing = JSON.parse(readFileSync(metaFile, 'utf8'))
    } catch {
      existing = null
    }
    if (existsSync(part) && existing) {
      existing.received = statSync(part).size
      const probe = resume ? await probeRemote(url, { fetchImpl, signal: controller.signal }) : null
      const decision = decideResume(existing, probe)
      if (decision.action === 'restart') {
        note = `残片不可续传（${decision.reason}），已删除并重新下载`
        cleanup()
      } else if (decision.action === 'resume') {
        from = decision.from
        total = total ?? existing.total
        note = `从 ${formatBytes(from)} 处继续`
      } else if (decision.action === 'complete') {
        received = existing.received
        total = existing.total
        phase = 'verifying'
        renameSync(part, file)
        phase = 'done'
        return { file, bytes: received, resumed: true, note }
      }
    } else if (existsSync(part)) {
      // 有残片但没有元数据：无法证明它属于当前这个 URL，删掉重来是唯一安全的选择
      cleanup()
    }

    if (total === null) {
      const probe = await probeRemote(url, { fetchImpl, signal: controller.signal })
      if (probe && probe.total) total = probe.total
    }

    // ---- 2. 传输
    phase = from > 0 ? 'resuming' : 'downloading'
    writeFileSync(
      metaFile,
      `${JSON.stringify({ url, total, received: from, startedAt: Date.now() }, null, 2)}\n`,
      'utf8',
    )
    const headers = { ...EXTRA_HEADERS }
    if (from > 0) headers.range = `bytes=${from}-`

    const response = await fetchImpl(url, { redirect: 'follow', signal: controller.signal, headers })
    if (from > 0 && response.status !== 206) {
      // 服务器无视了 Range：从头来过，并且必须先把残片清掉，否则会得到拼接的坏文件
      note = '服务器未接受续传请求，已重新开始'
      cleanup()
      from = 0
      received = 0
      return run()
    }
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
    if (!total) {
      const length = Number(response.headers.get('content-length'))
      if (Number.isFinite(length) && length > 0) total = from + length
    }

    received = from
    meter.sample(received)
    if (!response.body) throw new Error('响应没有正文流')

    const sink = createWriteStream(part, { flags: from > 0 ? 'a' : 'w' })
    try {
      for await (const chunk of response.body) {
        if (controller.signal.aborted) throw new Error('已取消')
        await new Promise((resolve, reject) => {
          sink.write(chunk, (error) => (error ? reject(error) : resolve()))
        })
        received += chunk.length
        meter.sample(received)
        onProgress(snapshot())
      }
    } finally {
      await new Promise((resolve) => sink.end(resolve))
    }

    // ---- 3. 校验后交付：只有字节数对得上才改名成最终文件
    phase = 'verifying'
    if (total !== null && received !== total) {
      cleanup()
      throw new Error(`字节数不符：收到 ${formatBytes(received)}，预期 ${formatBytes(total)}`)
    }
    try {
      writeFileSync(metaFile, `${JSON.stringify({ url, total, received, doneAt: Date.now() }, null, 2)}\n`, 'utf8')
    } catch {
      /* ignore */
    }
    renameSync(part, file)
    try {
      rmSync(metaFile, { force: true })
    } catch {
      /* ignore */
    }
    phase = 'done'

    const rate = meter.live()
    if (historyFile && host && rate) saveHistory(historyFile, recordSpeed(history, host, rate))

    return { file, bytes: received, resumed: from > 0, note }
  }

  const promise = run()
    .catch((error) => {
      const message = String((error && error.message) || error)
      // 取消和被中断都不是"失败"以外的语义：这里只负责把状态摆正，残骸由 cancel()/恢复流程处理
      phase = controller.signal.aborted ? 'cancelled' : 'failed'
      note = note ?? message
      throw error
    })
    .finally(() => {
      settled = true
    })

  return {
    promise,
    progress: snapshot,
    get settled() {
      return settled
    },
    /** 取消：中断传输并删除残骸。返回是否已经清干净。 */
    cancel() {
      controller.abort()
      cleanup()
      phase = 'cancelled'
    },
  }
}

/**
 * 启动时的恢复扫描：列出下载目录里所有未完成项，并给出每一项该做什么。
 * 这是「断网后下次启动能续就续」的入口——它只做判定，不动文件，方便调用方先汇报再执行。
 */
export function inspectPending(dir) {  const pending = []
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return pending
  }
  for (const name of entries) {
    if (!name.endsWith(META_SUFFIX)) continue
    const metaFile = path.join(dir, name)
    const file = path.join(dir, name.slice(0, -META_SUFFIX.length))
    const part = partPathFor(file)
    let meta = null
    try {
      meta = JSON.parse(readFileSync(metaFile, 'utf8'))
    } catch {
      meta = null
    }
    if (!existsSync(part)) {
      pending.push({ file, metaFile, url: meta?.url ?? null, received: 0, total: meta?.total ?? null, action: 'restart', reason: '没有残片' })
      continue
    }
    // 这里刻意只做本地判定：能不能真的续，必须问服务器（probeRemote）。
    // 凭空假定对方支持 Range 会报出一个不成立的续传，所以只如实说明"有这么多字节的残片"。
    const received = statSync(part).size
    pending.push({
      file,
      metaFile,
      url: meta?.url ?? null,
      received,
      total: meta?.total ?? null,
      action: received > 0 ? 'pending' : 'restart',
      reason: received > 0 ? null : '残片为空',
    })
  }
  return pending
}

// ----------------------------------------------------------------- url resolution

/** Split a version into comparable numeric parts. Non-numeric tails are ignored on purpose. */
const versionParts = (text) => String(text).split(/[.\-_]/).map((part) => Number.parseInt(part, 10)).filter(Number.isFinite)

/**
 * Which of these two versions is newer? Returns a positive number when `a` wins.
 *
 * Deliberately numeric and not lexicographic: `5.10` is newer than `5.9`, and sorting filenames as
 * text would pick 5.9 and quietly install an older release.
 */
export function compareVersions(a, b) {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const one = left[index] ?? 0
    const other = right[index] ?? 0
    if (one !== other) return one - other
  }
  return 0
}

/** Every archive-like href in a directory listing, resolved against the listing's own URL. */
export function filesInListing(html, baseUrl) {
  const found = []
  for (const match of String(html).matchAll(/href\s*=\s*["']([^"']+\.(?:zip|tgz|tar\.gz|jar|exe|msi|7z))["']/gi)) {
    try {
      found.push(new URL(match[1], baseUrl).href)
    } catch {
      /* a malformed href is not worth failing the resolution for */
    }
  }
  return found
}

/**
 * Mirrors of one project are interchangeable: dlcdn, TUNA, Aliyun and USTC all serve the same tree
 * with a different host. So a source spec can carry a **named list**, the caller picks one by name,
 * and everything else — the discovery pattern, the sub-path — is shared.
 *
 * Accepts the older single-source shape too, so nothing that already worked stops working.
 * Returns null when a name was asked for that the list does not have, so the caller reports an
 * unknown mirror instead of silently using a different one.
 */
export function withSourceName(spec, name) {
  if (!spec || typeof spec !== 'object') return spec
  if (name && Array.isArray(spec.sources)) {
    const chosen = spec.sources.find((entry) => entry.name === name)
    return chosen ? { ...spec, ...chosen } : null
  }
  return spec
}

/**
 * Resolve an install source to a concrete, verified file URL.
 *
 * The catalog cannot hardcode these: Apache's `dlcdn` mirror only keeps the current release and its
 * URL carries the version (`…/jmeter/binaries/apache-jmeter-5.6.3.zip`), so a pinned URL rots at the
 * next release — silently, since a 404 is indistinguishable from a dead network without asking.
 * So a source is described as *where to look* and the concrete URL is discovered here.
 *
 * Spec shapes:
 *   { direct: 'https://…/file.zip' }                 a URL that never changes
 *   { listing: 'https://…/binaries/', fileNamePattern: '^apache-jmeter-([\\d.]+)\\.zip$' }
 *                                                    pick the newest match from a directory listing
 *   { listing: 'https://…/tomcat-11/', directoryPattern: '^v(11\\.[\\d.]+)/$',
 *     subPath: 'v{version}/bin/apache-tomcat-{version}.zip' }
 *                                                    version *directories*, the file inside them
 *   { sources: [{ name: 'apache', … }, { name: 'tuna', … }] }
 *                                                    interchangeable mirrors; `options.source` chooses
 *   { fallback: … }                                  tried (same rules) when the primary fails
 *
 * `probe` is the same HEAD/Range check the downloader uses, so "verified" means the server really
 * answers with the file — not that the URL merely looks right. That is what keeps a dead mirror out of
 * a picker: it fails here instead of appearing as an option.
 */
export async function resolveDownload(spec, options = {}) {
  const { fetchImpl = fetch, probe = probeRemote, signal, timeoutMs = 15000, source } = options
  const chosen = withSourceName(spec, source)
  if (!chosen) return null

  const fetchText = async (url) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { ...EXTRA_HEADERS, accept: 'text/html,application/xhtml+xml' },
      })
      if (!response.ok) return null
      return await response.text()
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }

  /** Candidates in preference order, most specific first. */
  const candidatesFrom = async (entry) => {
    if (!entry) return []
    if (entry.direct) return [{ url: entry.direct, version: entry.version ?? null }]
    if (!entry.listing) return []
    const html = await fetchText(entry.listing)
    if (html === null) return []
    const pattern = entry.fileNamePattern ? new RegExp(entry.fileNamePattern) : null

    // 有些镜像列表里是**版本目录**而不是文件（Apache 的 `tomcat-11/` 就是这样，zip 在
    // `v11.0.26/bin/` 下面）。`subPath` 因此接受 `{version}` 占位符——没有它就只能给 Tomcat
    // 写死一个版本，而写死的版本正是这个函数存在的理由：它会在下一个版本发布时无声腐烂。
    if (entry.subPath) {
      const dirPattern = new RegExp(entry.directoryPattern || '^v?([\\d.]+)/$')
      const dirs = []
      for (const href of String(html).matchAll(/href\s*=\s*["']([^"']+\/)["']/gi)) {
        const found = dirPattern.exec(href[1]) ?? dirPattern.exec(decodeURIComponent(href[1]))
        if (!found) continue
        const version = found[1] ?? null
        const path = entry.subPath.replace(/\{version\}/g, version ?? '')
        dirs.push({ url: new URL(path, entry.listing).href, version, name: path.split('/').pop() })
      }
      dirs.sort((a, b) => (a.version && b.version ? compareVersions(b.version, a.version) : 0))
      return dirs
    }

    const matches = []
    for (const url of filesInListing(html, entry.listing)) {
      const name = decodeURIComponent(url.split('/').pop() ?? '')
      const found = pattern ? pattern.exec(name) : [name]
      if (pattern && !found) continue
      matches.push({ url, version: found?.[1] ?? null, name })
    }
    matches.sort((a, b) => (a.version && b.version ? compareVersions(b.version, a.version) : 0))
    return matches
  }

  // `chosen` rather than `spec`: a named pick may override listing/subPath, and its `fallback` (if
  // any) must come along with it. A list without a per-source fallback still works — each mirror is
  // itself a fallback for the others, and the caller can try the next one.
  for (const entry of [chosen, chosen.fallback]) {
    for (const candidate of await candidatesFrom(entry)) {
      const info = await probe(candidate.url, { fetchImpl, signal, timeoutMs })
      if (info && info.status >= 200 && info.status < 300) {
        return {
          ...candidate,
          source: chosen.name ?? null,
          total: info.total ?? null,
          etag: info.etag ?? null,
          lastModified: info.lastModified ?? null,
        }
      }
    }
  }
  return null
}
