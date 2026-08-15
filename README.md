<div align="center">

# DSH Manager

**DeepSeek Harness 独立管理器** —— 健康检查与一键修复 · 插件管理 · 更新检查 · 备份恢复 · 实例托管与服务化

跨平台桌面应用（macOS / Windows / Linux），与 dsh 官方 Web UI（会话内）互补，专注**机器级**管理：安装、健康、修复、插件、更新、备份、进程与服务。

![GitHub release](https://img.shields.io/github/v/release/SherlockGougou/dsh-manager)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![license](https://img.shields.io/github/license/SherlockGougou/dsh-manager)

[English](README.en.md) · [发布页](https://github.com/SherlockGougou/dsh-manager/releases) · [讨论](https://github.com/SherlockGougou/dsh-manager/discussions)

</div>

---

## ✨ 功能全景

| 模块 | 能力 |
|---|---|
| **仪表盘** | 环境快照（Node/pnpm/dsh 版本与安装形态）、DSH_HOME 数据总览、Web 实例探测 |
| **实例管理** | 多实例托管：启动/停止/重启（SIGTERM 优雅退出）、PID 接管（重启后回收孤儿进程）、日志采集轮转、端口探测、一键打开 Web UI |
| **系统服务化** | 实例安装为 launchd（macOS）/ systemd（Linux）/ 启动项（Windows），开机自启 + 崩溃重启，独立于管理器进程 |
| **健康检查与修复** | 16+ 项诊断 + 6 个一键修复动作（权限收紧 / .bak 还原 / pnpm 重装 / 会话日志截断 / 缓存清理 / allowBuilds 注入），破坏性操作执行前自动备份 |
| **插件管理** | profile bundle 栈可视化、插件分类（内置/出树/普通/孤儿）、`dsh plugin` 命令转发（保留官方 reconcile 语义）、`--dump-config` 配置树导出 |
| **插件市场** | GitHub topic:dsh-plugin + npm 关键字双渠道检索、dsh bundle 元数据标注、一键安装到 profile（缓存防 API 限额） |
| **会话日志** | 工作区/会话列表、原生 zstd 多帧解码（node:zlib 零依赖，含 torn-tail 检测）、事件统计、导出 JSONL / 可读 Markdown |
| **配置编辑器** | settings.yaml / .credentials.yaml（掩码）/ 补丁文件；YAML 校验 + `dsh --patch --dump-config` 全链路校验；写前 `.bak` 快照 + 原子写 + LCS diff |
| **检查更新** | npm + PyPI 双渠道直连 registry；应用自身更新（electron-updater + GitHub Releases，下载进度 / 一键安装）；安装包直链 |
| **备份与恢复** | DSH_HOME 全量备份（默认排除凭据/node_modules）、manifest、恢复 dry-run 预览、恢复前自动转移现状文件、保留策略 |
| **外观** | 浅色/深色/跟随系统主题（系统主题实时联动）；无边框纯净窗口（macOS 原生红绿灯 + Win/Linux 自绘控件） |

## 📸 界面预览

> 截图为占位图，将随版本更新替换为真实界面。

| 仪表盘 | 实例管理 |
|---|---|
| ![仪表盘](docs/screenshots/dashboard.png) | ![实例管理](docs/screenshots/instances.png) |

| 健康检查与修复 | 插件管理 |
|---|---|
| ![健康检查与修复](docs/screenshots/health.png) | ![插件管理](docs/screenshots/plugins.png) |

| 插件市场 | 会话日志 |
|---|---|
| ![插件市场](docs/screenshots/market.png) | ![会话日志](docs/screenshots/sessions.png) |

| 配置编辑器 | 更新 |
|---|---|
| ![配置编辑器](docs/screenshots/config.png) | ![更新](docs/screenshots/updates.png) |

| 备份与恢复 | 设置 |
|---|---|
| ![备份与恢复](docs/screenshots/backup.png) | ![设置](docs/screenshots/settings.png) |

| 主题切换（深/浅） |
|---|
| ![主题切换](docs/screenshots/theme.png) |

## 🚀 安装与使用

从 [Releases](https://github.com/SherlockGougou/dsh-manager/releases) 下载对应平台安装包：

| 平台 | 安装包 | 说明 |
|---|---|---|
| macOS | `DSH-Manager-<ver>-arm64.dmg` / `-x64.dmg` | 拖入 Applications；Apple Silicon / Intel |
| Windows | `DSH-Manager-Setup-<ver>.exe` | NSIS 安装器，可自定义安装目录 |
| Linux | `.AppImage` / `.deb` | AppImage 直接运行；deb 支持 amd64 + arm64 |

应用内置更新检查（设置页可关闭）：发布新版本后，更新页会提示并支持一键下载安装。

## ⚡ 开发者快速开始

```sh
pnpm install          # 依赖（项目内 .npmrc 已将 pnpm store 指向工作区）
pnpm dev              # 开发模式（electron-vite 热更新）
pnpm core:smoke       # 核心层冒烟测试（不启动 GUI，直接驱动全部核心模块）
pnpm typecheck        # 类型检查（node + web 双配置）
pnpm build            # 构建到 out/
```

环境要求：Node ≥ 22.19（推荐 24+）、pnpm 10（corepack）。

## 🧭 使用指南

- **首次使用**：先到「更新」页检查 dsh 安装，或直接运行 `dsh web` 初始化 DSH_HOME；再到「备份」页创建第一个备份。
- **托管实例**：「实例」页新建实例（选择 profile、端口、工作目录），可安装为系统服务实现开机自启。
- **插件**：「插件市场」发现 → 「插件管理」确认 bundle 栈与 allowBuilds → 安装后可用 `--dump-config` 验证配置树。
- **修复**：「健康检查」页每个异常项带一键修复；破坏性操作自动备份到 `~/.dsh-manager/repair-backups/`。
- **会话**：「会话日志」页可解码查看任意会话（含 torn-tail 检测），导出 Markdown/JSONL。
- **配置**：「配置」页编辑补丁/设置/凭据（掩码），保存前自动 `.bak` + 原子写，profile 补丁走 dsh 全链路校验。

## 📁 项目结构

```
src/
├── core/          # 框架无关核心层（纯 Node，未来 Tauri sidecar 直接复用）
│   ├── detect.ts        # 环境检测：node/pnpm/dsh 形态、DSH_HOME 解析、端口探测
│   ├── home.ts          # DSH_HOME 扫描与统计（只读）
│   ├── profiles.ts      # profile/插件清单、dsh plugin 转发、dump-config
│   ├── updates.ts       # npm/PyPI/GitHub 更新检查（HTTP 直连）
│   ├── health.ts        # 诊断项集合（状态 + 证据 + 修复提示 + 修复动作关联）
│   ├── repair.ts        # 修复动作库（权限/YAML 还原/pnpm 重装/日志截断/清理/allowBuilds）
│   ├── backup.ts        # 备份/恢复/预览/保留清理
│   ├── zstd.ts          # zstd 帧扫描/解码（node:zlib，与 dsh 容器格式一致）
│   ├── sessions.ts      # 会话列表/解码/统计/导出（JSONL + Markdown）
│   ├── instances.ts     # 实例注册表 + 生命周期 + 日志轮转
│   ├── service.ts       # launchd/systemd/启动项 服务化
│   ├── marketplace.ts   # 插件市场检索（GitHub topic + npm 关键字 + 缓存）
│   ├── config-editor.ts # 配置文件编辑（掩码/校验/原子写/diff）
│   ├── manager-config.ts# 管理器自身配置（~/.dsh-manager，DSHM_MANAGER_DIR 可覆盖）
│   └── types.ts         # 共享类型
├── main/           # Electron 主进程（窗口、IPC、主题、更新器、实例自动拉起）
├── preload/        # contextBridge（window.dshm，统一 {ok,data|error} 协议 + 事件订阅）
└── renderer/       # React 渲染层（10 个页面 + 双主题 + 无边框窗口）
```

## 🏗 架构决策

1. **核心层框架无关**：`src/core` 不 import electron，可被 `tsx` 直接驱动（`pnpm core:smoke`）；未来迁移 Tauri 时整体打包为 sidecar 复用，渲染层 IPC 调用面不变。
2. **不重复造轮子**：插件操作转发官方 `dsh plugin`；配置校验用 `--dump-config`；会话解码用 node:zlib 原生 zstd；服务化用系统原生机制（launchd/systemd）。
3. **安全边界**：核心层对 DSH_HOME 默认只读；所有写操作（备份/修复/配置保存）先快照；凭据类文件默认排除出备份、UI 掩码显示；渲染层无 nodeIntegration。
4. **诊断依据**：会话日志格式、DSH_HOME 布局、profile 语义均来自 [deepseek-harness 源码分析](docs/dsh-manager-analysis.md)。

## 📦 构建与发布

```sh
pnpm dist:mac    # macOS: dmg + zip（arm64 + x64）
pnpm dist:win    # Windows: NSIS（x64）
pnpm dist:linux  # Linux: AppImage + deb（x64 + arm64）
pnpm dist:dir    # 仅解包目录（快速验证）
```

推送 `v*` tag 自动触发 [CI](.github/workflows/release.yml) 三平台构建并发布到 GitHub Releases：

```sh
pnpm bump 0.2.0 && git add -A && git commit -m "chore: bump"
git push
pnpm release:check && pnpm release:tag   # 创建并推送 tag，CI 自动打包发布
```

## ❓ 常见问题

- **插件安装失败（allowBuilds）**：pnpm ≥10 默认拦截插件构建脚本。在「健康检查 → 修复动作库」执行 `add-allowbuilds`，或手动在 profile 的 `pnpm-workspace.yaml` 加入 `allowBuilds: { <包名>: true }`。
- **DMG 构建失败（hdiutil 操作不被允许）**：受限沙箱环境（如 CI 沙箱）无法创建磁盘镜像；普通终端直接运行 `pnpm dist:mac` 即可。
- **pnpm store-dir 被系统配置重定向**：本项目 `.npmrc` 已固定 store 到工作区 `.pnpm-store`。
- **应用内更新不生效**：自动更新仅对打包安装版生效（开发模式显示安装包链接）；确认 `DSHM_GH_REPO` 或 package.json `repository` 指向正确仓库。
- **dsh 实例无法启动**：先到「健康检查」页确认 Node/pnpm/dsh 版本与 profile bundle 一致性，再点对应「一键修复」。

## 🗺 Roadmap

- 定时任务（备份/巡检/更新检查）
- 密钥扫描与权限审计
- 会话日志全文搜索
- 代码签名接入（Apple Developer / Windows）
- 自动更新与发布流水线完善（变更日志生成）

## 📄 许可证

[MIT](LICENSE) © dsh-manager contributors

DSH Manager 是独立项目，与 DeepSeek AI 无关；DeepSeek Harness 为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的开源项目。

