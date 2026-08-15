#!/usr/bin/env node
/**
 * 发布前检查：node scripts/check-release-ready.mjs
 * 检查项：git 仓库与干净状态、版本号格式、tag 未占用、dist 无陈旧产物、node/pnpm 可用。
 * 任一失败退出码非 0。
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fail = (msg) => {
  console.error('✗ ' + msg)
  return false
}
const pass = (msg) => {
  console.log('✓ ' + msg)
  return true
}

let ok = true

// 1. git 仓库
try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' })
  pass('git 仓库存在')
} catch {
  ok = fail('不是 git 仓库：git init 并推送到 GitHub 后重试')
}

// 2. git 状态干净
if (ok) {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
    if (status) {
      ok = fail('工作区有未提交变更：\n' + status.split('\n').slice(0, 8).join('\n'))
    } else {
      pass('工作区干净')
    }
  } catch {
    ok = fail('无法读取 git 状态')
  }
}

// 3. 版本格式
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
if (!/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(String(version))) {
  ok = fail('版本号格式不合法: ' + version + '（应为 x.y.z 或 x.y.z-rc.N）')
} else {
  pass('版本号: ' + version)
}

// 4. tag 未占用
if (ok) {
  const tag = 'v' + version
  try {
    const tags = execSync('git tag --list "' + tag + '"', { encoding: 'utf8' }).trim()
    if (tags) ok = fail('tag ' + tag + ' 已存在（先删除或提升版本）')
    else pass('tag ' + tag + ' 可用')
  } catch {
    ok = fail('无法查询 git tag')
  }
}

// 5. dist 无陈旧产物
const dist = join(root, 'dist')
if (existsSync(dist)) {
  try {
    const files = execSync('ls -A "' + dist + '"', { encoding: 'utf8' }).trim()
    if (files) ok = fail('dist/ 存在旧产物（CI 会重新生成；如需本地构建请先清空）')
    else pass('dist/ 为空')
  } catch {
    ok = fail('dist/ 读取失败')
  }
} else {
  pass('dist/ 不存在（干净）')
}

// 6. 工具链
try {
  execSync('node --version', { stdio: 'pipe' })
  pass('node 可用')
} catch {
  ok = fail('node 不可用')
}
try {
  execSync('pnpm --version', { stdio: 'pipe' })
  pass('pnpm 可用')
} catch {
  ok = fail('pnpm 不可用（corepack enable 或 npm i -g pnpm）')
}

if (ok) {
  console.log('')
  console.log('全部检查通过。发布流程：')
  console.log('  1. git push（含 package.json 版本变更）')
  console.log('  2. pnpm release:tag   （创建并推送 v' + version + ' tag）')
  console.log('  3. GitHub Actions 自动构建并发布 Release（macOS/Windows/Linux）')
} else {
  console.log('')
  console.log('存在未通过项，修复后重试。')
  process.exit(1)
}
