# 日志管理模块实现计划

## 一、现状调研结论

### 1.1 存放日志的位置确认

根据代码和规格文档分析：

| 层级 | 文件 | 日志位置说明 |
|------|------|------------|
| **基础设施层** | `packages/infra-logger/src/index.ts` | `LoggerConfig.dir` 字段指定日志目录。README 示例值为 `D:/test-platform-data/logs` |
| **编排器层** | `packages/orchestrator/src/index.ts` (L96) | 默认 `dir: './logs'`，可通过 `OrchestratorConfig.loggerConfig.dir` 自定义 |
| **规格文档** | `docs/自动化测试平台-主规格.md` (L221-222) | 日志落点：`${LOG_DIR}` 优先；否则 OS 标准应用数据目录；不放项目内 `logs/` |
| **当前实际路径** | 代码中 | 默认 `./logs`（项目根目录下），**未按规格要求外部化** |

**结论**：日志目前存放在 `d:\newTest\logs\` 目录下。这是因为 orchestrator 初始化时默认 `dir: './logs'`，实际运行时相对路径解析到当前工作目录。

**问题**：当前实现未遵循规格文档"不污染项目"的原则，日志应存放到外部目录（如 `D:/test-platform-data/logs` 或 Electron `userData` 目录）。

### 1.2 日志管理模块功能现状

| 组件 | 文件 | 现状 |
|------|------|------|
| 日志基础设施 | `packages/infra-logger/src/index.ts` | ✅ 已实现完整的 `FileLogger`：JSON-lines 写入、文件滚动、查询、过期清理 |
| 编排器集成 | `packages/orchestrator/src/index.ts` | ✅ 已集成 `Logger` 实例，贯穿 pipeline 各阶段 |
| 日志管理 UI | `packages/app/src/screens/Logs.tsx` | ⚠️ 有完整页面 UI，但 **Action 仅做状态模拟**，未调用真实后端 |
| 日志状态管理 | `packages/app/src/context.tsx` | ⚠️ `logPolicy`/`logFiles` 为内存状态，`LOG_CLEANUP_EXPIRED` 只截取前3条，`LOG_CLEAR_ALL` 只清空数组 |
| API 层 | `packages/app/src/services/dataApi.ts` | ❌ **没有日志管理相关 API**（无 listLogs / cleanupLogs / clearAllLogs / updateLogPolicy） |

### 1.3 需要修改的范围

1. **`packages/app/src/services/dataApi.ts`** — 新增日志管理 API 方法
2. **`packages/app/src/context.tsx`** — 将日志管理 action 从内存模拟改为调用真实 API
3. **`packages/app/src/screens/Logs.tsx`** — 增加日志目录路径显示，增强功能反馈
4. **`packages/orchestrator/src/index.ts`** — 暴露日志管理接口（listFiles/deleteFile/clearAll）
5. **`packages/infra-logger/src/index.ts`** — 新增日志文件列表查询和删除单个文件能力

---

## 二、修改计划

### 步骤 1：扩展 `infra-logger` — 新增日志文件管理能力

**文件**: `packages/infra-logger/src/index.ts`

**新增接口**:
- `listLogFiles()`: 返回当前日志目录下所有日志文件的元信息（文件名、大小、最后写入时间）
- `deleteLogFile(filename: string)`: 删除指定日志文件
- `clearAllLogs()`: 清空所有日志文件

**修改 `FileLogger` 类**，实现上述方法。

**修改 `Logger` 接口**，增加这三个方法声明。

### 步骤 2：扩展 `orchestrator` — 暴露日志管理接口

**文件**: `packages/orchestrator/src/index.ts`

在 `PipelineOrchestrator` 类中新增：
- `listLogFiles()`: 代理调用 logger.listLogFiles()
- `deleteLogFile(filename: string)`: 代理调用 logger.deleteLogFile()
- `clearAllLogs()`: 代理调用 logger.clearAllLogs()
- `getLogDir()`: 返回当前日志目录路径

### 步骤 3：扩展 `dataApi` — 新增日志管理 API

**文件**: `packages/app/src/services/dataApi.ts`

新增 API 方法：
- `listLogs()`: GET `/api/logs` — 获取日志文件列表
- `cleanupExpiredLogs()`: POST `/api/logs/cleanup` — 清理过期日志
- `clearAllLogs()`: DELETE `/api/logs` — 清空全部日志
- `deleteLogFile(filename)`: DELETE `/api/logs/:filename` — 删除单个日志文件
- `updateLogPolicy(policy)`: PUT `/api/logs/policy` — 更新保留策略
- `getLogDir()`: GET `/api/logs/dir` — 获取日志存储目录

### 步骤 4：改造 `context.tsx` — 日志管理 Action 对接真实 API

**文件**: `packages/app/src/context.tsx`

将以下 mock action 改为调用 `dataApi` 真实接口：

| Action | 当前（Mock） | 改造后（真实） |
|--------|-------------|---------------|
| `LOG_UPDATE_POLICY` | 仅更新内存状态 | 调用 `dataApi.updateLogPolicy()` 持久化 |
| `LOG_CLEANUP_EXPIRED` | `logFiles.slice(0, 3)` | 调用 `dataApi.cleanupExpiredLogs()`，再刷新列表 |
| `LOG_CLEAR_ALL` | `logFiles: []` | 调用 `dataApi.clearAllLogs()`，再刷新列表 |
| `LOG_REMOVE_FILE` | 从数组移除 | 调用 `dataApi.deleteLogFile()`，再刷新列表 |

新增：
- `logListFiles()`: 从后端获取最新日志文件列表
- `logGetDir()`: 获取日志存储目录路径
- `logPolicy` 持久化到后端

### 步骤 5：增强 `Logs.tsx` 页面

**文件**: `packages/app/src/screens/Logs.tsx`

增强内容：
1. 在页面顶部显示"日志存储位置"路径（从 `getLogDir` API 获取）
2. 页面加载时自动调用 `logListFiles()` 获取真实文件列表
3. `logCleanupExpired` / `logClearAll` / `logRemoveFile` 操作完成后刷新列表
4. 保存策略时调用 API 持久化

---

## 三、潜在依赖与风险

| 风险 | 说明 | 应对 |
|------|------|------|
| **后端服务对接** | `dataApi` 基于 HTTP `/api/store` 调用，需要后端对应实现日志管理路由 | 当前 app 使用 `pipelineMode: 'real'`，后端服务需提供 `/api/logs` 路由。如后端尚未实现，可在前端先做 mock fallback |
| **日志目录外部化** | 当前日志存放在项目内 `./logs`，不符合规格"外部化"要求 | 在 orchestrator 初始化时将默认路径改为 `D:/test-platform-data/logs` 或读取环境变量 `LOG_DIR` |
| **文件系统操作权限** | 删除/清空日志需要文件系统权限 | `infra-logger` 已用 `node:fs/promises` 实现，需确保运行时有权限 |
| **LogPolicy 持久化** | 保留策略配置需要持久化存储 | 可扩展 `infra-store` 或使用 JSON 配置文件保存 |

---

## 四、建议的日志存储位置

按照规格文档要求，推荐日志存放路径：

```
D:/test-platform-data/logs/
```

或通过环境变量 `LOG_DIR` 配置。若为 Electron 应用，则使用 `app.getPath('userData') + '/logs'`。

**在 `orchestrator` 初始化时修改默认配置**：
```typescript
const loggerConfig = {
  dir: process.env.LOG_DIR || 'D:/test-platform-data/logs',
  retentionDays: 30,
  maxFileSize: 10 * 1024 * 1024, // 10 MB
};
```