# 实施计划 · 验证阶段（explore → feature → case 全量覆盖校验）

> Superpowers 第三步（Implementation Planning）产出。前置：design.md 已签字（2026-08-17，用户选"批准，进入规划"）。
> 范围：纯校验代码。不动 contracts、不新增包、不碰 Electron / AI 用例生成串联。

## 依赖与执行顺序

```
T1(骨架) → T2 / T3 / T4(三器实现，可并行) → T5(单测 Red→Green) → T6(集成 spec) → T7(跑测) → T8(报告/收尾)
```

## 任务清单

### T1 · 校验器骨架与共享类型
- **文件**：`e2e/validators/pipelineValidators.ts`
- **内容**：定义共享类型 + 三个导出函数签名（先留最小实现，供 T5 红测驱动补全）。
- **类型定义**：
  ```ts
  import type { ModuleTree, FeatureTable, CaseTable } from '@test-platform/contracts'; // 仅类型，运行期擦除

  export interface Violation {
    code: string;      // 如 COVERAGE_INCOMPLETE / MENU_MISSING_IN_FEATURE / BAD_TESTPOINT_ID / SCENARIO_MISSING
    message: string;
    ref?: string;      // 关联定位（菜单名 / 测试点标识 / 缺失场景类）
  }
  export interface ValidationResult {
    pass: boolean;
    violations: Violation[];
    stats: Record<string, number>;
  }
  export function validateExplore(tree: ModuleTree, ft: FeatureTable[]): ValidationResult;
  export function validateFeature(ft: FeatureTable[]): ValidationResult;
  export function validateCase(ft: FeatureTable[], ct: CaseTable[]): ValidationResult;
  ```
- **类型来源说明**：优先 `import type` 自 `@test-platform/contracts`（类型擦除，无运行期依赖）。若 e2e 的 tsconfig 无法解析 workspace 包，则本地定义 structural 类型并在注释标注"与 contracts 对齐"。
- **验证**：`npx tsc --noEmit e2e/validators/pipelineValidators.ts` 类型自洽（不报错即可，逻辑留待 T2-T4）。

### T2 · validateExplore（全量菜单 + 颗粒度）
- **文件**：同 T1
- **断言**：
  1. `tree.coverage.visited === tree.coverage.total`，否则 `violations.push({ code:'COVERAGE_INCOMPLETE', ref:String(total) })`。
  2. 一级菜单集合（`tree.nodes` 中 `level===1` 的 `name`）每一项，必须在 `ft` 的"主模块"列（`FC.mainModule`）出现；遗漏项 → `MENU_MISSING_IN_FEATURE`。
  3. 颗粒度：每个功能点行 `subModule` 与 `mainModule` 必须非空（任一为空 → `GRANULARITY_BROKEN`，ref=测试点标识）。
- **验证**：见 T5。

### T3 · validateFeature（测试点 + 结构）
- **文件**：同 T1
- **断言**：
  1. 每行恰好 9 列（`row.length === 9`），否则 `COL_COUNT_9`。
  2. `mainModule / subModule / featureName / testPoint` 均非空，否则 `EMPTY_CELL`（ref=行序号）。
  3. `testPointId` 匹配 `^[\u4e00-\u9fa5A-Z0-9]+_[\u4e00-\u9fa5A-Z0-9]+_[\u4e00-\u9fa5A-Z0-9]+_\d{2}$`，否则 `BAD_TESTPOINT_ID`。
  4. 全表 `testPointId` 唯一：用 `Map` 计数，>1 的项 → `DUP_TESTPOINT_ID`。
- **验证**：见 T5。

### T4 · validateCase（全场景 + 绑定）
- **文件**：同 T1
- **断言**：
  1. 每行 8 列（`row.length === 8`），否则 `COL_COUNT_8`。
  2. `caseNo.startsWith(featureId)` 强绑定（featureId 取自 `ft` 对应行的 `testPointId`）；不匹配 → `CASE_NO_UNBOUND`。
  3. **五类场景确定性解析**（Design Validation 修正，弃用关键词）：取 `row.scenarioId`（兜底解析 `caseNo` 末尾 `_N(\d)` → 映射 normal/boundary/exception/process/permission）。对每个 `featureId`，其用例 scenarioId 集合须等于全五类，缺类 → `SCENARIO_MISSING`（ref=缺失类）。
  4. 无裸奔：每个 `testPointId` 至少 1 条用例，否则 `FEATURE_NO_CASE`。
- **验证**：见 T5。

### T5 · 单测（TDD Red → Green）
- **文件**：`e2e/validators/pipelineValidators.test.ts`
- **Red**：构造覆盖各类 violation 的 fixture（coverage 不等 / 菜单遗漏 / 列数错 / 标识重复 / 用例缺类 / 裸奔），断言 `pass===false` 且 `violations` 含对应 `code`。
- **Green**：实现 T2-T4 使上述用例全绿；另加"全合规 fixture"断言 `pass===true, violations=[]`。
- **验证**：`npx vitest run e2e/validators/pipelineValidators.test.ts` → 全绿。

### T6 · 集成校验 spec（含人工验证码断点）
- **文件**：`e2e/pipeline-validation.spec.ts`
- **流程**：
  1. `POST /api/stage`（mode=credential）登录 → 轮询 `loginStatus`；若为 `barrier`，最长 10 分钟等待用户手动输验证码，期间每 5s 轮询直至 `ok`（超时则 fail 并输出可读原因）。
  2. `ok` 后依次 `POST /api/stage` 跑 explore→feature→case，捕获三段 JSON 产出。
  3. 调用 `validateExplore / validateFeature / validateCase`，断言三段 `pass===true, violations=[]`。
  4. 控制台 / 附件输出覆盖率报告：菜单总数、功能点数、测试点数、用例总数、五类各计数、缺失项清单（若有）。
- **验证**：需你手动输验证码后 `npx playwright test e2e/pipeline-validation.spec.ts` 通过。

### T7 · 跑测
- 三器单测全绿（T5）。
- 集成 spec 在你输入验证码后绿（T6）。

### T8 · 收尾
- 在 `docs/测试报告-全模块问题清单-20260817.md` 追加"验证阶段结论"段（覆盖率结果 + 缺失项）。
- 清理临时探测产物（如有），保持工作区只有代码/原型/文档。

## YAGNI / DRY

- 不引入校验框架：纯函数 + 既有 vitest（单测）/ playwright（集成）。
- 场景分类只认 `scenarioId` / `caseNo` 后缀，不写关键词表。
- 不新增 npm 包；复用 contracts 类型（type-only import）。

## 不在范围（用户已裁定）

- Electron 桌面端 —— "先不做"
- AI 用例生成串联 —— "正在开发，先不管"
- 改 `packages/contracts/**` —— 冻结，需报批方可动

## 验证通过标准（对齐 design.md §7）

- 三器各有单测且全绿。
- `pipeline-validation.spec.ts` 在你输完验证码后跑通：三段 `pass=true`、`violations=[]`、五类场景覆盖率 100%，输出覆盖率报告。
