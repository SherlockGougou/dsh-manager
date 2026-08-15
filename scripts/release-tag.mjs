#!/usr/bin/env node
/**
 * 创建并推送发布 tag：node scripts/release-tag.mjs [--dry-run]
 * 触发 GitHub Actions release workflow（on: push tags v*）。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')
const skipCheck = process.argv.includes('--skip-check')

if (!skipCheck) {
  console.log('== 发布前检查 ==')
  execSync('node ' + join(root, 'scripts', 'check-release-ready.mjs'), { stdio: 'inherit' })
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = 'v' + pkg.version
console.log('== 创建 tag ' + tag + ' ==')

const message = 'Release ' + tag
if (dryRun) {
  console.log('[dry-run] git tag -a ' + tag + ' -m "' + message + '"')
  console.log('[dry-run] git push origin ' + tag)
  console.log('完成（dry-run，未执行）')
  process.exit(0)
}

try {
  execSync('git tag -a ' + tag + ' -m "' + message + '"', { stdio: 'inherit' })
} catch {
  console.error('tag 创建失败（可能已存在）')
  process.exit(1)
}
try {
  execSync('git push origin ' + tag, { stdio: 'inherit' })
  console.log('')
  console.log('tag ' + tag + ' 已推送，GitHub Actions 将自动构建并发布 Release。')
  console.log('查看: https://github.com/<owner>/<repo>/actions')
} catch {
  console.error('tag 已创建但推送失败：git push origin ' + tag)
  process.exit(1)
}
