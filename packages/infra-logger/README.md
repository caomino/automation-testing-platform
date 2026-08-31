# @test-platform/infra-logger

## 职责说明

外部日志基础设施层，负责业务/运行日志的外部化存储。日志不落项目工作空间，统一写入外部目录。

- 日志以 JSON-lines 格式（一行一条 JSON）写入指定目录
- 支持按 `level` / `scope` / `since` 时间戳过滤查询
- 支持日志文件滚动（单文件超限时自动轮转，保留历史归档）
- 支持按保留天数（`retentionDays`）清理过期日志文件

## 接口文档

### Logger 接口

| 方法 | 签名 | 说明 |
|------|------|------|
| `info` | `(scope: string, message: string, meta?: unknown) => void` | 写入 `info` 级别日志 |
| `warn` | `(scope: string, message: string, meta?: unknown) => void` | 写入 `warn` 级别日志 |
| `error` | `(scope: string, message: string, meta?: unknown) => void` | 写入 `error` 级别日志 |
| `query` | `(filter?: QueryFilter) => LogEntry[]` | 同步查询日志条目，按时间戳升序返回 |
| `flush` | `() => Promise<void>` | 等待所有待写入操作完成 |
| `cleanup` | `() => Promise<number>` | 清理过期日志文件，返回删除数量 |

### 类型定义

```typescript
type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  ts: number;        // 写入时间戳（毫秒）
  level: LogLevel;   // 日志级别
  scope: string;     // 业务域/模块标识
  message: string;   // 日志消息（超长自动截断至 10000 字符）
  meta?: unknown;    // 可选的结构化元数据
}

interface LoggerConfig {
  dir: string;           // 日志目录（外部化路径）
  retentionDays: number; // 保留天数，超过此天数的文件将被 cleanup 删除
  maxFileSize?: number;  // 单文件上限（字节），超限自动轮转
}

interface QueryFilter {
  scope?: string;   // 按业务域精确匹配
  level?: LogLevel; // 按级别精确匹配
  since?: number;   // 只返回 ts >= since 的条目
}
```

## 使用示例

```typescript
import { createLogger } from '@test-platform/infra-logger';

const logger = createLogger({
  dir: 'D:/test-platform-data/logs',
  retentionDays: 7,
  maxFileSize: 10 * 1024 * 1024, // 10 MB
});

// 写入日志
logger.info('test-runner', 'Test suite started', { suiteId: 's-001' });
logger.warn('test-runner', 'Slow test detected', { testId: 't-042', duration: 5000 });
logger.error('executor', 'Connection failed', { host: 'localhost', port: 3306 });

// 等待写入完成
await logger.flush();

// 查询日志
const errors = logger.query({ level: 'error' });
const sinceTs = Date.now() - 60_000;
const recent = logger.query({ since: sinceTs });

// 清理过期文件
const deleted = await logger.cleanup();
console.log(`Cleaned up ${deleted} expired log files`);
```

## 依赖说明

- Node.js `node:fs` / `node:fs/promises` — 文件系统读写、目录遍历、文件元信息
- Node.js `node:path` — 路径拼接
- `zod` — 配置校验（`LoggerConfig` 可配合 zod schema 做运行时校验）

---

## 7. 迭代指南

### 7.1 扩展点

#### 扩展日志级别
在 `LogLevel` 类型中添加新的级别：
```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
```

#### 新增过滤维度
扩展 `QueryFilter` 接口，支持更多过滤条件：
```typescript
interface QueryFilter {
  scope?: string;
  level?: LogLevel;
  since?: number;
  customField?: string;  // 新增自定义过滤字段
}
```

#### 更换存储后端
实现新的日志存储 Provider（如远程日志服务），在 `createLogger()` 工厂函数中切换。

### 7.2 常见修改场景

#### 调整日志格式
修改日志写入逻辑，调整 JSON 字段顺序或添加新字段。

#### 实现日志归档
在 `cleanup()` 方法中，将过期日志文件移动到归档目录而非直接删除。

### 7.3 测试要点
- 日志写入正确性测试
- 查询过滤准确性测试
- 文件滚动行为测试
- 过期清理逻辑测试

### 7.4 注意事项
- **性能影响**：高频日志写入应考虑异步处理
- **磁盘空间**：监控日志目录大小，避免磁盘满
- **日志脱敏**：敏感信息不应出现在日志中
- **时钟同步**：分布式环境中注意时间戳一致性