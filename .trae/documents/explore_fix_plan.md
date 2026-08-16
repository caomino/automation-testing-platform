# 探索功能空白页面问题修复计划（v2）

## 核心目标
**第一优先级：确保探索前获取有效登录会话。如果取不到会话，阻止探索并引导用户返回登录。**

## 问题分析

### 问题现象
用户使用"人工接管"方式登录系统成功后，点击"探索"按钮，浏览器打开空白页面（about:blank），无法正常获取模块树数据。

### 根因分析

#### 问题 1：Workbench.tsx 探索按钮缺少 systemUrl
**文件**: `d:\newTest\packages\app\src\screens\Workbench.tsx#L361-L364`

```typescript
const result = await runPipelineExplore({
  sessionHandle,
  subsystemId: system.id,
  // ❌ 缺少 systemUrl: system.url
});
```

**影响**: 后端收到探索请求时没有 URL 可导航，浏览器启动后停留在 about:blank。

#### 问题 2：登录成功后会话保存条件不严谨
**文件**: `d:\newTest\packages\app\src\context.tsx#L1150`

```typescript
if (out.loginStatus === 'ok' && out.cookies) {
  // cookies 可能是空数组 []，仍会进入此分支
  const sessionState = { cookies: out.cookies, ... };
}
```

**影响**: 即使 cookies 为空也会保存会话状态，导致后续探索使用无效会话。

#### 问题 3：探索前未验证会话有效性（核心问题）
**文件**: `d:\newTest\packages\app\src\screens\Explore.tsx#L100-L144`
**文件**: `d:\newTest\packages\app\src\screens\Workbench.tsx#L347-L370`

探索前仅检查 `system.loginStatus !== "logged_in"`，但未检查：
1. `system.sessionState.cookies` 是否有有效数据
2. 会话是否已过期
3. 当前登录方式对应的会话是否正确捕获

## 修复计划

### 步骤 1：修复 Workbench.tsx - 添加 systemUrl 和会话验证
**文件**: `d:\newTest\packages\app\src\screens\Workbench.tsx`

#### 1.1 添加会话有效性检查函数

```typescript
const hasValidSession = () => {
  if (system.credentialMode === 'no-login') return true;
  const cookies = system.sessionState?.cookies;
  return cookies && cookies.length > 0;
};
```

#### 1.2 修改探索按钮逻辑

```typescript
<Button 
  variant="pri" 
  disabled={pipelineLoading || !isLoggedIn} 
  onClick={async () => {
    // ✅ 第一优先级：检查会话是否有效
    if (!hasValidSession()) {
      toast("登录会话失效，请重新登录");
      setActiveScreen("s1"); // 返回工作台
      setLoginOpen(true);    // 打开登录弹窗
      return;
    }
    
    // ✅ 添加 systemUrl
    const sessionHandle = {
      sessionId: system.id,
      systemId: system.id,
      loginStatus: 'ok' as const,
      cookies: system.sessionState!.cookies!,
      headers: system.sessionState?.headers ?? {},
      tokens: system.sessionState?.tokens ?? [],
      expiresAt: Date.now() + 3600000,
    };
    
    const result = await runPipelineExplore({
      sessionHandle,
      subsystemId: system.id,
      systemUrl: system.url,  // ✅ 修复：添加 systemUrl
    });
    
    if (result) {
      setActiveScreen("s2");
    }
  }}
>
  🔍 探索
</Button>
```

### 步骤 2：修复登录成功后的会话保存条件
**文件**: `d:\newTest\packages\app\src\context.tsx#L1150-L1162`

```typescript
// 修改前
if (out.loginStatus === 'ok' && out.cookies) {

// 修改后
if (out.loginStatus === 'ok' && out.cookies && out.cookies.length > 0) {
  const sessionState = { cookies: out.cookies, headers: out.sessionHandle?.headers, tokens: out.sessionHandle?.tokens };
  dispatch({ type: "SET_SESSION_STATE", id: state.system.id, sessionState });
  // ... 持久化逻辑 ...
} else if (out.loginStatus === 'ok' && system.credentialMode !== 'no-login') {
  // 登录成功但未捕获到 cookies，可能是会话捕获失败
  console.warn('[pipeline] Login succeeded but no cookies captured, session may be invalid');
  toast("警告：登录成功但未获取到有效会话，探索功能可能需要重新登录");
}
```

### 步骤 3：增强 Explore.tsx 的会话验证
**文件**: `d:\newTest\packages\app\src\screens\Explore.tsx#L100-L144`

```typescript
const handleStartExplore = async () => {
  if (!system.id) {
    toast("请先选择一个系统");
    return;
  }
  if (!system.url) {
    toast("请先在项目管理中配置系统 URL");
    return;
  }
  if (system.loginStatus !== "logged_in") {
    toast("请先登录系统");
    return;
  }
  
  // ✅ 第一优先级：检查会话有效性
  const isNoLoginMode = system.credentialMode === 'no-login';
  const cookies = system.sessionState?.cookies;
  const hasValidCookies = cookies && cookies.length > 0;
  
  if (!isNoLoginMode && !hasValidCookies) {
    toast("登录会话失效，请返回工作台重新登录");
    // 可选择自动切换回工作台
    // setActiveScreen("s1");
    return;
  }
  
  const sessionHandle = {
    sessionId: system.id,
    systemId: system.id,
    loginStatus: "ok" as const,
    cookies: cookies ?? [],
    headers: system.sessionState?.headers ?? {},
    tokens: system.sessionState?.tokens ?? [],
    expiresAt: Date.now() + 3600000,
  };
  
  const input: any = {
    sessionHandle,
    subsystemId: system.id,
    systemUrl: system.url,
  };
  
  try {
    toast("正在启动浏览器探索，请稍候...");
    const out = await runPipelineExplore(input);
    if (out?.moduleTree && out.moduleTree.length > 0) {
      toast(`探索完成：发现 ${out.moduleTree.length} 个模块`);
    } else {
      toast("探索完成但未发现模块，请检查页面结构");
    }
  } catch (e: any) {
    console.error("探索失败详情:", e);
    const errMsg = e.message || "未知错误";
    if (errMsg.includes("EXPLORE_FAILED")) {
      toast("探索失败：无法获取模块数据，请检查：1)系统URL是否正确 2)网络是否可访问 3)登录会话是否有效");
    } else {
      toast(`探索失败：${errMsg}`);
    }
  }
};
```

### 步骤 4：增强后端探索阶段的会话诊断
**文件**: `d:\newTest\packages\stage-explore\src\index.ts#L267-L322`

在探索阶段开始时增加诊断日志：
- 打印传入的 sessionHandle 中 cookies 数量
- 如果 cookies 为空且不是 no-login 模式，输出警告
- 导航失败时输出详细错误信息

```typescript
if (activeEngine) {
  try {
    console.log(`[stage-explore] 会话诊断: cookies=${validated.sessionHandle.cookies?.length ?? 0}, systemUrl=${validated.systemUrl}`);
    
    const sessionEngine = activeEngine as SessionCapableEngine;
    
    // 应用会话
    if (validated.sessionHandle.cookies?.length || validated.sessionHandle.tokens?.length) {
      await sessionEngine.applySession({...});
      console.log('[stage-explore] 会话应用成功');
    } else if (validated.systemUrl) {
      console.warn('[stage-explore] 无有效会话，将以匿名身份导航');
    }
    
    // 导航
    if (validated.systemUrl) {
      await activeEngine.navigate(validated.systemUrl);
      console.log('[stage-explore] 导航成功');
    }
    // ...
  }
}
```

## 修改文件清单

| 文件 | 修改内容 | 风险等级 |
|------|----------|----------|
| `Workbench.tsx` | 添加 systemUrl 参数、会话验证、登录引导 | 低 |
| `context.tsx` | 修复登录会话保存条件 | 低 |
| `Explore.tsx` | 增强会话有效性检查 | 低 |
| `stage-explore/index.ts` | 增强诊断日志 | 低 |

## 测试场景

修改完成后需要验证以下场景：

1. **人工接管登录 → 探索**（主要场景）
   - 启动人工接管登录
   - 在浏览器中完成登录
   - 点击"确认登录"
   - 点击"探索"
   - 预期：正常导航到系统页面并提取模块

2. **会话失效后探索**
   - 手动清除 cookies（模拟会话过期）
   - 点击"探索"
   - 预期：提示"登录会话失效，请重新登录"

3. **凭证登录 → 探索**
   - 使用凭证自动登录
   - 登录成功后点击"探索"
   - 预期：正常工作

4. **免登录模式 → 探索**
   - 系统配置为 no-login
   - 直接点击"探索"
   - 预期：正常工作（无需 cookies 验证）

5. **无 systemUrl 场景**
   - 未配置系统 URL
   - 点击"探索"
   - 预期：提示"请先配置系统 URL"
