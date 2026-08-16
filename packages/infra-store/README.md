# @test-platform/infra-store

## 职责说明

持久化层包，负责将业务数据**外部化落库**，避免项目/系统/功能点/用例/执行结果与代码工作空间耦合。

核心职责：
- 项目（Project）的增删改查
- 系统激活态管理（setActiveSystem）
- 功能点表（FeatureRow[][]）落库与读取
- 用例表（CaseSheet[]）落库与读取
- 执行结果（ExecutionResult[]）落库与读取

## 接口文档

`ProjectStore` 接口（冻结 v1.0，不可增删改方法签名）：

| 方法 | 签名 | 说明 |
|---|---|---|
| `createProject` | `(input: NewProjectInput) => Promise<Project>` | 创建新项目，返回完整 Project（含自动生成的 id、createdAt、updatedAt） |
| `listProjects` | `() => Promise<ProjectSummary[]>` | 列出所有项目摘要（含 systemCount） |
| `getProject` | `(id: string) => Promise<Project \| null>` | 按 ID 查询项目，不存在返回 null |
| `updateProject` | `(id: string, patch: Partial<Project>) => Promise<Project>` | 部分更新项目字段，自动刷新 updatedAt；项目不存在抛错 |
| `deleteProject` | `(id: string) => Promise<void>` | 删除项目及其关联数据 |
| `setActiveSystem` | `(projectId: string, systemId: string) => Promise<void>` | 激活项目下的指定系统；系统未归属该项目时抛错 |
| `saveFeatureTable` | `(systemId: string, table: FeatureRow[][]) => Promise<void>` | 保存功能点表 |
| `saveCaseTable` | `(systemId: string, sheets: CaseSheet[]) => Promise<void>` | 保存用例表（多 Sheet） |
| `saveExecution` | `(systemId: string, report: ExecutionResult[]) => Promise<void>` | 保存执行报告 |
| `getFeatureTable` | `(systemId: string) => Promise<FeatureRow[][] \| null>` | 读取功能点表，不存在返回 null |
| `getCaseTable` | `(systemId: string) => Promise<CaseSheet[] \| null>` | 读取用例表，不存在返回 null |
| `getExecution` | `(systemId: string) => Promise<ExecutionResult[] \| null>` | 读取执行报告，不存在返回 null |

### 类型定义

```ts
// 新建项目输入
interface NewProjectInput {
  name: string;
  description?: string;
  type?: SystemType;       // 'portal' | 'standalone' | 'subsystem'
  logRetentionDays?: number;
  aiAssistEnabled?: boolean;
}

// 项目摘要（列表用）
interface ProjectSummary {
  id: string;
  name: string;
  systemCount: number;
  updatedAt: number;
}
```

## 使用示例

```ts
import { createStore } from '@test-platform/infra-store';

const store = createStore();

// 1. 创建项目
const project = await store.createProject({ name: '区域影像测试项目' });
const projectId = project.id;

// 2. 保存功能点表
const featureTable = [
  ['1', '功能性测试', '3.1', '区域影像系统', '检查室管理', '检查室', '查询', '查询', 'QYYX_PZ_JCX_01']
];
await store.saveFeatureTable(projectId, featureTable);

// 3. 读取功能点表
const loaded = await store.getFeatureTable(projectId);
console.log(loaded); // featureTable

// 4. 保存用例表
await store.saveCaseTable(projectId, [{ sheetName: '检查室', meta: {...}, rows: [...] }]);

// 5. 保存执行结果
await store.saveExecution(projectId, [{ caseNo: 'QYYX_PZ_JCX_01', status: 'passed', ... }]);

// 6. 列出项目
const projects = await store.listProjects();

// 7. 删除项目
await store.deleteProject(projectId);
```

## 实现说明

当前为**内存实现**（`InMemoryProjectStore`），数据存储在 Map 中，进程重启即丢失。

后续可替换为 SQLite / 文件存储 / 远程数据库，只需实现 `ProjectStore` 接口，调用方无需修改。

工厂函数 `createStore()` 封装了实现切换逻辑：
```ts
export function createStore(): ProjectStore {
  return new InMemoryProjectStore();
  // 后续: return new SqliteProjectStore(dbPath);
}
```

## 依赖说明

| 依赖 | 用途 |
|---|---|
| `@test-platform/contracts` | 提供冻结类型：`Project`、`FeatureRow`、`CaseSheet`、`ExecutionResult`、`SystemType` |
| `node:crypto` | `randomUUID()` 生成项目 ID |

---

## 迭代指南

### 7.1 扩展点

#### 切换到持久化存储
实现新的 Store 类并修改工厂函数：
```ts
export function createStore(): ProjectStore {
  return new SqliteProjectStore(dbPath);
}
```

可选存储方案：
- **SQLite**：轻量级嵌入式数据库，适合桌面应用
- **文件存储**：JSON 文件落库，简单但性能有限
- **远程数据库**：PostgreSQL/MySQL，适合多用户场景

#### 添加数据迁移
在切换存储实现时，提供数据迁移脚本，确保数据格式兼容。

### 7.2 常见修改场景

#### 扩展项目字段
在 `Project` 接口中添加新字段，同时更新 `NewProjectInput` 和 `ProjectSummary`。

#### 添加数据版本号
在存储的数据中添加版本号字段，便于后续格式迁移。

### 7.3 测试要点
- CRUD 操作正确性测试
- 并发访问测试
- 数据隔离性测试
- 大数据量性能测试

### 7.4 注意事项
- **接口冻结**：`ProjectStore` 接口已冻结，修改需新增接口而非修改现有方法
- **数据一致性**：确保 CRUD 操作的原子性
- **性能优化**：对频繁访问的数据考虑缓存策略
- **备份恢复**：生产环境应有定期备份机制