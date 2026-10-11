// Temporary: cancel a real in-flight download and prove nothing is left behind.
// The promise being verified: "cancel = interrupt + delete .part and metadata, no leftovers".
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const profileDir = path.join(os.tmpdir(), `dsh-dev-env-cancel-${process.pid}`)
process.env.DSH_PROFILE_DIR = profileDir
delete process.env.DSH_DEV_ENV_ROOTS

const plugin = await import('../index.js')
const routes = new Map()
plugin.apply(
  {
    inject: (services, callback) => services.includes('webServer') && callback({ webServer: { register: (d) => (routes.set(d.path, d.handler), () => routes.delete(d.path)) } }),
    tools: { register: () => () => undefined },
    effect: (fn) => fn(),
    get: () => undefined,
  },
  {},
)
await new Promise((resolve) => setImmediate(resolve))

const call = async (target, method, json) => {
  const handler = routes.get(target.split('?')[0])
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

const downloadDir = path.join(profileDir, 'dsh-dev-env', 'downloads')
const listing = () => (existsSync(downloadDir) ? readdirSync(downloadDir).map((name) => {
  const full = path.join(downloadDir, name)
  const stat = statSync(full)
  return `${name}${stat.isDirectory() ? '/' : ` (${stat.size} bytes)`}`
}) : [])

const started = await call('/dsh-dev-env/api/install', 'POST', { id: 'jmeter', mode: 'download' })
const jobId = started.body.job?.id
console.log('job started:', jobId, started.body.job?.status)

// Wait until a few megabytes are in, then cancel mid-transfer.
let before = []
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 250))
  before = listing()
  const jobs = await call('/dsh-dev-env/api/jobs', 'GET')
  const job = jobs.body.jobs.find((row) => row.id === jobId)
  if ((job?.receivedBytes ?? 0) > 4 * 1024 * 1024) {
    console.log(`cancelling at ${job.receivedBytes} bytes (${job.percent}%)`)
    console.log('  files before cancel:', JSON.stringify(before))
    break
  }
  if (job?.status !== 'running') {
    console.log('job finished before it could be cancelled:', job?.status)
    break
  }
}

const cancelled = await call('/dsh-dev-env/api/jobs/cancel', 'POST', { id: jobId })
console.log('\ncancel answer:', cancelled.code)
console.log('  status  :', cancelled.body.job?.status)
console.log('  cleanup :', cancelled.body.job?.cleanup)
console.log('  log tail:', JSON.stringify((cancelled.body.job?.log ?? []).slice(-4)))

// Give the abort a moment to unwind, then look at the disk.
await new Promise((resolve) => setTimeout(resolve, 1500))
const after = listing()
console.log('\n  files after cancel :', JSON.stringify(after))
const leftovers = after.filter((name) => name.includes('.part'))
console.log(leftovers.length === 0 ? '  OK: no .part or metadata left behind' : `  LEFTOVERS: ${JSON.stringify(leftovers)}`)
const finalJob = (await call('/dsh-dev-env/api/jobs', 'GET')).body.jobs.find((row) => row.id === jobId)
console.log('  final status:', finalJob?.status, 'endedAt set:', Boolean(finalJob?.endedAt))

rmSync(profileDir, { recursive: true, force: true })
console.log('\ncleaned up', profileDir)
