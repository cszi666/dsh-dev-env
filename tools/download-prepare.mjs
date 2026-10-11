/**
 * Manual check, step 1 of 3: fetch the real archive into `out/` (gitignored) and report the transfer.
 *
 *   node tools/download-prepare.mjs
 *
 * Then unpack it — the DSH sandbox refuses to let a Node process spawn with piped stdio
 * (`spawn EPERM`), so the extraction cannot run from here even though the plugin itself does it
 * exactly this way at runtime:
 *
 *   tar -xf out/apache-jmeter-5.6.3.zip -C out/extract
 *
 * and finally confirm the scanner recognises the result:
 *
 *   node tools/download-verify.mjs
 */
import { mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { CATALOG } from '../catalog.js'
import { startDownload, resolveDownload, formatBytes } from '../downloads.js'

const outDir = path.resolve(import.meta.dirname, '..', 'out')
mkdirSync(outDir, { recursive: true })

const entry = CATALOG.find((row) => row.id === 'jmeter')
const resolved = await resolveDownload(entry.install.download)
if (!resolved) throw new Error('nothing resolved')

const file = path.join(outDir, resolved.name)
const started = Date.now()
let lastPercent = -1
const handle = startDownload({
  url: resolved.url,
  file,
  total: resolved.total,
  onProgress: (snapshot) => {
    const percent = Math.floor(snapshot.percent ?? 0)
    if (percent >= lastPercent + 20) {
      lastPercent = percent
      console.log(`  ${String(snapshot.percent).padStart(5)}%  ${formatBytes(snapshot.received)}  ${snapshot.expectedBytesPerSecond ? `${formatBytes(snapshot.expectedBytesPerSecond)}/s` : '—'}  eta=${snapshot.etaSeconds ?? '—'}s`)
    }
  },
})
const result = await handle.promise
console.log(`\ndownloaded ${formatBytes(result.bytes)} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`file: ${file}`)
console.log(`size: ${statSync(file).size}`)
console.log(`resolved.total: ${resolved.total}  -> bytes match: ${statSync(file).size === resolved.total}`)
