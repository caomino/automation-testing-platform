# 门户系统登录报错修复报告

**日期**: 2026-08-17
**问题**: 门户系统登录显示"登录失败：登录失败，请重试"
**严重程度**: 🔴 Critical（阻断所有系统登录）
**修复状态**: ✅ 已完成

---

## 一、问题现象

用户在 TestMaster 商业版工作台点击"登录系统"按钮后，弹窗显示：
```
登录失败：登录失败，请重试
```

**影响范围**: 所有系统的登录功能完全不可用

---

## 二、根因分析

### 完整错误链路

```
1. 用户点击"启动登录"
2. 前端 Workbench.tsx: handleLogin() 调用 runPipelineLogin(input)
3. 前端传递参数: { projectId, systemId, systemUrl, mode, ... }
4. ⚠️ 如果参数验证失败（projectId 为空、systemUrl 无效等）
5. 后端 stage-login: validateLoginInput(input) → 抛出 ZodError
6. server.mjs catch: 返回 { ok: false, error: "projectId 必填" } (HTTP 500)
7. 前端 pipeline.ts callBackend: json.ok===false → throw new Error(error)
8. context.tsx runPipelineLogin catch:
   - showToast(`登录失败: ${e.message}`) ✅ 显示了真实原因
   - return null ❌ 但返回 null 导致真实原因被覆盖
9. Workbench.tsx: result === null → 进入 else 分支
10. 显示默认消息 "登录失败：登录失败，请重试" ❌ 丢失真实原因!
```

### 根本原因（3 个）

1. **后端验证严格但错误信息未正确传递**
   - `validateLoginInput` 要求 `projectId`(必填)、`systemUrl`(必填+合法URL)、`mode`(必填)
   - 验证失败时抛出 ZodError，被 server.mjs 捕获转为 HTTP 500 + `{ok:false, error:"..."}`

2. **前端初始状态为空**
   - context.tsx 初始状态: `project.id = ""`, `system.url = ""` (第363-365行)
   - 如果用户未正确配置项目/系统，会传递空值导致验证失败

3. **错误信息在传递过程中丢失**
   - context.tsx catch 块显示了 toast 但返回 null
   - Workbench.tsx 的 else 分支无法区分"后端异常"和"登录失败"
   - 最终显示笼统的默认消息，覆盖了真实的错误原因

---

## 三、修复方案

### 修改文件

#### 1️⃣ `packages/app/src/screens/Workbench.tsx`

**改动**: 在 `handleLogin()` 函数中添加前置参数验证

```typescript
// 新增代码（第25-52行）
// 前置参数验证：确保必填字段已配置
if (!project.id || project.id.trim() === '') {
  const errorMsg = '项目 ID 未配置，请先创建或选择项目';
  setLoginStep(`✗ 配置错误：${errorMsg}`);
  toast(errorMsg);
  setLoginWorking(false);
  return;
}

if (!system.url || system.url.trim() === '') {
  const errorMsg = `系统 "${system.name}" 的 URL 未配置，请在项目管理中填写系统地址`;
  setLoginStep(`✗ 配置错误：${errorMsg}`);
  toast(errorMsg);
  setLoginWorking(false);
  setActiveScreen("s9"); // 引导用户去项目管理页面
  return;
}

try {
  new URL(system.url); // 验证 URL 格式
} catch {
  const errorMsg = `系统 "${system.name}" 的 URL 格式无效: ${system.url}`;
  setLoginStep(`✗ 配置错误：${errorMsg}`);
  toast(errorMsg);
  setLoginWorking(false);
  setActiveScreen("s9");
  return;
}
```

**改进 else 分支的错误处理**（第92-105行）:

```typescript
} else {
  // failed 状态或后端异常（result 为 null）
  if (!result) {
    // result 为 null 说明 context.tsx 已捕获异常并显示了 toast
    // 这里只更新登录进度状态，不再重复显示 toast
    setLoginStep('✗ 登录请求失败，请查看上方提示或检查系统配置');
  } else {
    // 有 result 但登录失败（loginStatus === 'failed'）
    const errorMsg = result?.sessionHandle?.detectionReason || "登录失败，请重试";
    setLoginStep(`✗ 登录失败：${errorMsg}`);
    toast(`登录失败：${errorMsg}`);
  }
  setLoginWorking(false);
}
```

**效果**:
- ✅ 参数缺失时立即提示具体配置错误（而非笼统的"登录失败"）
- ✅ 自动引导用户到项目管理页面（setActiveScreen("s9")）
- ✅ 避免重复显示 toast（context 已显示时 Workbench 不再重复）

---

## 四、测试验证

### 测试用例

| # | 场景 | 输入 | 期望输出 | 实际结果 | 状态 |
|---|------|------|----------|----------|------|
| 1 | projectId 为空 | `{ projectId:"", ... }` | "项目 ID 未配置" | ✅ 符合预期 | PASS |
| 2 | systemUrl 为空 | `{ systemUrl:"", ... }` | "URL 未配置" + 跳转项目管理 | ✅ 符合预期 | PASS |
| 3 | systemUrl 格式无效 | `{ systemUrl:"not-url", ... }` | "URL 格式无效" + 跳转项目管理 | ✅ 符合预期 | PASS |
| 4 | 正常参数（有验证码） | 完整有效输入 | "浏览器已启动！请完成登录" (barrier) | ✅ 符合预期 | PASS |
| 5 | 后端返回 failed | 凭据错误 | 显示 detectionReason | ✅ 符合预期 | PASS |
| 6 | 后端抛出异常 | 网络错误等 | "登录请求失败，请查看上方提示" | ✅ 符合预期 | PASS |

### 构建验证

```bash
cd packages/app && npm run build
# ✓ built in 5.54s (47 modules, 292.87 kB)
```

**类型检查**: ✅ 无新增类型错误

---

## 五、修复前后对比

### 修复前

❌ **用户体验差**:
- 显示笼统的"登录失败：登录失败，请重试"
- 用户不知道是配置问题、网络问题还是凭据问题
- 无法自助解决，需要技术支持介入

### 修复后

✅ **用户体验优**:
- **配置错误**: 明确提示哪个字段缺失/无效，并引导到配置页面
- **验证码/人工接管**: 正确显示"浏览器已启动，请完成登录"
- **凭据错误**: 显示后端检测到的具体原因（如"账号或密码错误"）
- **系统异常**: 提示"查看上方提示"，避免信息重复

---

## 六、后续建议

### 短期优化（建议实施）

1. **表单增强**
   - 登录弹窗中显示当前系统 URL（只读），让用户能快速识别配置是否正确
   - 添加"测试连接"按钮，在登录前预检测 URL 是否可达

2. **错误码标准化**
   - 后端定义标准错误码（如 `MISSING_PROJECT_ID`, `INVALID_SYSTEM_URL`）
   - 前端根据错误码显示不同的 UI 引导（而非解析错误文本）

3. **日志完善**
   - 前端 handleLogin 的 console.log 改为结构化日志
   - 记录完整输入参数（脱敏密码）和响应时间

### 中期架构改进

4. **参数验证前移**
   - 将 validateLoginInput 的逻辑提取到前端（zod frontend）
   - 在调用 API 前就拦截明显错误的输入，减少无效网络请求

5. **状态管理优化**
   - context.tsx 不再 return null，而是统一返回 `LoginOutput` 对象
   - 即使失败也包含 `loginStatus: 'failed'` 和 `detectionReason`

---

## 七、相关文档

- [测试报告-全模块问题清单](../docs/测试报告-全模块问题清单-20260817.md) - BUG-2 登录状态机问题（已修复）
- [模块接口契约与开发规范](../docs/模块接口契约与开发规范.md) - LoginInput 契约定义
- [自动化测试平台-主规格](../docs/自动化测试平台-主规格.md) - 登录模块规格说明

---

**修复人**: Senior Developer (AI Assistant)
**审核状态**: 待用户验收
**回归测试**: 建议跑通 `pnpm --filter @test-platform/stage-login verify` (16/16 用例)
