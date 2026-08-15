/**
 * 核心层冒烟测试：不依赖 Electron，直接驱动全部核心模块。
 * 运行：pnpm core:smoke
 * 注意：备份目标通过 DSHM_MANAGER_DIR 指向工作区 .tmp，避免污染真实管理器目录。
 */
import { resolve, join } from 'node:path'
import { mkdirSync, existsSync as existsSync2, readFileSync } from 'node:fs'
import { detectEnvironment } from './detect.ts'
import { scanHome } from './home.ts'
import { listProfiles, readAllProfiles } from './profiles.ts'
import { checkUpdates } from './updates.ts'
import { runHealthChecks } from './health.ts'
import { backupHome, listBackups, restorePreview } from './backup.ts'
import { listSessions, decodeSession, sessionStats, exportSession, sessionsRoot } from './sessions.ts'
import { saveInstance, startInstance, instanceStatus, instanceLog, stopInstance, removeInstance, listInstances } from './instances.ts'
import { listConfigFiles, readConfigFile, validateYaml } from './config-editor.ts'
import { repairActions, executeRepair } from './repair.ts'
import { installService, uninstallService, serviceStatus } from './service.ts'
import { searchMarketplace } from './marketplace.ts'
import { copyFileSync, writeFileSync, statSync, mkdirSync as fsMkdirSync } from 'node:fs'

const tmp = resolve(process.cwd(), '.tmp', 'manager')
mkdirSync(tmp, { recursive: true })
process.env.DSHM_MANAGER_DIR = tmp

async function main(): Promise<void> {
  console.log('=== 1. 环境检测 ===')
  const env = await detectEnvironment()
  console.log(JSON.stringify(env, null, 2).slice(0, 2200))

  console.log()
  console.log('=== 2. DSH_HOME 扫描 ===')
  const scan = await scanHome()
  console.log('home:', scan.homePath, '| 总大小:', (scan.totalBytes / 1024 / 1024).toFixed(1), 'MB')
  console.log('顶层条目:', scan.entries.map((e) => e.name + '(' + e.kind + ', ' + e.itemCount + ')').join(', '))
  console.log('会话:', JSON.stringify(scan.sessions))
  console.log('最大文件:', scan.largest.slice(0, 4).map((f) => f.path + ' ' + (f.bytes / 1024).toFixed(0) + 'KB').join(' | '))

  console.log()
  console.log('=== 3. Profiles / 插件 ===')
  const profiles = listProfiles()
  console.log('profiles:', profiles.join(', '))
  const all = readAllProfiles()
  for (const p of all) {
    console.log('profile ' + p.name + ': bundles=' + (p.bundles.join(', ') || '(空)'))
    for (const pl of p.plugins) {
      console.log('  [' + pl.kind + '] ' + pl.name + '@' + (pl.version ?? '?') + ' 入栈=' + pl.inBundlesList + ' 已装=' + pl.installed)
    }
  }

  console.log()
  console.log('=== 4. 更新检查（网络） ===')
  try {
    const report = await checkUpdates({ dsh: env.dsh.version, pythonSdk: null })
    for (const c of report.channels) {
      console.log(c.id + ': local=' + (c.local ?? '-') + ' latest=' + (c.latest ?? 'ERR') + ' state=' + c.state + (c.error ? ' ' + c.error : ''))
    }
  } catch (error) {
    console.log('更新检查失败（网络受限？）:', String(error))
  }

  console.log()
  console.log('=== 5. 健康检查 ===')
  const checks = await runHealthChecks()
  for (const c of checks) {
    console.log('[' + c.status.padEnd(5) + '] ' + c.group + '/' + c.title + ': ' + c.detail + (c.fixHint ? ' => ' + c.fixHint : ''))
  }

  console.log()
  console.log('=== 6. 备份（到工作区 .tmp） ===')
  if (env.home.exists) {
    const backup = await backupHome({ note: 'smoke' })
    console.log('备份目录:', backup.dir)
    console.log('manifest:', JSON.stringify(backup.manifest, null, 1).slice(0, 500))
    console.log('已有备份:', listBackups().length)
    const preview = await restorePreview(backup.dir)
    console.log('恢复预览: toAdd=', preview.toAdd.length, 'toOverwrite=', preview.toOverwrite.length, 'toDelete=', preview.toDelete.length, 'unchanged=', preview.unchanged)
  } else {
    console.log('（无 DSH_HOME，跳过备份测试——CI 场景）')
  }

  console.log()
  console.log('=== 7. 会话日志解码 ===')
  const allSessions = listSessions()
  console.log('会话总数:', allSessions.length, '| 根目录:', sessionsRoot())
  const target = allSessions.find((s) => s.logFile && s.workspacePath && s.workspacePath.includes('dsh-manager')) ?? allSessions.find((s) => s.logFile)
  if (target && target.logFile) {
    console.log('目标会话:', target.id.slice(0, 8), '| 工作区:', target.workspacePath, '|', (target.bytes / 1024).toFixed(0) + 'KB')
    const decoded = await decodeSession(target.logFile, { maxEvents: 300 })
    const stats = sessionStats(decoded.events)
    console.log('帧数:', decoded.frames, '| 总事件:', decoded.totalLines, '| torn:', decoded.torn, '| 截断:', decoded.truncated)
    console.log('header:', JSON.stringify(decoded.header).slice(0, 200))
    console.log('统计: 消息', stats.messages, '| 工具调用', stats.toolCalls, '| 类型数', Object.keys(stats.byType).length)
    const md = await exportSession(target.logFile, 'markdown')
    console.log('Markdown 导出:', md.fileName, md.content.length + ' 字符, 前 200:', md.content.slice(0, 200).replace(/\n/g, ' | '))
  } else {
    console.log('（无会话可解码）')
  }

  console.log()
  console.log('=== 8. 实例生命周期（node 伪实例） ===')
  const testId = 'smoke-' + Date.now().toString(36)
  saveInstance({
    id: testId,
    name: 'smoke-test',
    profile: 'test',
    command: 'node',
    extraArgs: ['-e', 'console.log("smoke instance up"); setInterval(()=>{}, 1000)'],
    autoStart: false,
    createdAt: Date.now(),
  })
  const started = await startInstance(testId)
  console.log('启动:', JSON.stringify(started))
  await new Promise((r) => setTimeout(r, 1500))
  const st = await instanceStatus(testId)
  console.log('状态: running=', st?.running, 'pid=', st?.pid, 'logBytes=', st?.logBytes)
  console.log('日志:', instanceLog(testId).split('\n')[0])
  const stopped = await stopInstance(testId)
  console.log('停止:', JSON.stringify(stopped))
  const st2 = await instanceStatus(testId)
  console.log('停止后 running=', st2?.running)
  removeInstance(testId)
  console.log('已删除测试实例')

  console.log()
  console.log('=== 9. 配置面 ===')
  const configFiles = listConfigFiles()
  for (const f of configFiles) {
    console.log('[' + f.kind + '] ' + f.label + (f.exists ? '' : ' (不存在)'))
  }
  const settings = readConfigFile('settings')
  console.log('settings.yaml 读取:', settings.ok ? 'OK ' + (settings.content?.length ?? 0) + ' 字符' : settings.error)
  const yaml = validateYaml(settings.ok ? (settings.content ?? '') : '')
  console.log('settings.yaml 校验:', yaml.ok ? '✓' : '✗ ' + yaml.error)
  const creds = readConfigFile('credentials')
  console.log('credentials 掩码读取:', creds.ok ? 'OK ' + (creds.content?.length ?? 0) + ' 字符, 含***=' + String(creds.content?.includes('***') ?? false) : creds.error)

  console.log()
  console.log('=== 10. 修复动作库 ===')
  console.log('动作清单:', repairActions().map((a) => a.id).join(', '))
  // 10a. 权限修复（对真实 home 预期沙箱受限，但应优雅报告）
  const perms = await executeRepair('fix-permissions')
  console.log('fix-permissions:', perms.ok ? 'OK' : '受限/失败', '|', perms.message, '| 日志:', perms.log.slice(0, 3).join(' ; '))
  // 10b. YAML 从 .bak 还原
  const restoreDir = join(tmp, 'restore-test')
  fsMkdirSync(restoreDir, { recursive: true })
  writeFileSync(join(restoreDir, 'settings.yaml'), 'broken: [', 'utf8')
  writeFileSync(join(restoreDir, 'settings.yaml.bak-20260815000000'), 'good: 1', 'utf8')
  const restore = await executeRepair('restore-yaml-from-bak', { path: join(restoreDir, 'settings.yaml') })
  console.log('restore-yaml:', restore.ok, '|', restore.message, '| 内容:', readFileSync(join(restoreDir, 'settings.yaml'), 'utf8'))
  // 10c. 会话日志截断修复（复制真实日志 + 追加垃圾字节）
  if (target && target.logFile) {
    const logCopy = join(tmp, 'session-copy.zstd')
    copyFileSync(target.logFile, logCopy)
    const origSize = statSync(logCopy).size
    writeFileSync(logCopy, Buffer.concat([readFileSync(logCopy), Buffer.from('GARBAGE_NOT_A_FRAME')]))
    const repair = await executeRepair('repair-session-log', { path: logCopy })
    const afterSize = statSync(logCopy).size
    console.log('repair-session-log:', repair.ok, '|', repair.message, '| 尺寸', origSize, '→', afterSize, '| 还原校验:', afterSize === origSize ? '✓ 恢复完整' : '✗ 尺寸不符')
    const reDecoded = await decodeSession(logCopy, { maxEvents: 5 })
    console.log('修复后可解码:', reDecoded.frames + ' 帧', '| header:', reDecoded.header ? reDecoded.header.id.slice(0, 8) : '无')
  }
  // 10d. allowBuilds 注入（临时 home）
  const fakeHome = join(tmp, 'fake-home')
  const fakeProfile = join(fakeHome, 'profiles', 'fake')
  fsMkdirSync(fakeProfile, { recursive: true })
  writeFileSync(join(fakeProfile, 'pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n', 'utf8')
  const ab = await executeRepair('add-allowbuilds', { profile: 'fake', package: 'my-plugin' }, { ...process.env, DSH_HOME: fakeHome })
  console.log('add-allowbuilds:', ab.ok, '|', ab.message, '| 内容:', readFileSync(join(fakeProfile, 'pnpm-workspace.yaml'), 'utf8').replace(/\n/g, ' '))

  console.log()
  console.log('=== 11. 系统服务（DSHM_SERVICE_DIR 覆盖） ===')
  process.env.DSHM_SERVICE_DIR = join(tmp, 'services')
  const svcId = 'svc-' + Date.now().toString(36)
  saveInstance({
    id: svcId,
    name: 'service-smoke',
    profile: 'web',
    port: 3999,
    dshHome: undefined,
    autoStart: false,
    createdAt: Date.now(),
  })
  const svcConfig = listInstances().find((i) => i.id === svcId)!
  const installed = await installService(svcConfig)
  console.log('安装:', installed.ok, '|', installed.message, '| 单元:', installed.unitPath)
  const svcSt1 = await serviceStatus(svcConfig)
  console.log('状态: installed=', svcSt1.installed, 'active=', svcSt1.active, '|', svcSt1.detail, '| 路径存在:', existsSync2(svcSt1.unitPath))
  const uninst = await uninstallService(svcId)
  console.log('卸载:', uninst.ok, '|', uninst.message)
  const svcSt2 = await serviceStatus(svcConfig)
  console.log('卸载后 installed=', svcSt2.installed)
  removeInstance(svcId)

  console.log()
  console.log('=== 12. 插件市场 ===')
  try {
    const market = await searchMarketplace()
    console.log('条目:', market.entries.length, '| 来自缓存:', market.cached, '| 错误:', market.errors.length)
    for (const e of market.entries.slice(0, 8)) {
      console.log('[' + e.source + '] ' + e.name + (e.version ? ' v' + e.version : '') + ' | ' + (e.description ? e.description.slice(0, 50) : '') + (e.dshBundlePatch ? ' | dsh-bundle' : ''))
    }
  } catch (error) {
    console.log('市场检索失败:', String(error))
  }

  console.log()
  console.log('SMOKE OK')
}

main().catch((error) => {
  console.error('SMOKE FAILED:', error)
  process.exit(1)
})
