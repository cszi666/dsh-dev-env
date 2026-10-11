/**
 * Manual check, step 3 of 3: does the scanner recognise what we downloaded and unpacked?
 *
 *   node tools/download-prepare.mjs                     # download into out/
 *   tar -xf out/apache-jmeter-5.6.3.zip -C out/extract  # the command the plugin runs
 *   node tools/download-verify.mjs                      # this file
 *
 * It reports the probe's verdict for the folder, the full scan path with that folder as an extra
 * root, and a layout comparison against a JMeter that was installed some other way. The extra root is
 * only written when `DSH_PROFILE_DIR` names a throwaway directory, so running it by hand cannot
 * disturb a real profile.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { CATALOG } from '../catalog.js'
import { loadRoots, saveRoots } from '../roots.js'
import { rootsFile } from '../paths.js'
import { __test } from '../index.js'

const extracted = path.resolve(import.meta.dirname, '..', 'out', 'extract', 'apache-jmeter-5.6.3')
if (!existsSync(extracted)) throw new Error(`not extracted yet: ${extracted}`)
console.log('folder:', extracted)

const entry = CATALOG.find((row) => row.id === 'jmeter')

console.log('\n=== 探针对这一个目录的判定（面板回执用的就是它）===')
const atDir = __test.probeAtDir(entry.probe, extracted)
console.log(' ', JSON.stringify(atDir))

console.log('\n=== 完整扫描路径（probeItem + 显式 roots）===')
const result = await __test.probeItem(entry, {}, { roots: [extracted] })
console.log(' ', JSON.stringify({ installed: result.installed, version: result.version, where: result.where }))

console.log('\n=== 登记成额外根目录之后 ===')
const file = rootsFile()
console.log('  roots file:', file)
const before = loadRoots(file)
console.log('  before   :', JSON.stringify(before))
// Only touch the real store if it is a throwaway: report rather than mutate when it is not.
if (process.env.DSH_PROFILE_DIR && process.env.DSH_PROFILE_DIR.includes('dsh-dev-env-verify')) {
  saveRoots(file, [extracted, ...before.filter((dir) => dir.toLowerCase() !== extracted.toLowerCase())])
  console.log('  after    :', JSON.stringify(loadRoots(file)))
} else {
  console.log('  (not writing: DSH_PROFILE_DIR is not a throwaway dir)')
}

console.log('\n=== 目录布局对照（真实解压 vs 你机器上已有的那份）===')
const reference = 'D:\\Java\\测试工具\\apache-jmeter-5.6.3'
for (const dir of [extracted, reference]) {
  const present = ['bin', 'lib', 'docs', 'LICENSE', 'NOTICE'].filter((name) => existsSync(path.join(dir, name)))
  console.log(`  ${dir}\n     ${present.join(', ')}`)
}
