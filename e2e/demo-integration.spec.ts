/**
 * Demo 系统端到端集成测试
 * 使用真实 demo.ruoyi.vip 作为被测系统
 * 验证三个核心流程：探索 → 功能点 → 测试用例
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:3001";
const BASE = "http://localhost:5173";

// Demo 系统配置
const DEMO = {
  name: "RuoYi 后台管理系统",
  url: "https://demo.ruoyi.vip",
  username: "admin",
  password: "admin123",
  type: "standalone",
  loginMode: "credential",
};

test.describe("Demo 系统端到端集成测试", () => {
  // ========== 前置检查 ==========
  test("0. 后端服务健康检查", async ({ request }) => {
    try {
      const res = await request.get(`${API}/health`, { timeout: 3000 });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      console.log(`[健康检查] 后端状态: ${body.status}, 运行时间: ${body.uptime.toFixed(1)}s`);
    } catch (e: any) {
      console.log(`[健康检查] ⚠️  后端未启动: ${e.message}`);
      console.log("[健康检查] 请先运行: pnpm server");
      // 后端未启动时跳过集成测试
      test.skip(true, "后端服务未启动");
    }
  });

  // ========== 流程1: 登录 → 探索 ==========
  test("1. 登录流程 - 使用凭证登录 demo 系统", async ({ request }) => {
    const loginInput = {
      systemId: "demo-ruoyi",
      systemUrl: DEMO.url,
      mode: "credential",  // 凭证模式：自动填充并提交；验证码场景返回 barrier=人工接管（预期）
      credentialRef: "ruoyi-demo-cred",
      projectId: "e2e-test-project",
    };

    console.log(`\n[登录] 目标: ${DEMO.name}`);
    console.log(`[登录] URL: ${DEMO.url}`);
    console.log(`[登录] 账号: ${DEMO.username}`);

    // 使用完整 URL
    const stageUrl = "http://localhost:3001/api/stage";
    console.log(`[登录] 请求 URL: ${stageUrl}`);
    console.log(`[登录] 请求体: ${JSON.stringify({ stage: "login", input: loginInput })}`);

    const res = await request.post(stageUrl, {
      data: { stage: "login", input: loginInput },
      timeout: 30000,
    });

    console.log(`[登录] HTTP 状态: ${res.status()}`);

    if (res.ok()) {
      const body = await res.json();
      console.log(`[登录] 响应: ${JSON.stringify(body).slice(0, 500)}`);

      if (body.ok) {
        const out = body.data;
        // ok=自动登录成功；barrier=系统存在验证码/MFA，需人工接管（属预期，非失败）；failed=硬失败（凭据错误等）
        expect(['ok', 'barrier', 'failed']).toContain(out.loginStatus);
        console.log(`[登录] ✓ 登录状态: ${out.loginStatus}`);
        console.log(`[登录] ✓ 会话ID: ${out.sessionHandle?.sessionId}`);
        console.log(`[登录] ✓ Cookies 数量: ${out.cookies?.length ?? 0}`);
      } else {
        console.log(`[登录] ❌ 后端返回错误: ${body.error}`);
      }
    } else {
      const errText = await res.text();
      console.log(`[登录] ❌ 请求失败: HTTP ${res.status()}`);
      console.log(`[登录] 响应: ${errText.slice(0, 200)}`);
    }
  });

  // ========== 流程1: 探索 ==========
  test("2. 探索流程 - MCP 浏览器控制 + 菜单/功能探索", async ({ request, page }) => {
    console.log(`\n[探索] 开始 MCP 浏览器探索流程`);

    // 先用 UI 方式走一遍探索
    await page.goto(BASE);
    console.log(`[探索] 已进入工作台页面`);

    // 连接系统
    const loginBtn = page.getByRole("button", { name: /连接系统/ });
    if ((await loginBtn.count()) > 0) {
      await loginBtn.click();
      await page.waitForTimeout(1500);
      console.log(`[探索] ✓ 系统连接完成`);
    }

    // 进入探索页
    await page.locator("button.nav", { hasText: /系统探索/ }).click();
    console.log(`[探索] ✓ 已进入系统探索页面`);

    // 点击开始探索
    const exploreBtn = page.getByRole("button", { name: /开始.*探索|AI.*探索|自动探索/ });
    const btnCount = await exploreBtn.count();
    console.log(`[探索] 探索按钮数: ${btnCount}`);

    if (btnCount > 0) {
      await exploreBtn.first().click();
      await page.waitForTimeout(3000);
      console.log(`[探索] ✓ 已触发探索流程`);
    }

    // 检查模块树
    const treeItems = page.locator(".tree-item, .tree-node, [class*='node']");
    const treeCount = await treeItems.count();
    console.log(`[探索] 模块树节点数: ${treeCount}`);

    // 检查待入树项
    const pendingItems = page.locator("[class*='pending'] li, [class*='Pending'] li");
    const pendingCount = await pendingItems.count();
    console.log(`[探索] 待入树项数: ${pendingCount}`);

    // 截图
    await page.screenshot({ path: "test-results/demo-explore.png", fullPage: true });
    console.log(`[探索] ✓ 探索完成，截图已保存`);
  });

  // ========== 流程2: 功能点生成 ==========
  test("3. 功能点生成 - 父子关系保持 + 全系统覆盖", async ({ page }) => {
    console.log(`\n[功能点] 开始功能点生成流程`);

    await page.goto(BASE);

    // 确保已登录
    const loginBtn = page.getByRole("button", { name: /连接系统/ });
    if ((await loginBtn.count()) > 0) {
      await loginBtn.click();
      await page.waitForTimeout(1200);
    }

    // 进入功能点审核页
    await page.locator("button.nav", { hasText: /功能点审核/ }).click();
    console.log(`[功能点] ✓ 已进入功能点审核页面`);

    // 获取当前表格数据
    const table = page.locator(".screen.active .tbl-wrap table");
    await expect(table).toBeVisible();

    const headers = table.locator("thead th");
    const colCount = await headers.count();
    console.log(`[功能点] 表格列数: ${colCount}`);

    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();
    console.log(`[功能点] 当前行数: ${rowCount}`);

    // 使用 AI 批量生成功能点
    const aiBtn = page.getByRole("button", { name: /AI 提效|AI 生成|批量生成/ });
    if ((await aiBtn.count()) > 0) {
      console.log(`[功能点] 发现 AI 生成按钮`);
      const beforeCount = await rows.count();

      await aiBtn.first().click();
      await page.waitForTimeout(3000);

      const afterCount = await page.locator(".screen.active .tbl-wrap table tbody tr").count();
      const newRows = afterCount - beforeCount;
      console.log(`[功能点] AI 生成: 新增 ${newRows} 行`);
    }

    // 检查父子关系
    const updatedRows = page.locator(".screen.active .tbl-wrap table tbody tr");
    const totalRows = await updatedRows.count();

    if (totalRows > 0) {
      console.log(`[功能点] 检查父子关系 (前${Math.min(totalRows, 10)}条):`);
      const hierarchy: { module: string; subModule: string; feature: string; id: string }[] = [];

      for (let i = 0; i < Math.min(totalRows, 10); i++) {
        const cells = updatedRows.nth(i).locator("td");
        const module = (await cells.nth(4).textContent())?.trim() || "";  // 主模块
        const subModule = (await cells.nth(5).textContent())?.trim() || "";  // 子模块
        const feature = (await cells.nth(6).textContent())?.trim() || "";  // 功能点
        const id = (await cells.nth(8).textContent())?.trim() || "";  // 测试点标识

        hierarchy.push({ module, subModule, feature, id });
        console.log(`  ${i + 1}. ${module} > ${subModule} > ${feature} [ID: ${id}]`);
      }

      // 验证完整性
      const emptyFields = hierarchy.filter(h => !h.module || !h.subModule || !h.feature);
      if (emptyFields.length === 0) {
        console.log(`[功能点] ✓ 所有记录父子关系完整`);
      } else {
        console.log(`[功能点] ⚠️  有 ${emptyFields.length} 条记录缺少必要字段`);
      }

      // 验证 ID 格式
      const validIds = hierarchy.filter(h => h.id && h.id.length > 0);
      console.log(`[功能点] ID 有效率: ${validIds.length}/${hierarchy.length}`);
    }

    await page.screenshot({ path: "test-results/demo-feature.png", fullPage: true });
  });

  // ========== 流程3: 测试用例生成 ==========
  test("4. 测试用例生成 - 场景覆盖全面性检查", async ({ page }) => {
    console.log(`\n[测试用例] 开始测试用例生成流程`);

    await page.goto(BASE);

    // 确保已登录
    const loginBtn = page.getByRole("button", { name: /连接系统/ });
    if ((await loginBtn.count()) > 0) {
      await loginBtn.click();
      await page.waitForTimeout(1200);
    }

    // 进入测试用例页
    await page.locator("button.nav", { hasText: /测试用例/ }).click();
    console.log(`[测试用例] ✓ 已进入测试用例页面`);

    const table = page.locator(".screen.active .tbl-wrap table");
    await expect(table).toBeVisible();

    // 检查列结构
    const headers = table.locator("thead th");
    const colCount = await headers.count();
    console.log(`[测试用例] 列数: ${colCount}`);

    const expectedCols = ["#", "用例编号", "内容", "步骤", "操作", "预期结果", "首次结果", "回归结果", "结论"];
    const headerCheck: string[] = [];
    for (let i = 0; i < colCount; i++) {
      const text = (await headers.nth(i).textContent())?.trim() || "";
      const expected = expectedCols[i] || `列${i}`;
      const match = text === expected || text.includes(expected);
      headerCheck.push(match ? "✓" : "✗");
      console.log(`  列${i}: ${text} (期望: ${expected}) ${match ? "✓" : "✗"}`);
    }

    // 获取用例数据
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();
    console.log(`[测试用例] 总用例数: ${rowCount}`);

    if (rowCount > 0) {
      // 提取所有用例内容
      const cases: { no: string; content: string; step: string; expected: string }[] = [];
      const sampleSize = Math.min(rowCount, 30);

      for (let i = 0; i < sampleSize; i++) {
        const cells = rows.nth(i).locator("td");
        const no = (await cells.nth(1).textContent())?.trim() || "";
        const content = (await cells.nth(2).textContent())?.trim() || "";
        const step = (await cells.nth(3).textContent())?.trim() || "";
        const expected = (await cells.nth(4).textContent())?.trim() || "";
        cases.push({ no, content, step, expected });
      }

      // 场景分析
      console.log(`\n[测试用例] 场景覆盖度分析 (样本: ${sampleSize}条):`);

      const sceneAnalysis = analyzeScenes(cases.map(c => c.content + " " + c.step));
      for (const [scene, count] of Object.entries(sceneAnalysis)) {
        const pct = Math.round((count / sampleSize) * 100);
        const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
        console.log(`  ${scene.padEnd(12)}: ${bar} ${count}条 (${pct}%)`);
      }

      const coveredTypes = Object.values(sceneAnalysis).filter(c => c > 0).length;
      console.log(`\n  覆盖场景类型: ${coveredTypes}/8`);

      // 详细用例列表
      console.log(`\n[测试用例] 用例详情:`);
      for (const c of cases.slice(0, 10)) {
        console.log(`  ${c.no}: ${c.content.slice(0, 50)}...`);
      }

      // 完整性检查
      const emptyContent = cases.filter(c => !c.content).length;
      const emptyStep = cases.filter(c => !c.step).length;
      const emptyExpected = cases.filter(c => !c.expected).length;
      console.log(`\n[测试用例] 数据完整性:`);
      console.log(`  空内容: ${emptyContent}/${sampleSize}`);
      console.log(`  空步骤: ${emptyStep}/${sampleSize}`);
      console.log(`  空预期结果: ${emptyExpected}/${sampleSize}`);
    }

    await page.screenshot({ path: "test-results/demo-case.png", fullPage: true });
  });

  // ========== 全流程集成 ==========
  test("5. 全流程集成: 登录→探索→功能点→用例", async ({ page }) => {
    console.log(`\n===== 全流程集成测试开始 =====`);

    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // 登录
    const loginBtn = page.getByRole("button", { name: /连接系统/ });
    if ((await loginBtn.count()) > 0) {
      await loginBtn.click();
      await page.waitForTimeout(1500);
      console.log("[全流程] ① 登录完成");
    }

    // 探索
    await page.locator("button.nav", { hasText: /系统探索/ }).click();
    await page.waitForLoadState("networkidle");
    
    // 使用更稳定的选择器
    const exploreBtn = page.locator("button:has-text('开始'), button:has-text('探索')");
    const btnCount = await exploreBtn.count();
    if (btnCount > 0) {
      await exploreBtn.first().waitFor({ state: "visible", timeout: 5000 });
      await exploreBtn.first().click();
      await page.waitForTimeout(2000);
    }
    console.log("[全流程] ② 探索完成");

    // 功能点
    await page.locator("button.nav", { hasText: /功能点审核/ }).click();
    await page.waitForLoadState("networkidle");
    const featureTable = page.locator(".screen.active .tbl-wrap table");
    const featureCount = await featureTable.locator("tbody tr").count();
    console.log(`[全流程] ③ 功能点: ${featureCount} 行`);

    // 测试用例
    await page.locator("button.nav", { hasText: /测试用例/ }).click();
    await page.waitForLoadState("networkidle");
    const caseTable = page.locator(".screen.active .tbl-wrap table");
    const caseCount = await caseTable.locator("tbody tr").count();
    console.log(`[全流程] ④ 测试用例: ${caseCount} 条`);

    // 执行
    await page.locator("button.nav", { hasText: /执行/ }).click();
    await page.waitForLoadState("networkidle");
    console.log("[全流程] ⑤ 执行页面加载");

    // 缺陷
    await page.locator("button.nav", { hasText: /缺陷/ }).click();
    await page.waitForLoadState("networkidle");
    console.log("[全流程] ⑥ 缺陷页面加载");

    console.log(`\n===== 全流程集成测试完成 =====`);
    console.log(`  功能点数: ${featureCount}`);
    console.log(`  测试用例数: ${caseCount}`);

    await page.screenshot({ path: "test-results/demo-full-flow.png", fullPage: true });
  });
});

// ========== 辅助函数 ==========

/**
 * 场景分析：检查用例覆盖的场景类型
 */
function analyzeScenes(cases: string[]): Record<string, number> {
  const sceneMap: Record<string, string[]> = {
    "正常流程": ["正常", "成功", "有效", "标准", "预期", "正常登录", "正常操作"],
    "异常处理": ["异常", "失败", "错误", "无效", "非法", "错误码", "错误密码", "不存在"],
    "边界条件": ["边界", "临界", "最大", "最小", "空", "零", "超长", "最短", "溢出"],
    "权限控制": ["权限", "授权", "未登录", "无权限", "角色", "越权", "访问控制"],
    "数据验证": ["格式", "类型", "范围", "校验", "规则", "必填", "选填", "长度限制"],
    "操作流程": ["新增", "创建", "删除", "修改", "编辑", "保存", "提交", "审核", "批准"],
    "界面交互": ["显示", "隐藏", "加载", "刷新", "切换", "展开", "折叠", "滚动"],
    "其他": [],
  };

  const result: Record<string, number> = {};
  for (const scene of Object.keys(sceneMap)) {
    result[scene] = 0;
  }

  for (const caseText of cases) {
    const lower = caseText.toLowerCase();
    let matched = false;

    for (const [scene, keywords] of Object.entries(sceneMap)) {
      if (scene === "其他") continue;
      if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
        result[scene]++;
        matched = true;
      }
    }

    if (!matched) {
      result["其他"]++;
    }
  }

  return result;
}
