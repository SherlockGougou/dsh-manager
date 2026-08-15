# dsh-manager：DeepSeek Harness 独立管理器 —— 源码分析与功能规格

> 分析对象：`/Users/kirito/Documents/GitHub/deepseek-harness`（版本 `0.1.0-rc.5`，npm 最新 `0.1.0-rc.6`）
> 目的：为一个跨平台的、独立于 dsh 本体的管理器软件提供**管理对象清单**与**功能设计依据**。
> 全部结论均来自对源码、文档与真实 `~/.dsh` 数据目录的核查。

---

## 1. 结论摘要（管理层对象全景）

dsh 是一个"**一切皆插件**"（Cordis）的 agent harness，目前处于 developer preview（`0.1.0-rc.x`，官方明示"会有破坏性变更"）。它**没有任何自带的管理器/守护进程/自更新机制**（源码中不存在 update-checker），也没有服务化安装。这意味着：

1. dsh 本体只是"一条命令 + 一组用户数据"，非常适合被独立管理器接管；
2. 管理器要管的**不是 dsh 进程内部**，而是三个层面：**安装/运行时（node、pnpm、dsh 命令）→ 数据面（DSH_HOME）→ 配置面（profile/补丁/settings/credentials）**；
3. 管理器与官方 Web UI **不重叠**：Web UI 管"会话内"的事（对话、模型选择、工作区），管理器管"机器上"的事（安装、健康、修复、插件、更新、备份、配置审计）。

### 核心功能矩阵（用户点名的 4 项 + 分析得出的扩展项）

| 优先级 | 功能 | 管理对象（源码证据） |
|---|---|---|
| P0 | **健康检查与问题修复** | 运行时依赖、Harness Home 完整性、会话日志完整性、profile 可引导性、端口/进程、权限位、磁盘 |
| P0 | **插件管理** | `DSH_HOME/profiles/<name>` 的 `package.json`(`dsh.profile.bundles`)、`node_modules`、`pnpm-workspace.yaml`(allowBuilds)、`cordis.patch.yml` 插件行 |
| P0 | **检查更新** | npm 上的 `@deepseek-ai/dsh`（latest/next）、GitHub releases/tags、PyPI `deepseek-harness-sdk` + runtime wheel、已装插件版本 |
| P0 | **备份与恢复** | `DSH_HOME` 全量：sessions（`session.jsonl.zstd`）、settings.yaml、.credentials.yaml、cordis.patch.yml、profiles 清单、storages、attachments、skills、.agent-presets |
| P1 | 配置管理 | `cordis.patch.yml`（home + 每 profile）、`settings.yaml`、`.credentials.yaml`、env（`DSH_*`/`DEEPSEEK_*`）、`--dump-config` 组合树可视化 |
| P1 | 实例/进程管理 | `dsh web` 生命周期（SIGINT/SIGTERM 优雅退出）、端口 3080、多 profile 多实例、开机自启、日志采集 |
| P1 | 会话管理 | `DSH_HOME/sessions/<workspace>/session-<uuid>/session.jsonl.zstd`（解码、导出、归档、删除、统计） |
| P1 | 日志与遥测 | 进程 stdout/stderr、会话日志解码器、`DSH_TELEMETRY_MODE` 开关、OTLP 导出审查 |
| P2 | 环境/安装管理 | Node（^22.19||>=24）、pnpm（11.7）、npx 缓存、Python SDK 环境、landlock/pwsh/ConPTY 平台能力探测 |
| P2 | 自动化 | 定时备份、定时更新检查、定时健康巡检、通知 |
| P2 | 安全审计 | 密钥扫描（注意：profile 补丁里出现过明文 API key）、文件权限位审计（0600/0700）、遥测开关 |

---

## 2. dsh 是什么（30 秒速览，管理器的背景知识）

- **架构**：vendor 的 [Cordis](https://github.com/cordiverse/cordis) 框架上，**每个产品部件都是插件**：模型适配器、工具注册表、会话日志、agent loop、沙箱、审批策略、设置、凭据、遥测。没有"特权核心"，扩展 = 往插件树里挂插件。→ *管理器修"配置"= 编辑补丁层，不是改源码。*
- **profile 与 bundle**：一次运行 = 一个 **profile**（`DSH_HOME/profiles/<name>`），profile 按顺序叠 **bundle**（`dsh.profile.bundles`：base → web-app/headless → 用户插件），最后叠用户补丁（profile 的 `cordis.patch.yml` → home 级 `DSH_HOME/cordis.patch.yml` → `--patch` 覆盖）。行级"后写赢"，替换整个 config 而非深合并。
- **版本状态**：`0.1.0-rc.5`（本地）vs npm latest `0.1.0-rc.6`。npm dist-tags：`latest` = `next` = `0.1.0-rc.6`。历史版本 0.0.1-rc.1/2/5、0.1.0-rc.2/3/6。**无稳定版**，官方明确破坏性变更随时发生 → 更新功能必须默认"先备份 + 可回滚"。
- **无内置自更新**：源码 grep 无 update-checker；更新只能由外部（管理器）做：`npm i -g` 或 `npx`（npm 形态）、pip（Python 形态）、git pull + build（源码形态）。

---

## 3. 部署形态与多平台矩阵（管理器必须识别的"安装形态"）

dsh 有 **4 种互不相同的部署形态**，管理器要能识别、升级、体检每一种：

| 形态 | 入口 | 数据/配置 | 平台 |
|---|---|---|---|
| **A. npm 安装** | `npx @deepseek-ai/dsh web`（bin: `dsh`） | 全局/本地 node_modules；用户数据仍在 DSH_HOME | 全平台（macOS/Linux/Windows） |
| **B. 源码 checkout** | `git clone … && pnpm install && pnpm run build && pnpm dsh web` | 需要完整构建链（tsc+tsdown+web）；**缺 Typert host 产物 / 缺前端 bundle 会启动失败** | 全平台（Windows 有 wine CI 门禁） |
| **C. Python SDK** | `pip install deepseek-harness-sdk`（依赖同版本 `deepseek-harness-runtime-bin` wheel） | 单文件 exe `dsh-jsonrpc-agent-pkg-<platform>-<arch>`（@yao-pkg/pkg SEA 打包）；macOS 还带 `-spawn-helper` 原生伴生文件（缺失=硬启动错误）；Linux 无 helper（直接 node-pty addon） | 仅 **linux x64/arm64 + macOS arm64**（py3-none-manylinux_2_28_*、macosx_14_0_arm64）；**暂无 Windows exe** |
| **D. 裸 SDK 组件** | ACP 服务器、JSON-RPC stdio server（`packages/sdk/{protocol,server,client}`） | `DSH_CORDIS_CONFIG` 指向自编 cordis.yml；`DSH_SESSION_ROOT`/`DSH_CWD` 决定持久化位置 | 随宿主平台 |

- **Node 版本要求**：`^22.19.0 || >=24.0.0`（CI 覆盖 22.19/24/26）。**pnpm**：`11.7.0`（corepack 固定）——插件管理必须用 pnpm，管理器需要探测/兜底。
- **平台特有组件**：Linux 沙箱用 native `landlock-run`（fail-closed：内核不支持则拒绝执行）；Windows 用 pwsh provider + ConPTY（node-pty）+ ACL 沙箱 + koffi（JSONL 写穿耐久）；macOS 需要 spawn-helper 可执行位。→ **健康检查必须按平台分支**。

---

## 4. Harness Home 数据面清单（管理器管理的"对象模型"）

`DSH_HOME` 解析优先级：显式配置 > `DSH_HOME` env > `~/.dsh`（源码：`packages/util/home-paths/src/index.ts`）。本机实测 `~/.dsh` 共 28MB（sessions 24MB / profiles 2.9MB / attachments 196KB / storages 124KB）。

### 4.1 目录与文件总表

| 路径（相对 DSH_HOME） | 内容 | 管理器用途 | 敏感度 |
|---|---|---|---|
| `profiles/<name>/package.json` | `dsh.profile.bundles`（有序 bundle 列表）+ 依赖声明 | **插件管理的核心文件**；bundles 与 node_modules 不一致 = 待修复 | 中 |
| `profiles/<name>/cordis.patch.yml` | 该 profile 的用户补丁层（YAML patch 数组） | 配置编辑、差异对比、备份 | **高**（实测含明文 Figma API key） |
| `profiles/<name>/node_modules/` | 出树插件（pnpm 安装） | 插件清单/占用/完整性 | 低 |
| `profiles/<name>/pnpm-workspace.yaml` + `pnpm-lock.yaml` | allowBuilds 白名单（pnpm>=10 默认拦截构建脚本）+ 锁文件 | 插件安装失败（allowBuilds 报错）时的修复入口 | 低 |
| `profiles/<name>/cordis.yml` | 固定为 `[]`（补丁组合根） | 只读，别让用户误改 | 低 |
| `profiles/node_modules/` | 安装兜底目录：**每个包一个 symlink，每次启动自愈** | symlink 损坏 = 启动失败风险点 | 低 |
| `cordis.patch.yml` | home 级补丁（跨 profile 共享，优先级高于 profile 层） | 配置管理；**dsh 编辑时自动留 `.bak-<ts>` 备份**（管理器可复用该机制） | 高 |
| `settings.yaml` (0600) | 用户设置文档，**热重载**；`llm-deepseek:`/`llm-pi-ai:` 段 = Web Models 页写入的模型配置 | 配置编辑器（模型路由、agent-presets、locale、onboarding） | 中 |
| `.credentials.yaml` (0600) | 托管凭据文档；解析顺序：环境变量 → 本文件 → 项目 `.env` → `DSH_HOME/.env`；**从不注入 process.env** | 凭据查看（掩码）/编辑/导出；**备份时需加密或排除** | **极高** |
| `.anonymous-user-id` | 遥测匿名身份 UUID；删除=重置 | 隐私控制（重置身份） | 低 |
| `sessions/<workspace-key>/session-<uuid>/session.jsonl.zstd` | 追加式会话日志：header + 事件行，**zstd 帧 + 校验**，packChunks 打包（实测 ~60% 体积下降），torn-tail 自动恢复 | 会话管理、日志解码、备份主体、修复对象 | 中高（含对话全文） |
| `attachments/` | 内容寻址的图片/附件字节（会话日志只存引用） | 备份、清理 | 中 |
| `storages/` | `workspace.json`（Web UI 工作区状态 v2）、`session_projcache.json`（投影缓存）；storage-json 后端，另有 storage-sqlite 可选 | 备份、重置 UI 状态 | 低 |
| `cache/` | 缓存（可安全清空） | 清理修复 | 低 |
| `skills/` | 用户技能（skill-filesystem 拥有 `<dshHome>/skills`） | 备份、管理 | 中 |
| `.agent-presets/<id>/agent.cordis.yml` | 本地编写的 agent 预设（目录名=预设 id；缺失/损坏会显示为 broken 行） | 备份、预设健康检查 | 中 |
| 插件自建目录（实测：`figma-images/`、`pet.json`） | MCP/插件数据 | 备份的"其他内容"扫描 | 不定 |

### 4.2 会话日志格式要点（备份/修复必须懂）

- 每会话一个目录 `session-<uuid>/session.jsonl.zstd`；`root: !!js dshHomePath('sessions')`（base bundle 配置）。
- 文件 = **首帧恰好一行 header**（含格式版本 `SESSION_FORMAT_VERSION`，当前 0、无兼容承诺）+ 连续事件行；zstd 帧带校验；**torn-tail 恢复**机制存在（截断到最后一个完整帧并回收事件）——管理器修复"损坏日志"应模拟该语义：**先备份、再截断到最后一个完整帧**。
- 追加写入有批量延迟（`writeBatchMaxDelayMs`）与 Windows 写穿发布（koffi MoveFileExW）→ **运行中备份会话日志可能抓到未完成尾部，但 dsh 自身能容忍/恢复**，管理器可借此做一致性备份（先停实例或接受 torn tail 并记录）。
- 会话内容索引默认 `:memory:` SQLite（session-query-sqlite，`openAt: never`，全文搜索 opt-in）→ 管理器无需维护该索引。

---

## 5. 管理入口（管理器与 dsh 的交互通道）

| 通道 | 细节 | 管理器用法 |
|---|---|---|
| **CLI** | `dsh --profile <name>` / `dsh web`（别名，`--host/--port/--trusted-host`）/ `dsh --profile headless "task"` / `dsh plugin --profile <name> <pnpm args>` / `--dump-config` / `--patch` / `-V` | 启动实例、插件操作、配置树导出、版本读取。**CLI 退出码**：配置/启动错误非 0；headless 完成 0/失败 1 |
| **HTTP API** | 默认 `http://127.0.0.1:3080`，`POST /api/<method>`（`host.describe`、`session.*`、`workspace.*`、`settings.*`、`credentials.*`、`llm.*`、`goals.*`、`skills.*`、`subagent.*`、`agentPreset.*`）；**浏览器信任围栏**：loopback Host 放行、跨站标记拒绝、LAN 需 `--trusted-host` | **健康检查**：`host.describe` 返回 version/cwd/provider/model/attachedSessions/canOpenPath；实例存在性 TCP 探测 |
| **SDK** | `packages/sdk`：JSON-RPC protocol/server/client（stdio）；ACP server（`packages/acp`） | 高级：管理器内嵌客户端驱动任务（P2） |
| **文件系统** | 直接读写 DSH_HOME（上表） | 备份、配置编辑、修复（管理器最可靠的通道） |
| **信号** | SIGINT/SIGTERM：优雅释放插件树，**5 秒排空**，第二个信号强制退出；SIGTERM 各表面退出码 0，SIGINT 130 | 管理器停服策略：先 SIGTERM，等 <=6s，再 SIGKILL |

**env 全集**（管理器"环境管理"页要覆盖）：`DSH_HOME`、`DSH_PERMISSION_MODE`（read-only/workspace-write/danger-full-access，默认 workspace-write + ask）、`DSH_TOOLS_MODE`（native/code/both）、`DSH_TELEMETRY_MODE`（FULL/FEEDBACK_ONLY）、`DSH_TELEMETRY_OTLP_URL`、`DSH_TELEMETRY_DISABLED`、`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_SEARCH_BASE_URL`、`DSH_SESSION_ROOT`、`DSH_CWD`、`DSH_CORDIS_CONFIG`、`NODE_USE_ENV_PROXY`。

---

## 6. 功能设计一：健康检查与问题修复（P0）

### 6.1 诊断项清单（每个都要有"状态 + 证据 + 修复动作"）

**A. 运行时环境**
1. Node 版本是否满足 `^22.19 || >=24`（`node -v`）。
2. pnpm 是否可用、版本（corepack 是否启用；插件管理依赖）。
3. dsh 可执行形态识别（npm 全局 / npx 缓存 / 源码 checkout / Python wheel exe），并读取版本（`dsh -V`）。
4. 平台能力探测：Linux 的 landlock-run probe（fail-closed，不可用=沙箱失效风险）；Windows 的 pwsh、ConPTY；macOS 的 spawn-helper 存在且可执行。
5. 磁盘空间（DSH_HOME 所在卷；session 日志增长）。

**B. Harness Home 完整性**
6. DSH_HOME 可写、目录存在（首次引导提示初始化：`dsh --profile web --dump-config` 可触发模板初始化）。
7. 文件权限位审计：`.credentials.yaml` 应为 0600、sessions/ 0700、DSH_HOME 0700（实测如此；管理器修复 chmod）。
8. `settings.yaml`、`cordis.patch.yml` 可解析（YAML）；`.bak-*` 堆积扫描（提供"清理旧备份"）。
9. `profiles/node_modules` symlink 完整性（dsh 自愈机制失败时的兜底：重新 `pnpm install` 或重建 symlink）。
10. **profile 可引导性**：`dsh --profile <name> --dump-config`（无副作用、不监听端口）——捕获 parse/schema/resolution 错误；对比 bundles 声明 vs 实际安装（`dsh.profile.bundles` 里有不存在的包 = 启动必失败）。

**C. 数据文件**
11. 会话日志体检：逐文件验证 zstd 帧可解码、首帧是 header、尾部是否 torn（给"截断修复"建议）；损坏文件与最后修改时间/大小关联展示。
12. storages JSON 可解析（损坏=Web UI 状态丢失，可重置）。
13. attachments 引用完整性（可选，P2）。

**D. 运行态**
14. 端口冲突：3080 被占（`lsof`/netstat 按平台）；检测正在运行的 dsh 实例（TCP 探测 + `host.describe` 拿版本/附加会话数）。
15. 僵尸/孤儿进程（管理器启动的实例退出后残留）。
16. 遥测/凭据现状快照（供安全审计页复用）。

### 6.2 修复动作库（每项先自动备份相关文件）

| 修复 | 动作 | 安全措施 |
|---|---|---|
| node/pnpm 缺失或版本不符 | 提示安装命令 / 管理器内嵌 Node 运行时（见第 11 节选型） | 不动系统包 |
| 权限位错误 | chmod 0600/0700（按平台） | 只收紧不放开 |
| YAML 损坏（settings/patches） | 用最近 `.bak-<ts>` 还原（diff 展示） | 还原前复制损坏件 |
| profile 不可引导 | 1) 按 bundles 重新 `pnpm install`（profile 目录） 2) 校验 lock 3) `--dump-config` 复验；失败则列出缺失包 | 在 profile 目录操作，绝不全局 |
| 会话日志 torn/corrupt | 备份原文件 → 截断到最后一个完整 zstd 帧（复用 dsh 自己的恢复语义）→ 用 SDK 或重开验证 | 只截断不重写 |
| `profiles/node_modules` symlink 损坏 | 重建或重装 | 记录变更 |
| 插件 allowBuilds 拦截 | 自动在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds:` 加入对应包并注明原因（**这正是 dsh 官方指引**：copy the printed key and re-run） | 展示 diff 后写入 |
| 缺 Typert host 产物/前端 bundle（源码形态） | 提示/执行 `pnpm run build` | 需先确认源码形态 |
| 磁盘不足 | 清 `cache/`、旧 `.bak-*`、归档旧会话 | 先列出可回收量 |
| 实例卡死 | SIGTERM → 6s → SIGKILL；重启并记录 | 与"备份"联动 |

---

## 7. 功能设计二：插件管理（P0）

### 7.1 插件世界的准确模型（来自源码）

- 插件分两类：**内置 bundle**（`@deepseek-ai/dsh-base`、`dsh-web-app`、`dsh-headless`，随 dsh 安装版本走）+ **出树插件**（profile 的 pnpm 依赖，`dsh plugin --profile X add <pkg>` 安装）。
- 安装后 `dsh.profile.bundles` 会**自动 reconcile**：依赖里声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的包自动入栈；无 bundle 声明的普通依赖仅提示；移除依赖自动出栈。
- Git 托管插件通过 `prepare` 脚本构建，**pnpm >=10 默认拦截**（allowBuilds）→ 首次 add 会失败并给提示，这是最常见的"插件装不上"问题。
- `dsh plugin` 本质 = **转发给 profile 目录里的 pnpm**（add/remove/update/why 等全部 pnpm 动词可用；相对路径 `add .` 锚定调用目录）。

### 7.2 管理器功能

1. **插件清单**：按 profile 列出 bundles（内置/出树）、版本、`dsh.bundle` 声明、是否入栈；显示"声明 vs 实装"差异徽标。
2. **安装/移除/更新**：调用 `dsh plugin --profile <name> <add|remove|update …>`（保留官方 reconcile 语义），**执行前自动备份 `package.json` + `pnpm-lock.yaml`**；失败时提供回滚。
3. **allowBuilds 管理**：读 profile 的 `pnpm-workspace.yaml`，安装报错时引导添加白名单（含 diff 预览）。
4. **插件市场浏览**：GitHub `dsh-plugin` topic 检索（官方推荐的发现渠道）+ 展示包 README/dsh 字段；支持 git:/github:/npm 三种 spec。
5. **插件配置**：把插件在 `cordis.patch.yml` 中的行（insert/修改）可视化编辑（form 或 YAML 源码 + 校验）；提供 bundle 补丁的**行级来源追踪**（`--dump-config` 输出带来源注释）。
6. **启用/禁用**：patch 行 `disabled: true` 语义（遥测行就是 launcher 用 disabled 硬关的——注意：**config 无法 disable 行，必须 patch disabled**）。
7. **危险操作防护**：删除含配置的插件时，先展示其 patch 行依赖。

---

## 8. 功能设计三：检查更新（P0）

### 8.1 更新渠道（已实测）

| 渠道 | 端点 | 当前值（2026-08-15 实测） |
|---|---|---|
| npm `@deepseek-ai/dsh` | `registry.npmjs.org` dist-tags `latest`/`next` | latest = next = **0.1.0-rc.6**（本地 checkout rc.5，差 1 版） |
| GitHub releases/tags | `api.github.com/repos/deepseek-ai/deepseek-harness`（release 少；`python-v<version>` 标记配套） | 稳定 release 尚未成体系 |
| PyPI SDK | `deepseek-harness-sdk`（+ 同版本 `deepseek-harness-runtime-bin`） | **0.1.0rc6** |
| 插件 | npm registry 按包名查 | 随各插件 |

### 8.2 管理器功能

1. **多形态版本对比**：识别本机各部署形态的版本（npm 全局 / npx / 源码 / Python），与各渠道最新版对比，一张表展示"落后多少/是否 rc/是否破坏性区间"。
2. **更新计划**：默认流程 = **备份 DSH_HOME → 停实例 → 升级（按形态：`npm i -g` / `npx` / git pull+build / pip）→ 启动自检（`--dump-config` + health probe）→ 失败自动回滚**（备份恢复 + 版本降级）。
3. **rc 策略**：预览期建议默认"检查 latest，更新需显式确认"，记录 changelog/发布说明（npm time、GitHub releases body）。
4. **通知**：新版本可用时系统通知/角标（管理器常驻时）。
5. **插件更新批量**：逐 profile `pnpm update` 前展示将要变动的依赖 diff（`pnpm outdated` 读取）。
6. 注意：`minimumReleaseAge` 等 pnpm 新特性也会影响插件更新（`minimumReleaseAgeExclude` 在 root 配置里出现过）——更新插件用官方推荐路径即可。

---

## 9. 功能设计四：备份与恢复（P0）

### 9.1 备份内容与策略

| 组 | 路径 | 策略 |
|---|---|---|
| 会话日志 | `sessions/` | **主体**（24MB/28MB 实测）；zstd 已压缩，备份可再压缩或原样复制；运行中允许 torn tail（dsh 可自愈），或在"停实例备份模式"下严格一致 |
| 配置 | `settings.yaml`、`cordis.patch.yml`(+.bak)、profiles/*/cordis.patch.yml、profiles/*/package.json、pnpm-lock.yaml | 每次修改前快照；**diff 友好**（YAML 文本） |
| 凭据 | `.credentials.yaml`、`.env` | **默认排除**；开启"加密备份"（用户主密码/系统钥匙串）才纳入 |
| 状态 | `storages/`、`.anonymous-user-id` | 含 UI 工作区布局 |
| 资产 | `attachments/`、`skills/`、`.agent-presets/`、插件自建目录 | 按开关 |
| 插件本体 | profiles/*/node_modules | 默认**不备份**（可重建：package.json+lock 足够），提供"完整备份"选项 |

### 9.2 功能要点

1. **计划任务**：每日/每周 + 保留策略（滚动 N 份）；**修改前自动备份**（写前快照，类似 dsh 自己的 `.bak-<ts>`，但统一管理）。
2. **备份格式**：目录树 + manifest.json（dsh 版本、DSH_HOME 路径、时间、内容清单、校验和）；可选单文件归档（tar.gz/zip，跨平台）。
3. **恢复**：**dry-run 差异预览**（将覆盖/新增/删除哪些文件）→ 恢复前把现状再备份一份 → 恢复后健康检查；支持"恢复到别的 DSH_HOME"（迁移场景）。
4. **迁移**：整机搬家 = 备份 + 在目标机还原 + 校验 `dsh --profile web --dump-config`；DSH_HOME 可指向任意路径（管理器可管理多套 home：按 env 切换）。
5. **加密**：凭据类用本机钥匙串或用户口令加密（AES-GCM），UI 中永远掩码。
6. **一致性**：优先"停实例备份"；在线备份记录"当时有活动实例"标记。

---

## 10. 功能设计五：扩展功能（分析得出）

### 10.1 配置管理（P1）
- 三层补丁可视化（bundle → profile patch → home patch → --patch overlay），每个配置行显示**来源文件与覆盖顺序**（`--dump-config` 的数据正好提供）。
- `settings.yaml` 结构化编辑（模型路由、默认模型、agent presets、locale）+ 热重载提示。
- `.credentials.yaml` 掩码查看/增删改（调用方语义：provider 按需解析，不写 process.env）。
- env 模板管理（`DEEPSEEK_API_KEY` 等）、补丁模板库（如 MCP server 插入模板）。
- **校验器**：写补丁前用 `dsh --profile X --dump-config`（带 `--patch`）离线验证，避免破坏启动。

### 10.2 实例/进程管理（P1）
- 一个管理器管多个实例：每实例 = (profile, port, cwd, env, DSH_HOME)。
- 启动/停止/重启（SIGTERM 优雅，5s 超时强杀）、开机自启（launchd/systemd/Task Scheduler 按平台）、日志采集轮转。
- 实例健康卡：`host.describe` 版本/附加会话数、端口、PID、内存（进程级）、最近日志。

### 10.3 会话管理（P1）
- 按工作区浏览会话（`sessions/<workspace-key>` 目录名即编码路径）；大小、事件数、最后活动时间。
- **日志解码查看器**：zstd → JSONL 事件流回放（headless/聊天记录）；导出可读格式（官方有 session-log-export，管理器可独立实现解码器——zstd 解码用 Node 库或解压子进程）。
- 归档/删除（先备份）；统计（会话数、占用）。

### 10.4 日志与遥测（P1）
- 进程 stdout/stderr 采集（启动实例时托管）。
- 遥测状态卡：当前模式（默认 DISABLED）、OTLP URL、匿名 ID（可重置）；一键切换 FULL/FEEDBACK_ONLY/OFF（env 或 patch disabled 行）。
- 隐私提示：FULL 导出含消息文本/工具参数/工作区路径（官方文档明示无 redaction 规则）。

### 10.5 安全审计（P2）
- **密钥扫描**：在 DSH_HOME 文本文件（尤其 cordis.patch.yml）里扫 `sk-`/`figd_`/AK/SK 模式 —— 本机实测 profile 补丁里就有明文 Figma key。
- 权限位审计、敏感文件清单、遥测开关状态；一键"收紧"（chmod + 建议把密钥挪进 .credentials.yaml）。

### 10.6 自动化（P2）
- 管理器自带调度器：定时备份 / 更新检查 / 健康巡检 / 会话归档；系统通知。

---

## 11. 技术选型建议

**约束**：跨平台（macOS/Linux/Windows）；需要执行外部命令（node/pnpm/dsh）；需要读 DSH_HOME、监控端口、常驻托盘；需要良好的 YAML/JSON 编辑 UI；安全（处理凭据）。

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Tauri 2 (Rust + Web 前端) + Node sidecar** | 包体小、内存低、Rust 侧做凭据加密/权限审计稳；sidecar 用 Node（与 dsh 生态同栈，可直接用 pnpm/npm 逻辑） | 需要维护 Rust 与 Node 双栈；sidecar 分发体积 | **推荐**：Rust 只做薄壳（进程管理、钥匙串、文件操作），业务逻辑放 Node sidecar 或纯前端调 sidecar |
| Electron + Node 主进程 | 单栈 Node，天然复用 dsh 的 zstd/JSON-RPC 依赖；生态成熟 | 包体 ~100MB+、内存高 | 可接受备选，若团队纯 JS 优先 |
| 纯 CLI + Web 面板 | 轻 | 不是"管理器软件"形态 | 不满足需求 |

**关键库**：YAML（js-yaml，与 dsh 一致）；zstd 解码（wasm 或 sidecar 调 `zstd` CLI）；进程/端口（node:child_process + 平台 netstat/lsof）；钥匙串（Tauri stronghold/keyring）；通知（Tauri 插件）。**管理器自身配置**存 `~/.dsh-manager/`（与 dsh 隔离），多 DSH_HOME 支持用 `DSH_HOME` env 启动子进程。

**不要做的事**：不要改 dsh 源码/不要注入进程；不要直接写 `sessions`（只读+备份）；不要并发写 `cordis.patch.yml`（遵守 dsh 的 watch+reapply）；不要绕过 trust fence 直连 `/api` 做认证（它只是防 rebinding，不是认证层）。

---

## 12. 路线图

- **P0（MVP）**：形态识别 + 健康检查 + 一键修复库（前 6 项）；插件清单/安装/移除/allowBuilds；更新检查（npm/PyPI 双渠道）+ 备份后升级；全量/增量备份 + 恢复 + dry-run。
- **P1**：实例管理（多 profile、日志、自启）；配置可视化与校验；会话浏览器/导出；遥测卡。
- **P2**：安全审计（密钥扫描）、自动化调度、市场浏览、多 home 迁移、SDK 集成。

---

## 13. 风险与注意事项

1. **预览期破坏性变更**：`SESSION_FORMAT_VERSION` 无兼容承诺、SQLite SCHEMA_VERSION 单调、官方明示 Backends reject old on-disk formats → 升级前必备份；管理器对未知新版本要"保守降级"（只读快照，不主动迁移）。
2. **凭据明文风险**：patch 文件里可能躺 API key（实测）；备份默认排除凭据；UI 掩码。
3. **运行中写文件**：`settings.yaml` 热重载、补丁 watch+reapply → 管理器编辑时用原子写（写临时文件 + rename），避免半截文件触发重载。
4. **端口/实例冲突**：管理器启动实例前探测 3080；多个管理器同时操作同一 DSH_HOME 需要文件锁。
5. **Windows 特有**：JSONL 耐久依赖 koffi（MoveFileExW），备份时别用"读-删-写"模式动日志；node-pty 需要 spawn-helper（macOS）或 ConPTY。
6. **沙箱**：管理器自身代码若在 dsh 沙箱内跑（如被 agent 调用），需注意；正常使用无涉。
7. **npm 缓存损坏**（本机实测 EPERM）：管理器更新检查应直连 registry API（HTTP），不依赖 npm CLI 的缓存。
8. **官方边界**：Web UI 已在做模型/设置/插件清单（ui-settings-plugins），管理器聚焦"机器级"能力，避免重复建设会话内功能。
