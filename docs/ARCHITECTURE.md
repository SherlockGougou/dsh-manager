# DSH Manager 架构

## 分层

```
┌─────────────────────────────────────────────┐
│ React 渲染层 (src/renderer)                  │  9 页：仪表盘/实例/健康/插件/会话/配置/更新/备份/设置
│  window.dshm.invoke(channel, payload)        │
├─────────────────────────────────────────────┤
│ Preload (src/preload)                        │  contextBridge，统一 {ok,data}|{ok:false,error}
├─────────────────────────────────────────────┤
│ Electron 主进程 (src/main)                   │  窗口/生命周期/IPC 注册表 (src/main/ipc.ts)
├─────────────────────────────────────────────┤
│ 核心层 (src/core)  ← 框架无关纯 Node          │  全部管理逻辑；无 electron 依赖
│  detect / home / profiles / updates /        │
│  health / repair / backup / zstd /              │
│  sessions / instances / service /                │
│  config-editor / manager-config / types          │
└─────────────────────────────────────────────┘
```

**核心层约束**：不 import electron；只依赖 node 内建 + js-yaml；所有函数可被 `tsx` 直接驱动（`pnpm core:smoke`）。这一约束保证未来迁移 Tauri 时核心层可原样打包为 sidecar。

## 数据流

1. 渲染层调用 `api.*`（src/renderer/src/api.ts，类型化包装）
2. IPC handler 捕获异常 → `{ok:false,error}`（不泄漏堆栈）
3. 核心层直接读写文件系统 / 执行外部命令（`dsh`、`pnpm`、`node`）

## 关键设计

### IPC 协议
所有通道返回 `{ ok: true, data: T }` 或 `{ ok: false, error: string }`，由 `register()` 统一包装。

### 命令执行（exec.ts）
`spawn` 无 shell 拼接、超时强杀、1MB 输出截断、结构化返回。绝不使用 `exec` 字符串拼接。

### 备份一致性
- 默认排除：`.DS_Store`、`node_modules`、`.credentials.yaml`、`.env`、`cache`
- 运行中备份允许 torn-tail（dsh 自身可恢复），manifest 记录选项
- 恢复：dry-run 预览 → 现状文件先转移至 `restore-trash` → 再覆盖/删除

### 更新检查
直连 `registry.npmjs.org` / `pypi.org`（HTTP + AbortSignal 超时），不依赖 npm CLI 缓存（本机实测 npm 缓存损坏会 EPERM）。

### 版本语义
`normalizeVersion` 统一 `0.1.0rc6`（PyPI）与 `0.1.0-rc.6`（npm）为 `0.1.0-rc.6`；`compareVersions` 支持 rc 预发布比较。

## 未来迁移（Tauri）

1. `src/core` 用 esbuild 打成单文件 CJS/ESM → Tauri sidecar
2. Rust 命令面：`invoke` 透传 JSON → sidecar stdio JSON-RPC
3. 渲染层 `api.ts` 改为条件分支（Tauri 下用 `@tauri-apps/api` invoke，通道名不变）
4. 进程管理/钥匙串/原生对话框逐步下沉 Rust

## 测试策略

| 层 | 方式 |
|---|---|
| 核心层 | `pnpm core:smoke`（真实环境检测/扫描/备份，网络更新检查可失败降级） |
| 类型 | `pnpm typecheck`（node/web 双 tsconfig） |
| 构建 | `pnpm build`（electron-vite 三段构建） |
| E2E | 后续：Playwright + Electron（`_electron.launch`） |



## 修复动作库（repair.ts）

诊断 → 确认 → 备份 → 执行 → 报告。所有破坏性操作先复制到 `<managerDir>/repair-backups/<ts>/`。
- fix-permissions：只收紧不放开（600/700），单项失败不中断
- restore-yaml-from-bak：取最近 `.bak-<ts>` 还原，当前文件先备份
- pnpm-install-profile：profile 目录内 pnpm install（修复 node_modules/symlink/bundle 缺失）
- repair-session-log：容错帧扫描定位最后一个完整 zstd 帧，截断修复（与 dsh 自身恢复语义一致）
- clean-cache：清空 cache/ 与多余 .bak-*（保留 3 份），删除前移入备份区
- add-allowbuilds：把包注入 profile 的 pnpm-workspace.yaml allowBuilds（pnpm>=10 官方修复路径）

## 系统服务化（service.ts）

实例可安装为系统服务，独立于管理器进程（管理器退出仍运行）：
- macOS：launchd LaunchAgent（KeepAlive=true，崩溃自动拉起），launchctl load -w
- Linux：systemd user unit（Restart=always），systemctl --user enable --now
- Windows：启动文件夹 .cmd（下次登录自动启动）
- 单元文件用 dsh 绝对路径（realpath 解析）；DSHM_SERVICE_DIR 可覆盖目标目录（测试用）

