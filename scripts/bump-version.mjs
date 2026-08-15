#!/usr/bin/env node
/**
 * 版本号提升：node scripts/bump-version.mjs <version> [--dry-run]
 * 仅更新 package.json 的 version 字段（electron-builder 打包读取它）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const version = args.find((a) => !a.startsWith('--'))
const dryRun = args.includes('--dry-run')

if (!version || !/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(version)) {
  console.error('用法: node scripts/bump-version.mjs <版本> [--dry-run]')
  console.error('版本格式: x.y.z 或 x.y.z-rc.N')
  process.exit(1)
}

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const before = pkg.version
if (before === version) {
  console.log('版本未变化: ' + version)
  process.exit(0)
}
if (dryRun) {
  console.log('[dry-run] ' + before + ' → ' + version + '（未写入）')
  process.exit(0)
}
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + String.fromCharCode(10), 'utf8')
console.log('版本已更新: ' + before + ' → ' + version)
console.log('下一步: git add package.json && git commit -m "chore: bump to v' + version + '"')
console.log('然后: pnpm release:check && pnpm release:tag')
