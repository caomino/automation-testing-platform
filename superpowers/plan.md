# 自动化测试平台 · 实施计划（plan.md · v2 最终版）

> 依据：design.md（v2）+ design-validation-review.md（复核）+ 用户最终确认
> 交付标准：**测试工程师视角浏览器自测（正常+异常场景）**，适配多系统，不返工

---

## 0. 产品定位（最终确认）

**第三方软件测试公司的内部测试效能工具**（公司自用，非对外销售）。

- 核心价值：快速适配客户各类 Web 管理系统 → 探索 → 生成功能点/用例 → 执行 → 缺陷 → 导出测试报告。
- 商业化能力裁剪：**去掉**许可/激活、品牌白标、自动更新、对外多租户；**保留** RBAC（内部角色：测试员/项目经理/管理员）、回归历史（多轮对比）、导出汇总（给客户的汇总报告）。

---

## 1. 铁律：先打地基冻结，再并行

```
第一步  contracts 100% 冻结（含 infra-store 持久化接口）
          └─ schemas(6) + mock + index.ts + infra-store 接口 + zod 校验
          └─ pnpm install && build/lint/typecheck/test/verify 全绿 = 真冻结
第二步  engine-mcp 的 DOM 语义抽象接口先定死
          └─ 接口签名 + 返回结构定稿，stage-login/explore/execute 才能依赖
第三步  才 spawn 并行 Builder 开发 stage-*
```

> ⚠️ 未走完前两步就并行 = 并行返工。地基是串行的，模块才是并行的。

---

## 2. 三个并行前提（缺一不可，已解决）

| 前提 | 落地方式 | 状态 |
|------|---------|------|
| ① contracts 100% 冻结（含持久化接口） | schemas/mock/index.ts + `infra-store` 接口（SQLite）+ zod 校验，跑绿才冻结 | 待执行 |
| ② engine-mcp DOM 抽象接口先定死 | 先写 engine-mcp 的 `run()` 接口 + DOM 抽象返回结构 + verify 测试，定稿后再动 stage | 待执行 |
| ③ Reviewer 强把关 | 每个 Builder 产出后 spawn Reviewer(reasoning) 两关：spec 合规 + 代码质量；不通过打回，三次打回暂停上报 | 机制已定 |

---

## 3. 持久化方案（infra-store，解决 R-2）

- 新增包 `infra-store`：SQLite（零配置、单文件、Node 生态成熟）。
- 存储：Project / System / FeatureTable / CaseTable / ExecutionReport / DefectTable / KnowledgeBase。
- 接口冻结：`createProject/listProjects/getProject/updateProject/deleteProject/setActiveSystem/saveFeatureTable/...`（对应契约 §八/§九）。
- 数据**外部化**，不落项目工作空间。

---

## 4. 数据目录结构（语义清晰，从名字看出内容）

### 4.1 项目工作空间 `D:\newTest`（只放三类：代码/原型/文档）
```
D:\newTest\
├── docs/          # 全局唯一文档（5 份）
├── prototype/     # 10 屏原型
├── superpowers/   # 开发过程文档（design/plan/review）
├── packages/      # 源码（11 package + app + infra-store）
├── config/        # default.yaml
└── (根配置：package.json/tsconfig/eslint/prettier/vitest)
```

### 4.2 运行时业务数据 `D:\test-platform-data\`（infra-store 外部化落点）
```
D:\test-platform-data\
├── store\         # SQLite 数据库文件（projects.db 等）
├── logs\          # 日志（按 任务/项目 分目录）
├── screenshots\   # 缺陷截图 / 探索证据截图
└── exports\       # 导出的 Excel（功能点表/用例表/执行报告/缺陷表）
```

### 4.3 开发期临时目录 `D:\test-platform-smoke\`（默认可删）
```
D:\test-platform-smoke\
├── scripts\       # 探测/验证脚本（probe_*.js / read_gold*.py）
├── research\      # 调研结果（4 份特殊结构 + 汇总清单）
├── screenshots\   # 探测截图（sxrd-*.png）
└── archive\       # 归档的过时文件
```

---

## 5. 开发顺序（按原型流水线 + 质量优先 + 可并行）

> 用户明确：**不纠结时间**，按正确顺序 + 保证质量 + 可并行。顺序严格遵循原型五阶段流水线。

### 阶段顺序（对应原型侧栏流水线）
| 序 | 阶段 | 包 | 关键校验 |
|----|------|----|---------|
| 1 | **P0 地基**（串行） | contracts + infra-store + engine-mcp 接口 | zod schema + verify 跑绿 |
| 2 | **登录** | stage-login | 三模式登录 verify |
| 3 | **探索** | stage-explore + engine-mcp | DOM 抽象 + 模块树 + 只读探索 |
| 4 | **功能点** | stage-feature | 九列 + 测试点标识 base_NN 子系统递增 |
| 5 | **测试用例** | stage-case | 八列 + 用例编号绑定 + 金标准 round-trip |
| 6 | **执行/缺陷** | stage-execute + stage-defect | 数据隔离红线 + 六列 |
| 7 | **应用**（收尾） | app（React+Vite+Node 后端） | UI 10 屏 + 端到端 + 集中部署 |

### 并行策略
- 地基（contracts + engine-mcp 接口）串行，冻结后 stage-* 可并行。
- 每个 stage：TDD（verify 先红后绿）→ 实现 → 正反向覆盖 → Reviewer 两关。

### 质量优先原则（不赶工）
- 不跳过 verify、不堆积未验证代码、每完成一个 stage 自验 + Review 跑绿才进下一个。

---

## 6. 并行拓扑 + Builder 分配（沿用 design.md §10）

| 批次 | 内容 | 模型 |
|------|------|------|
| Batch 0（串行） | contracts + infra-store + engine-mcp 接口 + Excel 库选型 | reasoning（Orchestrator 亲自） |
| Batch 1（并行） | stage-feature/case（reasoning）· stage-login/defect（default）· stage-execute/explore（reasoning）· infra-*（lite） | 见 design §10 |
| Batch 2（串行收尾） | app 编排 + UI 10 屏 + Node 后端 + 端到端（Web 外壳，可插拔换 Electron） | reasoning |

**Reviewer（reasoning）**：每个 Builder 产出后两关审查——① spec 合规（对照 contracts + docs + verify 测试）② 代码质量（规范/无 any/无魔法数/目录规范/正反向覆盖）。不通过打回；同一任务打回 3 次则暂停上报。

---

## 7. 验收门（每 P 必过，全绿才进下一 P）

```
pnpm lint 0 error           pnpm typecheck pass
pnpm test 全绿              pnpm verify 全绿（verify/ 独立目录）
pnpm coverage ≥80%           pnpm madge 无循环
pnpm build 成功              冒烟/真实系统自测 + 截图证据
```

---

## 8. 签字点（checkpoint）

| 步骤 | 动作 | 签字 |
|------|------|------|
| 1 | contracts 100% 冻结（含 infra-store） | **你确认** |
| 2 | engine-mcp DOM 接口定死 | **你确认** |
| 3 | spawn Batch 1 并行 Builder | spawn 前 **你确认** |
| 4 | 冒烟闭环（正反向） | **你确认** |
| 5 | 真实系统验证（陕西人大只读） | **你确认** |

---

## 9. 细粒度任务分解（Implementation Planning · Batch 0 立即可执行）

> 每个任务 = 精确文件路径 + 内容要点 + 验证（TDD：先写 verify 跑红，再写实现跑绿）。当前状态：types(7)+stages(6)+constants(1) 已就位，缺 schemas(6)+mock+index.ts+infra-store。

### 组 A · 补类型缺口
| ID | 任务 | 文件 | 验证 |
|----|------|------|------|
| A1 | 补 `SubsystemConfig` 兼容类型（deprecated 别名，指向 System 子系统子集；契约 §1.3.1 导出签名要求） | `src/types/SystemConfig.ts` | `tsc --noEmit` 通过 |

### 组 B · zod schema（6 个，每任务先写 verify 跑红）
| ID | 任务 | 文件 | 验证 |
|----|------|------|------|
| B1 | LoginInput/Output schema + validate 包装 | `src/schemas/LoginSchema.ts` | `verify/loginSchema.verify.ts` 跑绿 |
| B2 | ExploreInput/Output schema（ModuleNode 递归） | `src/schemas/ExploreSchema.ts` | 同组 verify |
| B3 | FeatureInput/Output schema（九列） | `src/schemas/FeatureSchema.ts` | 同组 verify |
| B4 | CaseInput/Output schema（meta + CaseRow 八列） | `src/schemas/CaseSchema.ts` | 同组 verify |
| B5 | ExecuteInput/Output schema | `src/schemas/ExecuteSchema.ts` | 同组 verify |
| B6 | DefectInput/Output schema | `src/schemas/DefectSchema.ts` | 同组 verify |

### 组 C · mock 数据
| ID | 任务 | 文件 | 验证 |
|----|------|------|------|
| C1 | 区域影像样例（mockFeatureInput / mockCaseInput / mockCaseOutput，对齐金标准 QYYX_PZ_JCX） | `src/mock/index.ts` | 编译通过 + 被引用 |

### 组 D · 统一导出
| ID | 任务 | 文件 | 验证 |
|----|------|------|------|
| D1 | index.ts 统一导出全部 types/stages/schemas/constants | `src/index.ts` | 编译通过 + 导出齐全 |

### 组 E · infra-store 持久化接口
| ID | 任务 | 文件 | 验证 |
|----|------|------|------|
| E1 | infra-store 包骨架（package.json/tsconfig）+ 冻结接口（createProject/listProjects/getProject/updateProject/deleteProject/setActiveSystem/saveFeatureTable/saveCaseTable/saveExecution/...） | `packages/infra-store/src/` | 编译通过 |

### 组 F · 跑绿冻结
| ID | 任务 | 验证 |
|----|------|------|
| F1 | `pnpm install` 装依赖 | 无报错 |
| F2 | `pnpm -r build/lint/typecheck/test/verify` 全绿 | 0 error 0 warning |
| F3 | contracts 冻结声明（README 记录 v1.0 冻结） | 签字门 #1 |

---

## 10. 执行约定（TDD 循环，每个任务）

1. 写 verify 测试（跑红）→ 2. 写最小实现（跑绿）→ 3. 自验（build/lint/typecheck）→ 4. 更新 memory → 5. 通知进度

**Batch 0 完成后 = contracts 冻结，进入签字点 #1，你确认后才 spawn Batch 1 并行。**
