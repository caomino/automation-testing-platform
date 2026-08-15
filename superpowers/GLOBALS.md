# GLOBALS.md · 全局只读规则（多窗口开发）

> 本文件**所有窗口必读、只读不改**。修改须经用户同意。
> 配套：每个窗口另读 `superpowers/modules/<你的包>.md`（只属于你那个模块的一小份）。

---

## 0. 🚨 安全红线（血的教训 · 违反即数据事故 · 优先级最高）

> **事故记录 2026-08-15 18:46**：`D:\newTest\.git` 被**硬删除**（不在回收站、未被搬移），4 个提交历史 + 10 个分支引用 + 5 个 worktree 元数据全灭。源码因工作树完好而零损失。当时有 **2 个窗口并发操作同一仓库**，无法确证责任方。
>
> **根因不是工具，是缺规则**：12 个 worktree 隔离了 `node_modules`，但仍**共享同一个 `.git`** —— 隔离没有覆盖版本库，单点依旧。

### 0.1 单写者原则（Single Writer）

- **只有 1 个窗口是「主窗口」**，独占以下权力，其他窗口一律禁止：
  - 对主仓 `D:\newTest` 的任何 git 写操作（commit / merge / rebase / branch / worktree add|remove）
  - 在主仓根跑 `pnpm install`（同步 lock）
  - 改 `packages/contracts/**`、改 `docs/**`、改本文件
- **其他窗口 = 纯开发窗口**：只在**自己的** `D:\newTest-wt-<模块>` 内改自己包的源码。**对 `D:\newTest` 只读。**

### 0.2 绝对禁止清单

1. **禁止对 `D:\newTest\.git` 做任何操作**（删除 / 移动 / 重命名 / 改内容）。它是全部窗口的共享命脉。
2. **禁止对任何以 `D:\newTest` 开头的路径做批量删除/搬移**（`rm -rf`、`[System.IO.Directory]::Move`、`Remove-Item -Recurse`），唯一例外：明确指向 `<某 worktree>/node_modules` 且已 `pwd` 确认路径后。
3. **禁止 kill 其他窗口的后台任务**（可能打断正在写库的 git 进程）。要停先确认该任务归属。
4. **禁止在非自己的 worktree 目录内执行写操作**。
5. **禁止 `git worktree add` 到已存在的非空目录**，也禁止手工删 worktree 目录（须 `git worktree remove`，否则留孤儿元数据）。

### 0.3 后台任务写法禁令（38 分钟假卡死的真凶）

- ❌ **禁止在后台任务里用管道**：`( cd X && pnpm install | tail -3 )` → 子 shell + 管道在 Git Bash 后台会**僵死等 EOF**，进程早退出但 shell 永挂。
  - 实测证据：`.modules.yaml` 18:06 已写完（install 成功），shell 到 19:22 仍 running，系统零 `node.exe`。
- ✅ **必须重定向到日志文件**：`pnpm install > D:/test-platform-smoke/wt-logs/<m>.log 2>&1`，再用 Read 看日志。
- ✅ 批量循环里的每条命令都要独立重定向；先确保日志目录已存在（`mkdir -p` 必须**先单独跑完**，别和循环并行）。

### 0.4 备份机制（强制）

- 主仓已配本地裸仓镜像远端：`backup` → `D:\newTest-backup.git`（工作空间外）。
- **每次提交后立刻**：`git push backup main`。这是防"再次误删 `.git`"的兜底。
- 远端 GitHub 待配（缺凭据）；配好后同样每次提交后推送。

---

## 1. 多窗口 / 多 agent 开发模型（方案 B · git worktree 隔离）

- 每个开发窗口 = 一个**独立 git worktree + 独立分支 + 独立 node_modules**。
- 根仓库 `D:\newTest`(main) 已 `pnpm install` 填满**全局 pnpm store**（内容寻址，各 worktree 安装只读复用，安全并发；具体路径以 `pnpm store path` 为准，不要写死）。
- 新窗口建法：
  ```bash
  git worktree add D:/newTest-wt-<模块> -b feat/<模块>
  cd D:/newTest-wt-<模块>
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile   # 只读 store，安全并发
  ```
- 各窗口 `node_modules` 互不干扰；vitest `.vite` 缓存各自隔离（Windows Defender 锁不串窗口）。
- 收尾：各自 `rebase`/`merge` 回 `main`；`contracts` 冻结不改则无冲突。

## 2. 冻结硬规矩

- `packages/contracts/**` **严禁改动**；确需改 → 写原因 + 上报审核，经用户批准。
- 现有 4 处 contracts 改动保留不动。

## 3. 数据模型（冻结口径，照此实现）

- **九列**：序号 / 测试类型 / 需求章节 / 系统名称 / 主模块 / 子模块 / 功能点 / 测试点 / 测试点标识
- **八列**：用例编号 / 测试内容 / 步骤 / 输入及操作说明 / 预期结果 / 初次测试结果 / 回归测试结果 / 测试结论（列宽 `[18,16,8,34,34,14,14,12]`）
- **测试点标识**：`base`(3段)=`系统缩写_父目录缩写_子系统缩写`；行级 4 段 = `base_NN`（NN 按子系统从 01 递增，行级唯一主键）
- **绑定链（硬断言）**：`用例编号 === 功能点.测试点标识(4段)`；`测试内容 === 功能点.测试点`

## 4. 架构拓扑（依赖方向，不可反向）

```
contracts(0依赖) → infra-*/engine-mcp → stage-* → app
```

每 `stage` 仅暴露 `run(input): Promise<Output>`，类型全在 `contracts`，zod 校验。

## 5. 门禁（集中串行，防卡死）

- 开发窗口 = **CODE-ONLY**：禁 `pnpm install`、禁碰 `node_modules`、禁碰 `contracts`。
- 本窗口本地校验只允许：`pnpm --filter @test-platform/<你的包> build/lint/typecheck/verify`（用已有的 `--no-cache`）。
- 集成门禁由**单一窗口 / 人工**串行跑：`pnpm install`(一次) → `pnpm -r verify`。
- verify 脚本已带 `--no-cache`（绕 Defender 锁 `.vite`）。

## 6. 开发前先核对进度（硬规矩）+ 进度基线

> ⚠️ **开工前必做：先核对真实进度，勿照下表/模块卡数字。** 代码一直在推进，任何"当前进度"数字都可能过期。开工前执行三步：
> 1. `git status --short`（看未提交改动）+ `git log --oneline -3`（看最近提交）
> 2. 数目标包源码：`find packages/<你的包>/src -name '*.ts' | wc -l`
> 3. 确认基线：`git branch --show-current` + `git rev-parse HEAD`
>
> 以**实际代码**为准；下表/模块卡数字仅作参考，发现不符以代码为准并回报。

| 包 | 实测 .ts | 状态 |
|---|---|---|
| contracts | 47 | ✅ 冻结（schemas6/stages6/types6/mock/index 全就位） |
| stage-execute | 19 | 🟢 最完整 |
| stage-feature | 10 | 🟡 部分 |
| stage-defect | 7 | 🟡 部分 |
| stage-explore | 5 | 🟡 部分 |
| engine-mcp | 9 | 🟡 接口层 |
| stage-login / stage-case / infra-*（4个） | 4 | 🟡 骨架+部分实现 |
| app | 3 .ts / 10 文件 | ⚠️ React+Vite 骨架（无 Electron，见 §9 + plan-frontend） |

## 7. 文档权威源

- `docs/` 是唯一全局文档（主规格 / PRD / 契约 / 核查），改动需用户同意。
- `superpowers/` 是开发过程文档；本文件与各 `modules/<包>.md` 是其**拆分简报**（引用 docs 章节，不复制）。

## 8. 代码规范（必守，子 agent 易违反 → 返工；详见 docs 契约规范 §二 + 主规格 §13）

- 命名/注释/目录：见 docs；**文件 ≤300 行、函数 ≤50 行、嵌套 ≤3 层**。
- TypeScript 严格模式；**`no-explicit-any` 当前 eslint 为 `off`（允许）**，但勿滥用 `as unknown as`，必要桥接须加注释说明（已裁定：规范"禁 any"暂不强推）。
- 无魔法数（抽常量）；尽量纯函数；`contracts` 类型全走 zod 校验。
- 每目录 README 待补（当前仅 stage-execute 有）。
- **开工前先读本文件 + 你的 `modules/<包>.md`；禁止改 contracts、禁止碰 node_modules、禁止 `pnpm install`。**

## 9. 开工前必修（review.md 的 2 个 Critical，已裁定"现在修"）

- **stage-login**：① 子系统登录须读 `parentPortalUrl`（当前不读）；② `reuseSession` 是 stub（须接真实会话复用）。
- 这 2 项在 stage-login 子代理**开工前先修**；因其接口被 explore/execute 依赖，stub 会传导错误。
- 修复方式：派专门子代理进 `D:\newTest-wt-stage-login` 按 TDD 修，跑绿后 merge 回 main。
- 前端形态已定 **Electron 原生多窗口**（推荐）；⚠️ 缺 `electron` + `electron-builder` 封装与一键启动脚本（plan-frontend 真空区，集成阶段补）。
