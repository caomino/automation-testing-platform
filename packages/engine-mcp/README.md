# @test-platform/engine-mcp

> 企业管理系统自动化测试平台 — 浏览器引擎包

## 职责

engine-mcp 是测试平台的**浏览器执行引擎**，核心职责有三：

1. **Playwright 单例可见浏览器**：封装 Chromium 启动、导航、点击、填充、截图等原子操作，所有 stage 通过 `McpEngine` 接口控制同一浏览器实例。
2. **DOM 语义抽象**：将原始 HTML DOM 遍历为框架无关的 `SemanticNode` 语义节点树（70 项矩阵），屏蔽 Vue/React/jQuery 差异，向上层提供统一的 `role / text / label / 位置识别` 访问方式。
3. **会话复用**：提供 `getSessionCookies / getSessionHeaders / getSessionTokens / applySession` 四方法，实现门户登录会话在跨子系统间的无损复用。

---

## DOM 语义抽象 70 项矩阵

引擎内置的 `DOM_WALK` 脚本在浏览器内执行，将任意框架的 DOM 转换为语义节点树。核心覆盖能力：

| 能力维度 | 说明 |
|---------|------|
| **框架无关** | 只读标准 HTML 语义，不依赖 Vue/React/jQuery |
| **role 识别** | 读取 `aria-role` / `role` 属性，识别自定义交互角色 |
| **text 提取** | 截取 `textContent` 前 200 字作为可见文本 |
| **label 识别** | 合并 `name` / `aria-label` / `title` 作为节点标识 |
| **位置识别** | 兜底使用标签层级路径（最多 4 层）生成稳定 selector |
| **iframe 处理** | 支持 `rootSelector` 参数指定局部 DOM 子树遍历 |
| **Shadow DOM** | 通过 `rootSelector` 选择器定位 Shadow Host 后展开内部结构 |
| **交互识别** | `interactiveTags`（A/BUTTON/INPUT/SELECT/TEXTAREA/SUMMIT）+ `role` + `onclick` 三策略 |
| **数据控件标记** | 自动标记 `input/textarea/提交按钮` 为 `isDataControl`，供只读模式红线判定 |
| **稳定选择器** | `id` 优先 → `data-testid / data-id / data-key / name` → 位置路径，三级降级 |

---

## 接口文档

### `McpEngine` 接口

所有浏览器控制能力通过 `McpEngine` 接口暴露，实现类为 `PlaywrightEngine`。

#### 生命周期

| 方法 | 说明 |
|------|------|
| `launch()` | 启动 Chromium 浏览器，创建上下文和页面 |
| `close()` | 关闭浏览器实例，释放资源 |

#### 导航与 DOM

| 方法 | 说明 |
|------|------|
| `navigate(url)` | 导航到指定 URL（`waitUntil: domcontentloaded`） |
| `extractSemanticDom(rootSelector?)` | 抓取当前页语义化节点树，可选局部选择器 |
| `exploreModules()` | 探索当前页模块树（容器→module、交互叶子→action/page） |

#### 命令执行

| 方法 | 说明 |
|------|------|
| `runStep(cmd)` | 执行单条 `BrowserCommand`（navigate/click/fill/select/press/wait/screenshot/dom） |
| `runCase(row)` | 执行一条测试用例行，基于操作文本语义匹配节点并执行点击 |
| `screenshot(path)` | 全页截图，返回 `ScreenshotRef` |

#### 会话复用（四方法）

| 方法 | 说明 |
|------|------|
| `getSessionCookies()` | 提取当前会话所有 Cookie，返回 `name=value` 字符串数组 |
| `getSessionHeaders()` | 提取当前会话鉴权请求头（Authorization / X-Token / X-Auth-Token / X-CSRF-Token），扫描文档 `<meta>` 标签 |
| `getSessionTokens()` | 提取 localStorage / sessionStorage 中的 token（token / accessToken / authToken / Authorization） |
| `applySession(state)` | 将 `{ cookies, headers?, tokens? }` 注入当前浏览器上下文，实现跨子系统会话复用 |

---

## 会话复用详解

### 问题背景

企业管理系统通常由多个子系统组成（如门户、OA、HR、财务），用户在门户登录后，其他子系统通过 Cookie/Token 共享登录态。测试时如果每个子系统都需要重新登录，会导致：
- 测试效率低（重复登录耗时）
- 登录风控可能触发（频繁登录失败）
- 跨子系统业务流程无法串联验证

### 会话复用闭环

```
门户登录 → getSessionCookies/Headers/Tokens → 传输会话数据 → applySession → 子系统直接操作
```

#### `getSessionCookies()`

- **用途**：捕获登录后浏览器上下文中的所有 Cookie
- **格式**：`['JSESSIONID=abc123', 'USER_ID=42', ...]`
- **场景**：门户登录后，将 Cookie 注入到 OA、HR 等子系统的浏览器上下文

#### `getSessionHeaders()`

- **用途**：提取页面 `<meta>` 标签中存储的鉴权头（SPA 应用常用）
- **扫描键**：`Authorization`, `X-Token`, `X-Auth-Token`, `X-CSRF-Token`
- **场景**：前后端分离架构中，Token 通过 meta 标签传递给前端 JS

#### `getSessionTokens()`

- **用途**：提取 localStorage / sessionStorage 中存储的 Token
- **扫描键**：`token`, `accessToken`, `authToken`, `Authorization`
- **场景**：SPA 应用将 Token 存储在浏览器存储中，用于后续 API 请求

#### `applySession(state)`

- **用途**：将会话数据注入到新的浏览器上下文
- **参数**：`{ cookies: string[], headers?: Record<string, string>, tokens?: string[] }`
- **行为**：
  - Cookies 通过 `context.addCookies()` 注入
  - Tokens 通过 `localStorage.setItem()` 注入
  - 注入失败时静默忽略（如 `about:blank` 无 localStorage）

---

## 只读探索模式

当 `EngineConfig.readOnly = true` 时：

- `fill` / `select` / `press` 三种写操作命令不会实际执行
- 引擎直接返回 `result: 'skipped'`，`actual: '只读模式禁止写操作'`
- 适用于**探索阶段**：只允许点击、导航、截图，禁止任何数据写入
- 这是测试平台的核心安全红线，防止探索阶段误操作生产数据

---

## 使用示例

### 基础用法

```typescript
import { createEngine, type EngineConfig } from '@test-platform/engine-mcp';

const config: EngineConfig = {
  headless: true,
  viewport: { width: 1366, height: 768 },
  timeoutMs: 30000,
};

const engine = createEngine(config);
await engine.launch();
await engine.navigate('https://portal.example.com');

// 提取语义 DOM
const dom = await engine.extractSemanticDom();

// 执行命令
const result = await engine.runStep({ kind: 'click', selector: '#login-btn' });
await engine.runStep({ kind: 'fill', selector: '#username', value: 'admin' });
await engine.runStep({ kind: 'fill', selector: '#password', value: '***' });
await engine.runStep({ kind: 'press', selector: '#login-btn', key: 'Enter' });

await engine.close();
```

### 会话复用

```typescript
// 1. 门户登录后捕获会话
await portalEngine.navigate('https://portal.example.com');
await portalEngine.runStep({ kind: 'fill', selector: '#user', value: 'admin' });
await portalEngine.runStep({ kind: 'click', selector: '#login' });

const cookies = await portalEngine.getSessionCookies();
const headers = await portalEngine.getSessionHeaders();
const tokens = await portalEngine.getSessionTokens();

// 2. 注入到子系统
await subsystemEngine.launch();
await subsystemEngine.applySession({ cookies, headers, tokens });
await subsystemEngine.navigate('https://oa.example.com/dashboard');
// 已自动登录，直接操作
```

### 只读探索模式

```typescript
const engine = createEngine({ headless: true, readOnly: true });
await engine.launch();
await engine.navigate('https://portal.example.com');

// 以下命令会返回 skipped
await engine.runStep({ kind: 'fill', selector: '#user', value: 'admin' });
// → result: 'skipped', actual: '只读模式禁止写操作'

// 点击和导航不受影响
await engine.runStep({ kind: 'click', selector: '.menu-item' });
```

---

## 依赖说明

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@test-platform/contracts` | workspace:* | 提供 `ModuleNode` / `CaseRow` / `ExecutionStepResult` / `ScreenshotRef` 类型 |
| `playwright` | ^1.49.0 | 浏览器自动化核心，Chromium 控制 |
| `zod` | ^3.23.8 | 运行时类型校验（间接使用） |
| `typescript` | ^5.7.2 | 开发依赖，编译 |
| `vitest` | ^2.1.8 | 开发依赖，单元/验证测试 |

---

## 7. 迭代指南

### 7.1 扩展点

#### 新增浏览器引擎类型
实现 `McpEngine` 接口，创建新的引擎类：
```typescript
class CustomEngine implements McpEngine {
  // 实现所有接口方法
}
```

#### 扩展 DOM 语义抽象
修改 `snapshot-converter.ts` 中的 DOM_WALK 脚本，添加新的语义节点属性。

#### 新增会话字段
在 `SessionHandle` 类型中添加可选字段，并在 `getSessionHeaders()` / `getSessionTokens()` 方法中添加提取逻辑。

#### 扩展命令类型
在 `BrowserCommand` 联合类型中添加新的命令类型，并在 `runStep()` 方法中添加处理逻辑。

### 7.2 常见修改场景

#### 修改只读模式行为
调整 `readOnly` 配置下的命令过滤逻辑，在 `runStep()` 方法中修改过滤条件。

#### 添加新的选择器策略
修改 `snapshot-converter.ts` 中的选择器生成逻辑，添加新的优先级规则。

#### 扩展超时配置
在 `EngineConfig` 中添加新的超时相关配置项，并在各方法中使用。

### 7.3 测试要点
- 引擎生命周期测试（launch/close）
- DOM 语义抽象正确性测试
- 会话复用闭环测试
- 只读模式行为测试
- 命令执行正确性测试

### 7.4 注意事项
- **接口兼容性**：`McpEngine` 接口已冻结，修改需谨慎
- **资源清理**：确保引擎实例在使用后正确关闭
- **超时处理**：所有耗时操作都应有超时保护
- **错误恢复**：引擎异常后应能正常恢复