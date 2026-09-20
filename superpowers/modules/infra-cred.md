# modules/infra-cred.md · 凭证模块简报

> 窗口只读本文件 + `GLOBALS.md`。改 `contracts` 禁碰。

## 1. 职责
凭证抽象接口：Web 阶段用本地加密文件（AES-256-GCM），后期可换 safeStorage（外壳无关）。密码仅存加密存储（S5 陕西人大 `admin/<REDACTED>`）。

## 2. 契约要点（去 docs 看细节）
- 接口：save/get/delete/list（AES-256-GCM 实现已在 `src/index.ts` 落地，经核查非断点）
- 详见 `design.md §3`、plan.md §3

## 3. 当前进度
- **4 个 .ts**（实测，非原写 1），已是完整 AES-256-GCM 实现（save/get/delete/list），无需修复。

## 4. Implementation Planning（细粒度任务分解 · Phase 3）
> 每任务 = 精确文件 + 要点 + 验证（TDD：先写 verify 跑红 → 写实现跑绿）。按 ID 顺序执行。

| ID | 任务 | 文件 | 验证（先写跑红） |
|----|------|------|------------------|
| T1 | 确认 save/get/delete/list 签名与 contracts 对齐（无缺口） | `src/index.ts` | `verify/cred.verify.ts` 断言「接口签名与 contracts 一致」 |
| T2 | safeStorage 切换点可插拔（Web 本地加密 → Electron safeStorage，接口不变只换实现） | `src/index.ts` | 断言「切换实现不影响调用方」 |
| T3 | 补 README + 补测试到 coverage≥80% | `README.md`、`verify/cred.verify.ts` | `pnpm --filter @test-platform/infra-cred verify` 全绿 |

## 5. 边界 & 依赖
- 依赖：`@test-platform/contracts`
- 被 login 依赖

## 6. 本窗口纪律（防卡死）
- 只改 `packages/infra-cred/**`；不碰 `node_modules`/`contracts`、不跑 `pnpm install`
- 校验：`pnpm --filter @test-platform/infra-cred verify`
- 改完通知进度，等 merge 回 main
- 守代码规范（GLOBALS §8）：命名 / 文件≤300行 / 函数≤50行 / 嵌套≤3层 / 无魔法数 / 每目录 README。
- 开工前先核对真实进度（GLOBALS §7）：勿照本卡数字，以实际代码为准。
