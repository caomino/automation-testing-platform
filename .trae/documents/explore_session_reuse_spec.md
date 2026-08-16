# 系统探索会话复用修复规格（Spec）

日期：2026-08-16 | 状态：待确认 | 修复目标：登录后探索复用登录浏览器会话

## 一、系统探索模块代码位置清单

| 层 | 文件 | 关键位置 |
|---|---|---|
| 前端入口 | packages/app/src/screens/Workbench.tsx | L353-387 探索按钮（构造 sessionHandle/systemUrl） |
| 前端探索页 | packages/app/src/screens/Explore.tsx | handleStartExplore 二次入口 |
| 前端服务 | packages/app/src/services/pipeline.ts | L297 callBackend → POST /api/stage |
| 前端状态 | packages/app/src/context.tsx | L1206-1232 runPipelineExplore |
| 后端路由 | packages/orchestrator/server.ts | L566-588 /api/stage；L36 **engineConfig: {headless: false}** |
| 编排器 | packages/orchestrator/src/index.ts | L311-370 runStage('explore')；L139-168 full-pipeline |
| 登录阶段 | packages/stage-login/src/index.ts | L65 closeTakeoverEngine；L511-596 confirmManualLogin；**L576 登录成功后 delete 引擎** |
| 探索阶段 | packages/stage-explore/src/index.ts | L242-389 run 主入口 |
| 浏览器引擎 | packages/engine-mcp/src/playwright-engine.ts | L264 launch；L283 navigate；L687 applySession |
| 引擎工厂 | packages/engine-mcp/src/index.ts | L22 createEngine |

## 二、根因分析（已验证，非猜测）

### 用户症状
登录成功 → 点击探索 → 新开一个**可见空白浏览器窗口**（about:blank）→ 前端报探索失败。任何一个登录成功的项目都复现。

### 调用链（现状）
1. Workbench → POST /api/stage {stage:'explore', input:{sessionHandle(cookies 非空), subsystemId, systemUrl}} —— 前端传参正确（已验证）
2. server.ts → orchestrator.runStage('explore')
3. runStage L336-337：`createEngine({headless:false})` + `launch()` → **新开第 2 个可见浏览器，初始页 about:blank**
4. runStage L353：`applySession(cookies)` —— page.url() 此时是 `about:blank`，applySession L694 把每个 cookie 映射为 `{name, value, url:'about:blank'}`，**Playwright addCookies 对非 http(s) url 抛异常**
5. runStage L363-366：`catch { engine = undefined }` —— **已打开的浏览器永不关闭（窗口泄漏），engine 被丢弃**
6. stageExplore.run(input, undefined) → stage-explore L256 自建 `createEngine({headless:true})`，**但从未调用 launch()** → ensureSession/navigate 全部抛 'engine not launched'
7. 最终 EXPLORE_FAILED；用户看到的空白窗口 = 第 3 步泄漏的那个浏览器

### 五个叠加缺陷
| # | 缺陷 | 位置 |
|---|---|---|
| 1 | 探索永远新开浏览器，不复用登录浏览器 | orchestrator runStage |
| 2 | 登录成功后引擎引用被删，想复用也拿不到 | stage-login L576 `activeTakeoverEngines.delete` |
| 3 | applySession 在 about:blank 注入 cookies 必然失败 | playwright-engine L694 |
| 4 | applySession 失败时泄漏已打开浏览器（catch 不 close） | orchestrator L363-366 |
| 5 | stage-explore 自建引擎不调 launch()，备用路径全坏 | stage-explore L253-263 |

### 为什么 6 轮没修好
前几轮都在前端加校验（hasValidSession）、加日志、加 ensureSession 方法，但症状源头在后端编排层（缺陷 1-5），前端传参本来就是对的。

## 三、修复方案（与 D:\Test 参考项目架构一致：共享浏览器实例）

### 改动 1：stage-login 保留登录引擎供复用
- 登录成功后不再 `delete`，保留 `activeTakeoverEngines` 条目
- 导出 `getTakeoverEngine(systemId): SessionCapableEngine | undefined`

### 改动 2：orchestrator runStage('explore') 优先复用登录引擎
```
1. getTakeoverEngine(systemId) 命中 → 直接传入 stageExplore.run（已登录会话、可见浏览器）
2. 未命中 → 新建引擎（沿用 headless:false）
3. applySession 前：先 navigate(systemUrl) 再注入 cookies（修复 about:blank 缺陷）
4. applySession 失败 → engine.close() 再置 undefined（修复泄漏）
```

### 改动 3：stage-explore 修复备用路径
- 自建引擎后补 `await activeEngine.launch()`
- 引擎为外部注入且已导航时，跳过重复的 ensureSession 导航（避免二次跳转）

### 改动 4：playwright-engine applySession 修复 cookie url
- cookie 注入改用 `domain/path`（从目标 URL 解析域名），不再依赖 page.url()

## 四、验收标准（全部可测试）
1. 人工接管登录成功后点探索：**不新开浏览器**，在登录浏览器内导航并返回真实模块树（节点数 > 0）
2. 重启后端后（无登录浏览器）点探索：新开浏览器，cookie 注入成功，能进入系统页面（不再停在 about:blank）
3. 会话过期场景：返回明确错误"需要重新登录"，无泄漏浏览器窗口
4. 后端日志可见 `[explore] reusing login browser for <systemId>`
5. `pnpm run build` 通过；现有单测通过

## 五、不做的事
- 不改前端 UI/交互（前端传参已正确）
- 不改人工补录功能（用户确认其已正常）
- 不处理模块树展开/折叠等无关需求
