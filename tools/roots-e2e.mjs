// Temporary end-to-end check of the roots feature: drives the REAL routes registered by index.js
// against the REAL catalog probes, with a throwaway roots store.
//
// Run from the plugin directory:  node tools/roots-e2e.mjs
import { existsSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const storeDir = path.join(os.tmpdir(), `dsh-dev-env-e2e-${process.pid}`)
process.env.DSH_DEV_ENV_ROOTS_FILE = path.join(storeDir, 'roots.json')
delete process.env.DSH_DEV_ENV_ROOTS

const plugin = await import('../index.js')

// A webServer stub good enough for registerRoutes(): it records every route it is handed.
const routes = new Map()
const webServer = {
  register(definition) {
    routes.set(definition.path, definition.handler)
    return () => routes.delete(definition.path)
  },
}
const ctx = {
  inject: (services, callback) => {
    if (services.includes('webServer')) callback({ webServer })
  },
  tools: { register: () => () => undefined },
  effect: (fn) => fn(),
}
ctx.get = () => undefined
plugin.apply(ctx, {})
await new Promise((resolve) => setImmediate(resolve))

/** Invoke a registered route with an optional JSON body and return { code, body }. */
const call = async (target, method, json) => {
  // `target` may carry a query string; the route table is keyed by the bare path.
  const pathname = target.split('?')[0]
  const handler = routes.get(pathname)
  if (!handler) throw new Error(`route not registered: ${pathname} (have: ${[...routes.keys()].join(', ')})`)
  const chunks = json === undefined ? [] : [Buffer.from(JSON.stringify(json))]
  const req = { url: target, method }
  req.on = (event, fn) => {
    if (event === 'data') chunks.forEach((chunk) => fn(chunk))
    if (event === 'end') setImmediate(fn)
    return req
  }
  return new Promise((resolve) => {
    let settled = false
    const res = {
      writeHead: (code) => {
        settled = true
        res._code = code
      },
      end: (text) => {
        settled = true
        resolve({ code: res._code ?? 200, body: safeParse(text) })
      },
    }
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!settled) resolve({ code: 500, body: { error: String(error && error.message) } })
    })
  })
}

const safeParse = (text) => {
  try {
    return JSON.parse(text ?? '{}')
  } catch {
    return { raw: String(text).slice(0, 200) }
  }
}

console.log('registered /api/roots:', routes.has('/dsh-dev-env/api/roots'))

const CANDIDATES = ['D:\\Java\\测试工具\\apache-jmeter-5.6.3', 'D:\\Java\\测试工具']
const picked = CANDIDATES.find((dir) => existsSync(dir))
if (!picked) throw new Error(`none of ${CANDIDATES.join(', ')} exists — nothing to test with`)

console.log('\n== GET /api/roots (empty store) ==')
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'GET')))

console.log(`\n== POST /api/roots   dir=${picked}   id=jmeter ==`)
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'POST', { dir: picked, id: 'jmeter' }), null, 1))

console.log('\n== GET /api/inventory?refresh=1   (does the scan see it now?) ==')
const inventory = await call('/dsh-dev-env/api/inventory?refresh=1', 'GET')
const jmeter = (inventory.body.items || []).find((item) => item.id === 'jmeter')
console.log('jmeter        :', JSON.stringify({ installed: jmeter?.installed, version: jmeter?.version, where: jmeter?.where }))
console.log('roots payload :', JSON.stringify(inventory.body.roots))
console.log('jmeter hint   :', JSON.stringify(jmeter?.hint))

console.log('\n== GET /api/roots (after the pick) ==')
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'GET')))

console.log('\n== DELETE /api/roots ==')
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'DELETE', { dir: picked })))

console.log('\n== DELETE something that was never stored ==')
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'DELETE', { dir: 'D:\\nope' })))

console.log('\n== POST with a bad directory ==')
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'POST', { dir: 'relative\\path', id: 'jmeter' })))
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'POST', { dir: 'D:\\definitely-not-here', id: 'jmeter' })))
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'POST', { id: 'jmeter' })))

console.log('\n== POST a root for an entry that does not take one (git) ==')
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'POST', { dir: 'D:\\Java', id: 'git' })))
console.log(JSON.stringify(await call('/dsh-dev-env/api/roots', 'DELETE', { dir: 'D:\\Java' })))

rmSync(storeDir, { recursive: true, force: true })
console.log('\ncleaned up temporary store')
