# 自动化测试平台 — 跑通流程修复计划

## 概述

修复除 app 之外的所有文档/代码偏差，确保五阶段流水线（Login→Explore→Feature→Case→Execute→Defect）可端到端跑通。

## 偏差清单与修复方案

### 🔴 P0 — 阻塞流程的严重偏差

#### FIX-1: LoginInput 契约条件必填校验
**文件**: `packages/contracts/src/stages/LoginContract.ts`, `packages/contracts/src/schemas/LoginSchema.ts`
**问题**: `credentialRef` 和 `parentPortalUrl` 被标记为可选，但文档明确：
- `mode ≠ no-login` 时 `credentialRef` 必填
- 子系统类型时 `parentPortalUrl` 必填

**修复**:
1. 在 `LoginInputSchema` 中增加条件校验：`z.object` 用 `.refine()` 实现 mode 相关必填
2. 保持 TypeScript 接口为可选（兼容宽松输入），运行时 zod 校验强制约束

#### FIX-2: 功能点表「功能点」与「测试点」列区分
**文件**: `packages/stage-feature/src/featureTable.ts`
**问题**: 列 6（功能点）和列 7（测试点）均使用 `r.node.label`，九列退化为八列有效数据
**文档要求**: 功能点 ≠ 测试点，是两个不同概念
**修复**:
- 功能点 (列6): 使用父模块标签 + 当前节点标签组合，如 `检查室管理-查询`
- 测试点 (列7): 使用当前节点标签 `r.node.label`
- 需要向上遍历一层祖先获取父模块 label

#### FIX-3: complexLogicDetected 基础实现
**文件**: `packages/stage-case/src/index.ts`
**问题**: 硬编码 `complexLogicDetected: false`
**文档要求**: 主规格 §15 定义了 5 层复杂逻辑检测
**修复**: 实现基础检测逻辑：
- 统计功能点表中节点类型分布（action/page/form）
- 当存在 form 类型或嵌套 ≥3 层的模块树时标记 `complexLogicDetected = true`
- 质量门问题：当检测到复杂逻辑时在 `qualityGateIssues` 中添加建议

#### FIX-4: SessionCapableEngine 接口统一导出
**文件**: `packages/stage-login/src/index.ts`, `packages/stage-explore/src/index.ts`, `packages/engine-mcp/src/types.ts`
**问题**: `SessionCapableEngine` 在两个 stage 中独立定义为结构类型
**修复**:
- 在 `engine-mcp/src/types.ts` 中导出 `SessionCapableEngine` 接口（扩展 `McpEngine` + 4 个会话方法）
- `stage-login` 和 `stage-explore` 改为从 `engine-mcp` 导入
- 更新 `engine-mcp` 的 `index.ts` 导出

#### FIX-5: MCP Adapter 会话方法语义修复
**文件**: `packages/engine-mcp/src/mcp-adapter.ts`
**问题**:
- `getSessionHeaders()` 只返回 Authorization header，丢失其他鉴权头
- `getSessionTokens()` 返回 localStorage 全部值（可能含非 token 数据）
**修复**:
- `getSessionHeaders()`: 增加从 localStorage 读取 token 并构造 Authorization header 的逻辑
- `getSessionTokens()`: 过滤返回值，只保留含 `token`/`auth`/`jwt` 关键词的值
- `applySession()`: 增加 header 注入到 localStorage 的逻辑

### 🟡 P1 — 影响质量但不阻塞流程

#### FIX-6: infra-ai AIVendor 枚举对齐文档
**文件**: `packages/infra-ai/src/index.ts`
**问题**: 当前 `'openai' | 'azure' | 'anthropic' | 'local' | 'custom'` 缺少文档列出的 `google`、`deepseek`、`qwen`、`zhipu`
**修复**: 扩展为 `'openai' | 'azure' | 'anthropic' | 'google' | 'deepseek' | 'qwen' | 'zhipu' | 'local' | 'custom'`

#### FIX-7: stage-explore 文件拆分为 ≤300 行
**文件**: `packages/stage-explore/src/index.ts` (301行)
**问题**: 超出主规格 §13 规定的 300 行上限
**修复**:
- 提取 `mergeManualSupplement` 到 `packages/stage-explore/src/merge.ts`
- 提取 `computeCoverage`/`computeNeedsReview`/`buildCheckpoint`/`mergeCheckpoint` 到 `packages/stage-explore/src/checkpoint.ts`
- 主入口 `index.ts` 保留 `run` 函数和必要的导入

#### FIX-8: mcp-adapter 类型安全修复
**文件**: `packages/engine-mcp/src/mcp-adapter.ts`
**问题**: 多处 `(cmd as any)` 绕过类型检查
**修复**: 使用类型守卫/判别联合代替 `as any`：
- 为 `BrowserCommand` 的每个 kind 创建类型守卫
- 或使用 `switch` 分支内收窄类型

#### FIX-9: 补充缺失的 README 文件
**文件**: 
- `packages/stage-login/README.md` (新建)
- `packages/stage-explore/README.md` (新建)
- `packages/stage-feature/README.md` (新建)
- `packages/stage-case/README.md` (新建)
- `packages/stage-defect/README.md` (新建)
**问题**: 主规格 §13 要求每目录有 README.md
**修复**: 参照已有 `infra-*/README.md` 和 `engine-mcp/README.md` 模板创建，包含职责、接口、示例、依赖关系

#### FIX-10: 补充文件头 TSDoc 注释
**文件**: 
- `packages/contracts/src/index.ts` (补充 `@contract` 标签)
- `packages/stage-feature/src/provenance.ts` (补充 `@contract` 标签)
- `packages/stage-execute/src/constants.ts` (补充 `@contract` 标签)
**问题**: 缺少 `@contract` 标签
**修复**: 添加标准文件头注释

### 🟢 P2 — 优化改进（可选）

#### FIX-11: 功能点表列宽常量
**文件**: `packages/contracts/src/types/FeatureRow.ts`
**问题**: 功能点表（九列）未定义列宽常量
**修复**: 添加 `FEATURE_COLUMN_WIDTHS: number[]` 常量

#### FIX-12: 需求章节列真实数据
**文件**: `packages/stage-feature/src/featureTable.ts`
**问题**: `requirementSection` 使用 `X.Y.Z` 占位符
**修复**: 预留 `requirementSection` 字段在 `FeatureInput` 中，当有真实数据时使用，否则回退占位符

## 执行步骤

### Phase 1: 修复契约层 (contracts)
1. FIX-1: 更新 LoginSchema 条件校验
2. FIX-10: 补充 TSDoc 注释
3. FIX-11: 添加功能点表列宽常量

### Phase 2: 修复基础设施层 (engine-mcp)
4. FIX-4: 在 engine-mcp 导出 SessionCapableEngine
5. FIX-5: 修复 MCP Adapter 会话方法语义
6. FIX-8: mcp-adapter 类型安全修复

### Phase 3: 修复 Stage 层
7. FIX-2: 功能点表「功能点」与「测试点」区分
8. FIX-3: complexLogicDetected 基础实现
9. FIX-4 (续): stage-login/stage-explore 改用共享接口
10. FIX-6: infra-ai AIVendor 枚举对齐
11. FIX-7: stage-explore 文件拆分

### Phase 4: 文档与规范
12. FIX-9: 补充 README 文件
13. FIX-12: 需求章节预留真实数据入口

### Phase 5: 验证
14. 运行所有 verify 测试，确保通过率 100%
15. 检查 TypeScript 编译无错误
16. 检查 ESLint 规则合规

## 风险与注意事项

1. **LoginInput 条件校验**: zod 的 `.refine()` 可能增加 schema 复杂度。建议使用原生 TypeScript 类型守卫 + zod 双层校验。
2. **功能点表区分**: 功能点/测试点的区分逻辑需要从 ModuleNode 向上遍历一层，增加了复杂度。如果测试中没有验证此区别，可先实现最小版本。
3. **SessionCapableEngine 提取**: 需确保 engine-mcp 的导出路径正确，且不改变现有 API 兼容性。
4. **stage-explore 拆分**: 提取函数到独立文件时需保持原有的导出不变，避免破坏 stage-login 等消费方。
5. **测试回归**: 所有修改完成后必须运行 `pnpm verify` 确保所有包测试通过。

## 不在本次范围

- app 包的前端代码优化
- GUI/Electron 相关调整
- 新增功能（如 AI 辅助生成、Excel 导出等）
- 文档内容的大幅修订
