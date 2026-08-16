/**
 * 核心流程3: 测试用例生成测试
 * 目标: 根据功能点生成用例，验证场景覆盖全面性
 */
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5173";

test.describe("核心流程3: 测试用例生成", () => {
  test("S4 用例: 表格结构和列完整性", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /测试用例/ }).click();

    const table = page.locator(".screen.active .tbl-wrap table");
    await expect(table).toBeVisible();

    const headers = table.locator("thead th");
    const colCount = await headers.count();
    console.log(`[用例结构] 列数: ${colCount}`);

    const expectedCols = [
      "#", "用例编号", "内容", "步骤", "操作",
      "预期结果", "首次结果", "回归结果", "结论"
    ];
    for (let i = 0; i < colCount; i++) {
      const text = (await headers.nth(i).textContent())?.trim();
      const expected = expectedCols[i] || `列${i}`;
      console.log(`  列${i} (期望: ${expected}): ${text}`);
    }
  });

  test("S4 用例: 用例编号格式和唯一性", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /测试用例/ }).click();

    const table = page.locator(".screen.active .tbl-wrap table");
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();
    console.log(`[用例编号] 总用例数: ${rowCount}`);

    if (rowCount > 0) {
      const caseNos = new Set<string>();
      for (let i = 0; i < Math.min(rowCount, 20); i++) {
        const cells = rows.nth(i).locator("td");
        const caseNo = (await cells.nth(1).textContent())?.trim() || "";
        if (caseNo) caseNos.add(caseNo);
      }
      console.log(`[用例编号] 前20条中唯一编号: ${caseNos.size}`);
      if (caseNos.size === Math.min(rowCount, 20)) {
        console.log("[用例编号] ✓ 编号唯一");
      } else {
        console.log("[用例编号] ⚠️ 存在重复编号");
      }
    }
  });

  test("S4 用例: 内容和步骤非空检查", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /测试用例/ }).click();

    const table = page.locator(".screen.active .tbl-wrap table");
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();

    if (rowCount > 0) {
      let emptyContent = 0;
      let emptyStep = 0;
      for (let i = 0; i < Math.min(rowCount, 20); i++) {
        const cells = rows.nth(i).locator("td");
        const content = (await cells.nth(2).textContent())?.trim() || "";
        const step = (await cells.nth(3).textContent())?.trim() || "";
        if (!content) emptyContent++;
        if (!step) emptyStep++;
      }
      console.log(`[内容步骤] 空内容: ${emptyContent}/${Math.min(rowCount, 20)}`);
      console.log(`[内容步骤] 空步骤: ${emptyStep}/${Math.min(rowCount, 20)}`);
    }
  });

  test("S4 用例: 场景覆盖度分析", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /测试用例/ }).click();

    const table = page.locator(".screen.active .tbl-wrap table");
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();

    if (rowCount > 0) {
      // 分析场景类型关键词
      const sceneKeywords = {
        normal: ["正常", "成功", "有效", "标准", "预期"],
        exception: ["异常", "失败", "错误", "无效", "非法", "不合法"],
        boundary: ["边界", "临界", "最大", "最小", "空", "零"],
        permission: ["权限", "授权", "未登录", "无权限", "角色"],
        compatibility: ["兼容", "适配", "不同", "跨", "多端"],
        data: ["数据", "存储", "读取", "写入", "格式"],
        performance: ["性能", "压力", "并发", "大量", "大数据"],
        security: ["安全", "加密", "注入", "攻击", "敏感"],
      };

      const sceneCount: Record<string, number> = {};
      for (const key of Object.keys(sceneKeywords)) {
        sceneCount[key] = 0;
      }

      for (let i = 0; i < Math.min(rowCount, 30); i++) {
        const cells = rows.nth(i).locator("td");
        const content = (await cells.nth(2).textContent())?.trim() || "";
        const step = (await cells.nth(3).textContent())?.trim() || "";
        const text = (content + " " + step).toLowerCase();

        for (const [scene, keywords] of Object.entries(sceneKeywords)) {
          if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
            sceneCount[scene]++;
          }
        }
      }

      console.log(`[场景覆盖] 分析前${Math.min(rowCount, 30)}条用例:`);
      for (const [scene, count] of Object.entries(sceneCount)) {
        console.log(`  ${scene}: ${count}条`);
      }

      const coveredScenes = Object.values(sceneCount).filter(c => c > 0).length;
      console.log(`[场景覆盖] 覆盖场景类型: ${coveredScenes}/8`);

      // 建议
      if (coveredScenes < 5) {
        console.log("[场景覆盖] ⚠️ 场景覆盖不足5种，建议补充");
      }
    }
  });

  test("S4 用例: 编辑能力 - 修改单元格内容", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /测试用例/ }).click();

    const table = page.locator(".screen.active .tbl-wrap table");
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();

    if (rowCount > 0) {
      // 点击第一行的"内容"单元格进入编辑
      const firstRowContent = rows.first().locator("td:nth-child(3) span");
      if ((await firstRowContent.count()) > 0) {
        await firstRowContent.click();
        await page.waitForTimeout(300);

        const input = firstRowContent.locator("input");
        if ((await input.count()) > 0) {
          console.log("[编辑] ✓ 单元格进入编辑态");
          await input.press("Escape"); // 取消编辑
        } else {
          console.log("[编辑] ℹ️ 单元格无编辑态（可能直接编辑）");
        }
      }
    }
  });

  test("S4 用例: 全量数据完整性检查", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /测试用例/ }).click();

    const table = page.locator(".screen.active .tbl-wrap table");
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();

    console.log(`[完整性] 总用例数: ${rowCount}`);

    if (rowCount > 0) {
      // 检查预期结果列是否有内容
      let emptyExpected = 0;
      for (let i = 0; i < Math.min(rowCount, 10); i++) {
        const cells = rows.nth(i).locator("td");
        const expected = (await cells.nth(4).textContent())?.trim() || "";
        if (!expected) emptyExpected++;
      }
      console.log(`[完整性] 空预期结果: ${emptyExpected}/${Math.min(rowCount, 10)}`);

      // 截图
      await page.screenshot({ path: "test-results/case-completeness.png", fullPage: true });
    }
  });

  test("S4 用例: 场景覆盖度详细报告", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /测试用例/ }).click();

    const table = page.locator(".screen.active .tbl-wrap table");
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();

    if (rowCount > 0) {
      const allCases: string[] = [];
      for (let i = 0; i < Math.min(rowCount, 50); i++) {
        const cells = rows.nth(i).locator("td");
        const content = (await cells.nth(2).textContent())?.trim() || "";
        allCases.push(content);
      }

      // 场景分类
      const categories = {
        "功能测试": ["登录", "注册", "提交", "保存", "创建", "删除", "更新", "查询", "搜索"],
        "边界条件": ["空", "最大", "最小", "0", "100", "长度", "限制"],
        "异常处理": ["错误", "失败", "异常", "无效", "错误码"],
        "权限控制": ["权限", "角色", "访问", "未授权", "禁止"],
        "兼容性": ["浏览器", "分辨率", "设备", "跨平台"],
        "安全测试": ["XSS", "注入", "CSRF", "加密", "泄露"],
        "性能测试": ["响应", "加载", "超时", "并发", "压力"],
        "数据验证": ["格式", "类型", "范围", "校验", "规则"],
      };

      const coverage: Record<string, number> = {};
      for (const [cat, keywords] of Object.entries(categories)) {
        coverage[cat] = 0;
        for (const caseText of allCases) {
          if (keywords.some(kw => caseText.includes(kw))) {
            coverage[cat]++;
          }
        }
      }

      console.log(`\n===== 测试用例场景覆盖度报告 =====`);
      console.log(`总用例数: ${rowCount}`);
      console.log(`分析样本: ${Math.min(rowCount, 50)}条`);
      console.log(`\n场景类别覆盖:`);
      for (const [cat, count] of Object.entries(coverage)) {
        const pct = Math.round((count / Math.min(rowCount, 50)) * 100);
        const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
        console.log(`  ${cat.padEnd(10)}: ${bar} ${count}条 (${pct}%)`);
      }

      const coveredCats = Object.values(coverage).filter(c => c > 0).length;
      console.log(`\n覆盖类别: ${coveredCats}/${Object.keys(categories).length}`);

      // 结论
      if (coveredCats >= 6) {
        console.log(`✅ 场景覆盖充分`);
      } else if (coveredCats >= 4) {
        console.log(`⚠️  场景覆盖中等，建议补充`);
      } else {
        console.log(`❌ 场景覆盖不足，需大幅补充`);
      }
    }
  });
});
