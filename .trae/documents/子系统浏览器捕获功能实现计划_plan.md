# 子系统浏览器捕获功能实现计划

## 1. 需求分析

### 1.1 当前问题
- **位置**：项目管理 → 子系统类型 → "📡 打开浏览器捕获"按钮
- **现状**：点击按钮仅显示 toast 提示，无实际功能
- **影响**：子系统无法通过浏览器捕获获取 URL 和会话信息

### 1.2 目标功能
根据《自动化测试平台-主规格 v1.5 §18.2》：
> 子系统 URL 经父门户浏览器捕获

**完整流程**：
1. 用户选择父门户系统
2. 点击"打开浏览器捕获"
3. 系统通过 `@playwright/mcp` 服务启动浏览器，导航到父门户 URL
4. 用户在浏览器中完成登录并导航到子系统页面
5. 系统通过 MCP 协议自动捕获当前页面的 URL、标题、cookies、headers、tokens
6. 用户点击"完成捕获"
7. 捕获信息自动回填到子系统表单

### 1.3 数据模型

```typescript
interface CaptureResult {
  capturedUrl: string;           // 捕获的子系统 URL
  capturedTitle: string;         // 页面标题
  cookies: string[];             // 会话 cookies
  headers: Record<string, string>; // 会话 headers
  tokens: string[];              // 会话 tokens
  navigationPath: string[];      // 导航路径
  capturedAt: number;           // 捕获时间
}
```

---

## 2. 技术方案

### 2.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                         前端 (App)                           │
├─────────────────────────────────────────────────────────────┤
│  ProjectMgmt.tsx                                            │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────┐  │
│  │ 打开浏览器    │──▶│ 轮询捕获状态      │──▶│ 回填子系统表单 │  │
│  │   捕获按钮    │   │ (polling API)    │   │              │  │
│  └─────────────┘   └──────────────────┘   └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP API
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      后端 (server.mjs)                       │
├─────────────────────────────────────────────────────────────┤
│  BrowserCaptureService                                      │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────┐  │
│  │ startCapture │──▶│ McpPlaywrightAdpt│──▶│ @playwright  │  │
│  │              │   │ (MCP 客户端)     │   │ /mcp 服务    │  │
│  └─────────────┘   └──────────────────┘   └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ MCP 协议 (stdio)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              @playwright/mcp (MCP Server)                    │
├─────────────────────────────────────────────────────────────┤
│  browser_navigate → browser_cookies → browser_snapshot → ... │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心技术点

#### 使用 @playwright/mcp 服务（而非直接 PlaywrightEngine）

**为什么使用 MCP 方式：**
1. 符合项目已有的架构设计（engine-mcp 包）
2. MCP 服务可以独立于主进程运行，更加稳定
3. 支持人工接管模式（manualTakeover），用户可以在可见浏览器中操作
4. 已有 McpPlaywrightAdapter 封装，无需重复开发

**McpPlaywrightAdapter 已实现的能力（mcp-adapter.ts）：**
- `launch()` - 通过 stdio 启动 @playwright/mcp 服务
- `navigate(url)` - 调用 `browser_navigate` 工具
- `runStep(cmd)` - 执行浏览器命令（click/fill/wait 等）
- `getSessionCookies()` - 获取会话 cookies
- `getSessionHeaders()` - 获取会话 headers
- `getSessionTokens()` - 获取会话 tokens
- `applySession()` - 注入会话状态
- `close()` - 关闭浏览器

#### 捕获会话状态机

```
idle → capturing → completing → completed
                  ↓
                cancelling → cancelled
                  ↓
                failed
```

### 2.3 实现策略

#### 后端新增 API

| API | 方法 | 说明 |
|-----|------|------|
| `/api/capture/start` | POST | 启动 MCP 浏览器捕获会话 |
| `/api/capture/status/:id` | GET | 查询捕获会话状态 |
| `/api/capture/complete/:id` | POST | 完成捕获，获取结果（从 MCP 获取 cookies/URL 等） |
| `/api/capture/cancel/:id` | POST | 取消捕获会话 |

#### 前端交互流程

1. 点击"打开浏览器捕获" → 调用 `startCapture` API
2. 后端通过 `McpPlaywrightAdapter` 启动 `@playwright/mcp` 服务
3. MCP 服务打开可见浏览器（headless: false），导航到父门户 URL
4. 前端启动轮询（1秒间隔）查询捕获状态
5. 用户在浏览器中完成登录和导航
6. 页面显示"捕获中..."提示，用户点击"完成捕获"
7. 后端通过 MCP 调用 `browser_cookies`、`browser_snapshot` 等获取当前状态
8. 获取捕获结果，回填表单

---

## 3. 文件修改清单

### 3.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `packages/orchestrator/src/browser-capture.ts` | 基于 McpPlaywrightAdapter 的浏览器捕获服务 |

### 3.2 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `server.mjs` | 新增捕获 API 路由（start/status/complete/cancel），集成 BrowserCaptureService |
| `packages/app/src/screens/ProjectMgmt.tsx` | 对接捕获流程 UI 和交互 |
| `packages/app/src/services/dataApi.ts` | 新增捕获 API 调用函数 |
| `packages/app/src/styles.css` | 捕获状态相关样式 |

### 3.3 可选修改

| 文件路径 | 说明 |
|---------|------|
| `packages/engine-mcp/src/types.ts` | 如需扩展 McpEngine 接口 |

---

## 4. 详细实现步骤

### 步骤 1：创建 BrowserCaptureService

**文件**：`packages/orchestrator/src/browser-capture.ts`

```typescript
import { createEngine, McpEngine, EngineConfig } from '@test-platform/engine-mcp';

export interface CaptureSession {
  id: string;
  status: 'idle' | 'capturing' | 'completing' | 'completed' | 'cancelling' | 'failed';
  portalUrl: string;
  systemId?: string;
  createdAt: number;
  capturedResult?: CaptureResult;
  error?: string;
}

export interface CaptureResult {
  capturedUrl: string;
  capturedTitle: string;
  cookies: string[];
  headers: Record<string, string>;
  tokens: string[];
  navigationPath: string[];
  capturedAt: number;
}

export class BrowserCaptureService {
  private sessions: Map<string, CaptureSession> = new Map();
  private engines: Map<string, McpEngine> = new Map();

  /**
   * 启动 MCP 浏览器捕获会话
   * 使用 @playwright/mcp 服务打开可见浏览器
   */
  async startCapture(portalUrl: string, systemId?: string): Promise<CaptureSession> {
    const sessionId = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // 创建引擎配置（使用 MCP 模式）
    const engineConfig: EngineConfig = {
      engineType: 'mcp',           // 关键：使用 MCP 模式
      headless: false,              // 可见浏览器，用户可操作
      manualTakeover: true,        // 人工接管模式
      mcpCommand: 'npx',
      mcpArgs: ['@playwright/mcp@latest'],
    };

    const engine = createEngine(engineConfig);
    
    try {
      // 启动 MCP 浏览器
      await engine.launch();
      await engine.navigate(portalUrl);

      const session: CaptureSession = {
        id: sessionId,
        status: 'capturing',
        portalUrl,
        systemId,
        createdAt: Date.now(),
      };

      this.sessions.set(sessionId, session);
      this.engines.set(sessionId, engine);

      return session;
    } catch (err) {
      // 清理
      await engine.close().catch(() => {});
      throw new Error(`启动 MCP 浏览器失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 查询捕获会话状态
   */
  getStatus(sessionId: string): CaptureSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * 完成捕获，从 MCP 浏览器获取当前状态
   */
  async completeCapture(sessionId: string): Promise<CaptureResult> {
    const session = this.sessions.get(sessionId);
    const engine = this.engines.get(sessionId);

    if (!session || !engine) {
      throw new Error('捕获会话不存在');
    }

    session.status = 'completing';

    try {
      // 通过 MCP 获取会话信息
      const cookies = await engine.getSessionCookies();
      const headers = await engine.getSessionHeaders();
      const tokens = await engine.getSessionTokens();

      // 获取当前页面 URL（通过 snapshot 或其他方式）
      // 注：MCP 的 browser_snapshot 返回页面信息
      let capturedUrl = '';
      let capturedTitle = '';
      
      try {
        const snapshot = await engine.extractSemanticDom();
        // 从 snapshot 或其他方式获取 URL
        capturedUrl = session.portalUrl; // 兜底
      } catch {
        capturedUrl = session.portalUrl;
      }

      const result: CaptureResult = {
        capturedUrl,
        capturedTitle,
        cookies,
        headers,
        tokens,
        navigationPath: [session.portalUrl],
        capturedAt: Date.now(),
      };

      session.status = 'completed';
      session.capturedResult = result;

      return result;
    } catch (err) {
      session.status = 'failed';
      session.error = err instanceof Error ? err.message : String(err);
      throw new Error(`捕获失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 取消捕获会话
   */
  async cancelCapture(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const engine = this.engines.get(sessionId);

    if (session) {
      session.status = 'cancelling';
    }

    if (engine) {
      await engine.close().catch(() => {});
      this.engines.delete(sessionId);
    }

    if (session) {
      session.status = 'cancelled';
    }
  }

  /**
   * 清理所有会话
   */
  async cleanup(): Promise<void> {
    for (const [sessionId, engine] of this.engines) {
      await engine.close().catch(() => {});
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'cancelled';
      }
    }
    this.engines.clear();
  }
}
```

### 步骤 2：修改 server.mjs

在现有 API 路由后新增浏览器捕获路由：

```javascript
// ===== 浏览器捕获 API =====
const captureService = new BrowserCaptureService();

if (req.method === 'POST' && req.url === '/api/capture/start') {
  try {
    const { portalUrl, systemId } = await readBody(req);
    if (!portalUrl) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, error: 'portalUrl is required' }));
    }
    const session = await captureService.startCapture(portalUrl, systemId);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, data: session }));
  } catch (err) {
    console.error('[capture] start error:', err.message);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

if (req.method === 'GET' && req.url.startsWith('/api/capture/status/')) {
  const sessionId = decodeURIComponent(req.url.split('/').pop());
  const status = captureService.getStatus(sessionId);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, data: status }));
}

if (req.method === 'POST' && req.url.startsWith('/api/capture/complete/')) {
  try {
    const sessionId = decodeURIComponent(req.url.split('/').pop());
    const result = await captureService.completeCapture(sessionId);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, data: result }));
  } catch (err) {
    console.error('[capture] complete error:', err.message);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

if (req.method === 'POST' && req.url.startsWith('/api/capture/cancel/')) {
  try {
    const sessionId = decodeURIComponent(req.url.split('/').pop());
    await captureService.cancelCapture(sessionId);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
```

### 步骤 3：修改 dataApi.ts

新增前端 API 调用（替换原有的 startRecording/stopRecording）：

```typescript
// ===== Browser Capture (MCP 浏览器捕获) =====

export interface CaptureSessionApi {
  id: string;
  status: 'idle' | 'capturing' | 'completing' | 'completed' | 'cancelling' | 'failed';
  portalUrl: string;
  systemId?: string;
  createdAt: number;
  capturedResult?: CaptureResultApi;
  error?: string;
}

export interface CaptureResultApi {
  capturedUrl: string;
  capturedTitle: string;
  cookies: string[];
  headers: Record<string, string>;
  tokens: string[];
  navigationPath: string[];
  capturedAt: number;
}

/** 启动 MCP 浏览器捕获 */
export async function startCapture(portalUrl: string, systemId?: string): Promise<CaptureSessionApi> {
  return apiCall('/capture/start', {
    method: 'POST',
    body: JSON.stringify({ portalUrl, systemId }),
  });
}

/** 查询捕获状态 */
export async function getCaptureStatus(sessionId: string): Promise<CaptureSessionApi | null> {
  return apiCall(`/capture/status/${encodeURIComponent(sessionId)}`);
}

/** 完成捕获，获取结果 */
export async function completeCapture(sessionId: string): Promise<CaptureResultApi> {
  return apiCall(`/capture/complete/${encodeURIComponent(sessionId)}`, { method: 'POST' });
}

/** 取消捕获 */
export async function cancelCapture(sessionId: string): Promise<void> {
  return apiCall(`/capture/cancel/${encodeURIComponent(sessionId)}`, { method: 'POST' });
}
```

### 步骤 4：修改 ProjectMgmt.tsx

实现捕获交互流程：

```typescript
// 新增导入
import { startCapture, getCaptureStatus, completeCapture, cancelCapture } from '../services/dataApi';

// 新增状态
const [captureSessionId, setCaptureSessionId] = useState<string | null>(null);
const [captureStatus, setCaptureStatus] = useState<'idle' | 'capturing' | 'completing' | 'completed' | 'failed'>('idle');
const [capturedResult, setCapturedResult] = useState<CaptureResultApi | null>(null);
const capturePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

// 启动浏览器捕获
const handleStartCapture = async () => {
  // 验证父门户
  const portal = systems.find(s => s.id === newSystem.parent || (editSystem && systems.find(s => s.id === editSystem.parent)));
  if (!portal) {
    toast('请先选择父门户系统');
    return;
  }
  if (!portal.url) {
    toast('父门户 URL 为空，请先配置父门户');
    return;
  }

  try {
    toast('正在启动 MCP 浏览器...');
    const session = await startCapture(portal.url, editSystem?.id || newSystem.id);
    setCaptureSessionId(session.id);
    setCaptureStatus('capturing');
    toast('✅ MCP 浏览器已打开，请在浏览器中完成登录和导航');
    
    // 启动轮询
    startCapturePolling(session.id);
  } catch (e: any) {
    toast(`❌ 启动失败: ${e.message}`);
  }
};

// 轮询捕获状态
const startCapturePolling = (sessionId: string) => {
  if (capturePollRef.current) {
    clearInterval(capturePollRef.current);
  }
  
  capturePollRef.current = setInterval(async () => {
    try {
      const status = await getCaptureStatus(sessionId);
      if (status) {
        setCaptureStatus(status.status);
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          if (capturePollRef.current) {
            clearInterval(capturePollRef.current);
            capturePollRef.current = null;
          }
        }
      }
    } catch {
      // 静默忽略轮询错误
    }
  }, 1000);
};

// 完成捕获
const handleCompleteCapture = async () => {
  if (!captureSessionId) return;
  
  try {
    setCaptureStatus('completing');
    toast('正在获取浏览器状态...');
    const result = await completeCapture(captureSessionId);
    setCapturedResult(result);
    setCaptureStatus('completed');
    
    // 回填表单
    if (editSystem) {
      setEditSystem({
        ...editSystem,
        captured: true,
        capturedUrl: result.capturedUrl,
        url: result.capturedUrl || editSystem.url,
        sessionState: {
          cookies: result.cookies,
          headers: result.headers,
          tokens: result.tokens,
        },
      });
    } else {
      setNewSystem({
        ...newSystem,
        captured: true,
        capturedUrl: result.capturedUrl,
        url: result.capturedUrl,
        sessionState: {
          cookies: result.cookies,
          headers: result.headers,
          tokens: result.tokens,
        },
      });
    }
    
    toast('✅ 捕获成功，已回填表单');
    
    // 清理状态
    setCaptureSessionId(null);
    if (capturePollRef.current) {
      clearInterval(capturePollRef.current);
      capturePollRef.current = null;
    }
  } catch (e: any) {
    toast(`❌ 完成捕获失败: ${e.message}`);
    setCaptureStatus('failed');
  }
};

// 取消捕获
const handleCancelCapture = async () => {
  if (!captureSessionId) return;
  
  try {
    await cancelCapture(captureSessionId);
    toast('已取消捕获');
  } catch (e: any) {
    toast(`取消失败: ${e.message}`);
  }
  
  setCaptureSessionId(null);
  setCaptureStatus('idle');
  setCapturedResult(null);
  if (capturePollRef.current) {
    clearInterval(capturePollRef.current);
    capturePollRef.current = null;
  }
};

// 修改"打开浏览器捕获"按钮点击事件
// 原实现（仅 toast）
// onClick={() => toast('📡 浏览器捕获功能开发中...')}
// 改为：
// onClick={handleStartCapture}

// UI 增强 - 捕获状态提示
{captureStatus === 'capturing' && (
  <div className="capture-hint">
    <div className="capture-hint-icon">🔴</div>
    <div className="capture-hint-content">
      <strong>MCP 浏览器已启动</strong>
      <span>请在浏览器中完成登录和导航，然后点击「完成捕获」</span>
    </div>
    <div className="capture-hint-actions">
      <Button size="sm" variant="pri" onClick={handleCompleteCapture}>完成捕获</Button>
      <Button size="sm" variant="gho" onClick={handleCancelCapture}>取消</Button>
    </div>
  </div>
)}

{captureStatus === 'completing' && (
  <div className="capture-hint capture-hint-loading">
    <div className="capture-hint-icon">⏳</div>
    <span>正在获取浏览器状态...</span>
  </div>
)}

{capturedResult && (
  <div className="captured-result">
    <div className="captured-result-header">
      <span className="captured-badge">✓ 已捕获</span>
      <span className="captured-time">{new Date(capturedResult.capturedAt).toLocaleString()}</span>
    </div>
    <div className="captured-result-row">
      <label>URL</label>
      <code>{capturedResult.capturedUrl || '(未捕获)'}</code>
    </div>
    <div className="captured-result-row">
      <label>Cookies</label>
      <span>{capturedResult.cookies.length} 条</span>
    </div>
    <div className="captured-result-row">
      <label>Headers</label>
      <span>{Object.keys(capturedResult.headers).length} 个</span>
    </div>
    <div className="captured-result-row">
      <label>Tokens</label>
      <span>{capturedResult.tokens.length} 个</span>
    </div>
  </div>
)}
```

### 步骤 5：修改 styles.css

```css
/* ===== 浏览器捕获状态样式 ===== */

.capture-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
  border: 1px solid #ffc107;
  border-radius: 8px;
  margin: 8px 0;
  font-size: 14px;
}

.capture-hint-loading {
  background: linear-gradient(135deg, #e1f5fe 0%, #b3e5fc 100%);
  border-color: #03a9f4;
}

.capture-hint-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.capture-hint-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.capture-hint-content strong {
  color: #856404;
}

.capture-hint-content span {
  color: #856404;
  font-size: 12px;
}

.capture-hint-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.captured-result {
  padding: 12px 16px;
  background: linear-gradient(135deg, #d4edda 0%, #c8e6c9 100%);
  border: 1px solid #28a745;
  border-radius: 8px;
  margin: 8px 0;
  font-size: 13px;
}

.captured-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed rgba(40, 167, 69, 0.3);
}

.captured-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #28a745;
  color: white;
  border-radius: 10px;
  font-size: 11px;
  font-weight: bold;
}

.captured-time {
  color: #6c757d;
  font-size: 11px;
}

.captured-result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
}

.captured-result-row label {
  min-width: 70px;
  color: #495057;
  font-weight: 500;
  font-size: 12px;
}

.captured-result-row code {
  flex: 1;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 4px;
  font-size: 11px;
  color: #495057;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

---

## 5. 关键配置说明

### 5.1 MCP 引擎配置

```typescript
const engineConfig: EngineConfig = {
  engineType: 'mcp',           // 使用 MCP 模式
  headless: false,              // 可见浏览器
  manualTakeover: true,        // 人工接管模式
  mcpCommand: 'npx',           // MCP 服务启动命令
  mcpArgs: ['@playwright/mcp@latest'], // MCP 服务包
};
```

### 5.2 依赖包

需要确保以下包已安装：
- `@modelcontextprotocol/sdk` - MCP SDK
- `@playwright/mcp` - Playwright MCP 服务
- `@playwright/test` - Playwright 核心

### 5.3 启动顺序

1. 确保 Node.js 环境正常
2. `npx @playwright/mcp@latest` 可以正常执行
3. 服务器启动时 BrowserCaptureService 初始化
4. 前端点击按钮 → 后端启动 MCP → 浏览器打开

---

## 6. 风险与应对

| # | 风险 | 概率 | 影响 | 应对措施 |
|---|------|------|------|---------|
| 1 | `@playwright/mcp` 安装/启动失败 | 中 | 高 | 添加错误提示 + fallback 到手动输入模式 |
| 2 | MCP 浏览器无法在 Windows 正常打开 | 中 | 高 | 检查 Playwright 浏览器安装状态 |
| 3 | MCP 协议连接超时 | 低 | 中 | 设置合理超时，提供重试 |
| 4 | 浏览器捕获的 URL 不准确 | 中 | 中 | 允许用户编辑已捕获的 URL |
| 5 | 会话 cookies 过期太快 | 低 | 高 | 提示用户尽快完成捕获 |
| 6 | 多个捕获会话冲突 | 低 | 中 | 限制同时只能有一个活跃捕获 |

---

## 7. 验证标准

### 7.1 环境验证
- [x] `npx @playwright/mcp@latest` 可正常执行
- [x] Playwright 浏览器已安装
- [x] Node.js 版本兼容

### 7.2 功能验证
- [ ] 点击"打开浏览器捕获"按钮，能正常启动 MCP 浏览器
- [ ] 浏览器导航到父门户 URL
- [ ] 用户在浏览器中完成登录和导航
- [ ] 点击"完成捕获"后，能正确获取 URL 和会话信息
- [ ] 捕获的信息自动回填到子系统表单
- [ ] 取消捕获能正常关闭浏览器
- [ ] 已捕获的信息能通过保存按钮持久化

### 7.3 错误处理验证
- [ ] 父门户 URL 无效时，提示错误
- [ ] MCP 启动失败时，显示友好错误并提供 fallback
- [ ] 捕获超时后，自动清理会话
- [ ] 网络断开时，正确恢复状态

### 7.4 闭环验证
- [ ] 创建子系统 → MCP 浏览器捕获 → 保存 → 刷新页面 → 数据仍在
- [ ] 登录态正确保存 → 后续探索阶段可复用
- [ ] 子系统 URL 正确绑定到项目

---

## 附录：关键代码引用

| 文件 | 位置 | 说明 |
|------|------|------|
| mcp-adapter.ts | L22-L57 | McpPlaywrightAdapter.launch() - MCP 连接 |
| mcp-adapter.ts | L59-L68 | callTool() - MCP 工具调用 |
| mcp-adapter.ts | L70-L72 | navigate() - browser_navigate |
| mcp-adapter.ts | 会话相关 | getSessionCookies/getSessionHeaders 等 |
| types.ts | L47-L70 | EngineType 和 EngineConfig 定义 |
| types.ts | L73-L100 | McpEngine 接口定义 |
| types.ts | L116-L142 | McpToolName 工具名列表 |
| ProjectMgmt.tsx | L322-L343 | 当前"打开浏览器捕获"按钮实现 |
| context.tsx | L26-L52 | SystemInfo 接口定义 |
| 自动化测试平台-主规格 | §18.2 | 子系统浏览器捕获需求 |

---

**文档版本**：v2.0
**创建时间**：2026-08-16
**状态**：待审批（已根据反馈修正为使用 @playwright/mcp 服务）