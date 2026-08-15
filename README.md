# DSH Manager

**DeepSeek Harness 独立管理器**（跨平台桌面应用）——管理 dsh 的安装、健康、插件、更新与数据备份，与官方 Web UI（会话内）互补，聚焦"机器级"管理。

> 分析依据：`docs/dsh-manager-analysis.md`（deepseek-harness 源码 + 真实 `~/.dsh` 数据目录核查）

## 功能

| 模块 | 能力 |
|---|---|
| 仪表盘 | 环境快照（Node/pnpm/dsh 版本与形态）、DSH_HOME 数据总览、Web 实例探测（:3080） |
| 实例管理 | dsh 实例托管：启动/停止/重启（SIGTERM 优雅 5s）、PID 接管、日志采集轮转、端口探测、一键打开 Web UI |
| 健康检查与修复 | 16+ 项诊断 + **一键修复**（权限收紧 / .bak 还原 / pnpm 重装 / 会话日志截断 / 缓存清理 / allowBuilds 注入），破坏性操作执行前自动备份 |
| 插件市场 | GitHub topic:dsh-plugin + npm 关键字双渠道检索（缓存 10 分钟防 API 限额）、dsh bundle 元数据标注、一键安装到 profile（走官方 dsh plugin add） |
| 插件管理 | profile bundle 栈可视化、插件分类（内置/出树/普通/孤儿）、`dsh plugin` 命令转发、`--dump-config` 配置树导出 |
| 会话日志 | 工作区/会话列表、原生 zstd 多帧解码（node:zlib，零依赖，含 torn-tail 检测）、事件统计、导出 JSONL / 可读 Markdown |
| 配置编辑器 | settings.yaml / .credentials.yaml（掩码）/ 补丁文件；YAML 校验 + `dsh --patch --dump-config` 全链路校验；写前 `.bak` 快照 + 原子写 + LCS diff |
| 检查更新 | npm（`@deepseek-ai/dsh` dist-tags）+ PyPI（`deepseek-harness-sdk`）双渠道直连 registry |
| 备份与恢复 | DSH_HOME 全量备份（默认排除凭据/node_modules）、manifest、恢复 dry-run 预览、恢复前自动转移现状文件 |
| **系统服务化** | 实例安装为 launchd LaunchAgent（macOS）/ systemd user unit（Linux）/ 启动项（Windows），开机自启 + 崩溃重启，独立于管理器进程 |
| 设置 | 备份保留策略、启动自检更新、退出时停止实例、管理器路径 |

## 快速开始

```sh
pnpm install          # 依赖（项目内 .npmrc 已将 pnpm store 指向工作区）
pnpm dev              # 开发模式（electron-vite，热更新）
pnpm build            # 构建到 out/
pnpm start            # 运行构建产物
pnpm core:smoke       # 核心层冒烟测试（不启动 GUI，直接驱动全部核心模块）
pnpm typecheck        # 类型检查（node + web 双配置）
```

## 项目结构

```
src/
├── core/          # 框架无关核心层（纯 Node，未来 Tauri sidecar 直接复用）
│   ├── detect.ts        # 环境检测：node/pnpm/dsh 形态、DSH_HOME 解析、端口探测
│   ├── home.ts          # DSH_HOME 扫描与统计（只读）
│   ├── profiles.ts      # profile/插件清单、dsh plugin 转发、dump-config
│   ├── updates.ts       # npm/PyPI registry 更新检查（HTTP 直连）
│   ├── health.ts        # 诊断项集合（状态 + 证据 + 修复提示 + 修复动作关联）
│   ├── repair.ts        # 修复动作库（权限/YAML 还原/pnpm 重装/日志截断/清理/allowBuilds）
│   ├── backup.ts        # 备份/恢复/预览/保留清理
│   ├── zstd.ts          # zstd 帧扫描/解码（node:zlib，与 dsh 容器格式一致）
│   ├── sessions.ts      # 会话列表/解码/统计/导出（JSONL + Markdown）
│   ├── instances.ts     # 实例注册表 + 生命周期 + 日志轮转
│   ├── service.ts       # launchd/systemd/启动项 服务化（单元文件生成 + 注册）
│   ├── config-editor.ts # 配置文件编辑（掩码/校验/原子写/diff）
│   ├── marketplace.ts   # 插件市场检索（GitHub topic + npm 关键字 + 缓存）
│   ├── manager-config.ts# 管理器自身配置（~/.dsh-manager，DSHM_MANAGER_DIR 可覆盖）
│   └── types.ts         # 共享类型
├── main/           # Electron 主进程（窗口、IPC 注册、实例自动拉起/退出停止）
├── preload/        # contextBridge（window.dshm，统一 {ok,data|error} 协议）
└── renderer/       # React 渲染层（9 个页面 + 暗色主题）
```

## 架构决策

1. **Electron（骨架期）**：本机无 Rust 工具链，Electron 纯 Node 栈即刻可跑；核心层与前端均可平移到 Tauri。
2. **迁移 Tauri 路径**：`src/core` 为框架无关纯 Node 模块 → 打包为 Tauri sidecar（Node 单文件）→ Rust 壳负责进程管理/钥匙串/文件操作 → 渲染层 IPC 调用面不变（`window.dshm` 协议保持）。
3. **安全边界**：核心层对 DSH_HOME 默认只读；所有写操作（备份恢复、插件命令、配置保存、修复动作）先快照；凭据类文件默认排除出备份、UI 掩码显示；渲染层无 nodeIntegration。
4. **不重复造轮子**：插件操作转发官方 `dsh plugin`；配置校验用 `--dump-config`；会话解码用 node:zlib 原生 zstd；服务化用系统原生机制（launchd/systemd）。

## 环境变量

| 变量 | 用途 |
|---|---|
| `DSHM_MANAGER_DIR` | 管理器自身数据目录（默认 `~/.dsh-manager`） |
| `DSHM_SERVICE_DIR` | 系统服务单元目录覆盖（测试/沙箱） |
| `DSH_HOME` | 被管理的 dsh 数据目录（与 dsh 语义一致） |

## Roadmap

- **P1 剩余**：配置热重载观察、定时任务（备份/巡检/更新检查）、插件市场浏览
- **P2**：密钥扫描与权限审计、多 DSH_HOME 迁移、Tauri 迁移、安装包分发（electron-builder）

## 已知环境适配

- 本机 pnpm store-dir 被 hvigor 全局配置重定向 → 项目内 `.npmrc` 覆盖为 `.pnpm-store`
- Electron 二进制下载受沙箱影响
- DMG 构建依赖 hdiutil


## 发布到 GitHub Releases（CI 自动构建）

推送 `v*` tag 即触发 `.github/workflows/release.yml`：

| 平台 | 产物 | 运行器 |
|---|---|---|
| macOS | dmg + zip（arm64 + x64） | macos-latest |
| Windows | NSIS 安装器（x64） | windows-latest |
| Linux | AppImage + deb（x64） | ubuntu-latest |

### 发布流程（三步）

```sh
pnpm bump 0.2.0          # 1. 提升版本（--dry-run 预览）
git add -A && git commit -m "chore: bump to v0.2.0"
git push                  # 2. 推送代码
pnpm release:check        # 3a. 发布前检查（git 干净/tag 未占用/dist 无陈旧产物）
pnpm release:tag          # 3b. 创建并推送 v0.2.0 tag（--dry-run 预览）
                          #     GitHub Actions 自动构建三平台产物并发布 Release
```

### 说明

- `electron-builder.yml` 已配置 `publish: github`（owner/repo 从 git remote 自动识别，CI 用内置 `GITHUB_TOKEN`）
- CI 中 `CSC_IDENTITY_AUTO_DISCOVERY=false` 跳过代码签名；正式分发前接入开发者证书（macOS `CSC_LINK` / Windows `WIN_CSC_LINK`）
- 版本含 `-rc.N` 时 electron-builder 自动标记为 prerelease
- 发布说明自动生成（两次 tag 之间的 git log）
- 本地手动构建用 `pnpm dist:mac` 等（加 `--publish never` 不上传）
（磁盘镜像挂载），在受限沙箱中会失败（"操作不被允许"）；普通终端直接运行 pnpm dist:mac 即可生成 dmg + zip → 用 `HOME` 覆盖或设置 `ELECTRON_CACHE` 指向工作区

## 安装包分发（electron-builder）

```sh
pnpm dist            # 当前平台默认目标
pnpm dist:mac        # macOS：dmg + zip（arm64 + x64）
pnpm dist:win        # Windows：NSIS 安装器（x64；需 Windows 或 wine）
pnpm dist:linux      # Linux：AppImage + deb（x64 + arm64）
pnpm dist:dir        # 仅解包目录（快速验证）
```

- 配置：`electron-builder.yml`（appId `com.dshmanager.app`、asar、无原生依赖）
- 图标：`build/icon.png`（512×512，`pnpm icon` 重新生成；各平台图标由 builder 自动转换）
- 签名：当前 `mac.identity: null` 跳过 codesign（分发前接入 Apple Developer 证书后删除该行；Windows 同理配 `win.csc`）
- 产物输出到 `dist/`；DMG 含 Applications 快捷链接
- 沙箱环境构建时用 `HOME` 覆盖，避免 electron-builder 缓存写入被拦截


