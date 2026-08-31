/**
 * @file browser-capture.ts
 * @description 浏览器捕获服务 — 使用 PlaywrightEngine 直连模式
 * 打开可见浏览器导航到父门户，用户手动完成登录后捕获会话信息
 */
import { createEngine, type CaptureEngine, type EngineConfig } from '@test-platform/engine-mcp';

export interface CaptureSession {
  id: string;
  status: 'idle' | 'capturing' | 'completing' | 'completed' | 'cancelling' | 'cancelled' | 'failed';
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
  private engines: Map<string, CaptureEngine> = new Map();

  /**
   * 启动浏览器捕获会话
   * 使用 PlaywrightEngine 直连模式打开可见浏览器，导航到父门户 URL
   * 用户在浏览器中手动完成登录和导航，然后点击"完成捕获"
   */
  async startCapture(portalUrl: string, systemId?: string): Promise<CaptureSession> {
    const sessionId = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const engineConfig: EngineConfig = {
      engineType: 'direct',
      headless: false,
      manualTakeover: true,
      viewport: { width: 1366, height: 768 },
      timeoutMs: 60000,
    };

    const engine = createEngine(engineConfig) as CaptureEngine;

    try {
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
      await engine.close().catch(() => {});
      throw new Error(`启动浏览器失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 查询捕获会话状态
   */
  getStatus(sessionId: string): CaptureSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * 完成捕获，从浏览器获取当前页面信息和会话数据
   */
  async completeCapture(sessionId: string): Promise<CaptureResult> {
    const session = this.sessions.get(sessionId);
    const engine = this.engines.get(sessionId);

    if (!session || !engine) {
      throw new Error('捕获会话不存在');
    }

    session.status = 'completing';

    try {
      const [capturedUrl, capturedTitle, navigationPath, cookies, headers, tokens] = await Promise.all([
        engine.getCurrentUrl(),
        engine.getCurrentTitle(),
        engine.getNavigationPath(),
        engine.getSessionCookies(),
        engine.getSessionHeaders(),
        engine.getSessionTokens(),
      ]);

      const result: CaptureResult = {
        capturedUrl,
        capturedTitle,
        cookies,
        headers,
        tokens,
        navigationPath,
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
   * 取消捕获会话（更新状态，释放引擎）
   */
  async cancelCapture(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const engine = this.engines.get(sessionId);

    if (session) {
      session.status = 'cancelled';
    }

    if (engine) {
      try {
        await engine.close();
      } catch {
        // 忽略关闭错误
      }
      this.engines.delete(sessionId);
    }
  }

  /**
   * 清理所有会话
   */
  async cleanup(): Promise<void> {
    const closePromises: Promise<void>[] = [];
    for (const [, engine] of this.engines) {
      closePromises.push(engine.close().catch(() => {}));
    }
    await Promise.all(closePromises);
    this.engines.clear();
    this.sessions.clear();
  }
}
