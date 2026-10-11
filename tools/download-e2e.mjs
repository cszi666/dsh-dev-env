// Temporary end-to-end check of the download engine, driving the REAL routes in index.js.
// Uses a throwaway profile directory so the user's real roots file is untouched.
import { existsSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const profileDir = path.join(os.tmpdir(), `dsh-dev-env-dl-${process.pid}`)
process.env.DSH_PROFILE_DIR = profileDir
delete process.env.DSH_DEV_ENV_ROOTS
delete process.env.DSH_DEV_ENV_ROOTS_FILE

const plugin = await import('../index.js')

const routes = new Map()
const webServer = { register: (definition) => (routes.set(definition.path, definition.handler), () => routes.delete(definition.path)) }
plugin.apply(
  {
    inject: (services, callback) => services.includes('webServer') && callback({ webServer }),
    tools: { register: () => () => undefined },
    effect: (fn) => fn(),
    get: () => undefined,
  },
  {},
)
await new Promise((resolve) => setImmediate(resolve))

const call = async (target, method, json) => {
  const pathname = target.split('?')[0]
  const handler = routes.get(pathname)
  if (!handler) throw new Error(`no route ${pathname}`)
  const chunks = json === undefined ? [] : [Buffer.from(JSON.stringify(json))]
  const req = { url: target, method }
  req.on = (event, fn) => {
    if (event === 'data') chunks.forEach((chunk) => fn(chunk))
    if (event === 'end') setImmediate(fn)
    return req
  }
  return new Promise((resolve) => {
    const res = { writeHead: (code) => (res._code = code), end: (text) => resolve({ code: res._code ?? 200, body: JSON.parse(text ?? '{}') }) }
    Promise.resolve(handler(req, res)).catch((error) => resolve({ code: 500, body: { error: String(error?.message) } }))
  })
}

console.log('== 启动自己下载（jmeter） ==')
const started = await call('/dsh-dev-env/api/install', 'POST', { id: 'jmeter', mode: 'download' })
console.log('  ok:', started.body.ok, ' job:', started.body.job?.id, started.body.job?.status, '|', started.body.job?.label)
const jobId = started.body.job?.id
if (!jobId) throw new Error(`no job started: ${JSON.stringify(started.body).slice(0, 300)}`)

let last = ''
const t0 = Date.now()
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 400))
  const jobs = await call('/dsh-dev-env/api/jobs', 'GET')
  const job = jobs.body.jobs.find((row) => row.id === jobId)
  if (!job) throw new Error('job disappeared')
  const line = `${job.status} ${job.phase ?? '-'} ${job.percent ?? '-'}% ${job.activity ?? ''}`
  if (line !== last) {
    last = line
    console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`)
    if (job.bytesPerSecond) console.log(`        ${job.receivedBytes} / ${job.totalBytes} bytes, ${Math.round(job.bytesPerSecond / 1024)} KB/s, eta ${job.etaSeconds}s`)
  }
  if (job.status !== 'running') {
    console.log(`\n== 结束：${job.status}${job.error ? ` (${job.error})` : ''} ==`)
    console.log('  日志尾部：')
    for (const row of (job.log || []).slice(-8)) console.log(`    ${row}`)
    break
  }
  if (Date.now() - t0 > 5 * 60_000) {
    console.log('TIMEOUT — 5 分钟未结束')
    break
  }
}

console.log('\n== 磁盘上有什么 ==')
const downloadDir = path.join(profileDir, 'dsh-dev-env', 'downloads')
if (existsSync(downloadDir)) {
  for (const name of readdirSync(downloadDir)) {
    const full = path.join(downloadDir, name)
    const stat = statSync(full)
    console.log(`  ${stat.isDirectory() ? 'DIR ' : 'FILE'} ${name}${stat.isDirectory() ? '' : ` (${(stat.size / 1048576).toFixed(1)}MB)`}`)
  }
} else {
  console.log('  (下载目录不存在)')
}

console.log('\n== roots 存储 ==')
const rootsFile = path.join(profileDir, 'dsh-dev-env', 'roots.json')
console.log(existsSync(rootsFile) ? readFileSync(rootsFile, 'utf8').replace(/\s+/g, ' ') : '  (没有 roots.json)')

console.log('\n== 下一次扫描能不能认出它？（这才是"装好了"的判据）==')
const inventory = await call('/dsh-dev-env/api/inventory?refresh=1', 'GET')
const jmeter = inventory.body.items?.find((row) => row.id === 'jmeter')
console.log('  jmeter:', JSON.stringify({ installed: jmeter?.installed, version: jmeter?.version, where: jmeter?.where }))
console.log('  roots :', JSON.stringify(inventory.body.roots))

console.log('\n== 清理（172MB 不留在临时目录里） ==')
rmSync(profileDir, { recursive: true, force: true })
console.log('  removed', profileDir)
