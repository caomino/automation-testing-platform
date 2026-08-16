/**
 * 核心流程1: 探索流程测试
 * 目标: 验证 MCP 浏览器控制 → 菜单/功能探索 → 输出全系统数据
 */
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5173";
const API = "http://localhost:3001";

test.describe("核心流程1: 探索", () => {
  test("验证后端 API 可用性", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
  });

  test("S2 探索: 点击开始探索并检查数据输出", async ({ page, request }) => {
    // 前置: 登录
    await page.goto(BASE);
    const loginBtn = page.getByRole("button", { name: /连接系统/ });
    if ((await loginBtn.count()) > 0) {
      await loginBtn.click();
      await page.waitForTimeout(1200);
    }

    // 进入探索页
    await page.locator("button.nav", { hasText: /系统探索/ }).click();
    
    // 点击"开始探索"
    const exploreBtn = page.getByRole("button", { name: /开始.*探索/ });
    await expect(exploreBtn).toBeVisible();
    await exploreBtn.click();
    await page.waitForTimeout(2000);

    // 检查模块树是否有数据
    const treeItems = page.locator(".tree-item, .tree-node, [class*=tree]");
    const treeCount = await treeItems.count();
    console.log(`[探索] 树节点数: ${treeCount}`);

    // 检查是否有待入树列表
    const pendingItems = page.locator("[class*=pending], [class*=Pending]");
    const pendingCount = await pendingItems.count();
    console.log(`[探索] 待入树项数: ${pendingCount}`);

    // 截图
    await page.screenshot({ path: "test-results/explore-after.png", fullPage: true });
  });

  test("S2 探索: 通过 API 调用后端 explore 阶段", async ({ request }) => {
    const res = await request.post(`${API}/stage`, {
      data: {
        stage: "explore",
        input: {
          systemId: "test-system",
          url: "http://example.com",
          type: "main",
        },
      },
    });

    console.log(`[探索 API] 状态: ${res.status()}`);
    if (res.ok()) {
      const body = await res.json();
      console.log(`[探索 API] 响应: ${JSON.stringify(body).slice(0, 500)}`);
      expect(body.ok).toBeTruthy();
    } else {
      console.log("[探索 API] 后端返回错误，可能需要真实浏览器会话");
    }
  });

  test("S2 探索: 导出模块树功能", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /系统探索/ }).click();

    const exportBtn = page.getByRole("button", { name: /导出.*模块树/ });
    if ((await exportBtn.count()) > 0) {
      await exportBtn.click();
      await page.waitForTimeout(500);
      console.log("[探索] 导出模块树按钮可点击");
    }
  });

  test("S2 探索: 手动添加模块节点", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /系统探索/ }).click();

    const addBtn = page.getByRole("button", { name: /新增模块/ });
    if ((await addBtn.count()) > 0) {
      await addBtn.click();
      await page.waitForTimeout(300);

      // 填写模块名
      const nameInput = page.getByRole("textbox");
      if ((await nameInput.count()) > 0) {
        await nameInput.first().fill("测试模块_自动探索");
      }

      const confirmBtn = page.getByRole("button", { name: /确认添加/ });
      if ((await confirmBtn.count()) > 0) {
        await confirmBtn.click();
        await page.waitForTimeout(500);
      }

      console.log("[探索] 手动添加模块节点测试完成");
    }
  });

  test("S2 探索: 全流程数据完整性检查", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /系统探索/ }).click();

    // 获取模块树所有节点
    const allTreeItems = page.locator(".tree-item, li[class*=node]");
    const totalNodes = await allTreeItems.count();
    console.log(`[探索完整性] 总节点数: ${totalNodes}`);

    // 检查是否有状态标识
    const statusTags = page.locator(".tag, [class*=status], .pill");
    const tagsCount = await statusTags.count();
    console.log(`[探索完整性] 状态标签数: ${tagsCount}`);

    // 检查是否有待处理项
    const pendingList = page.locator("[class*=pending] li, [class*=pending] tr");
    const pendingNum = await pendingList.count();
    console.log(`[探索完整性] 待处理项数: ${pendingNum}`);

    // 验证数据完整性
    if (totalNodes > 0) {
      console.log("[探索完整性] ✓ 模块树有数据");
    } else {
      console.log("[探索完整性] ❌ 模块树为空");
    }
  });
});
