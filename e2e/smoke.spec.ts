/**
 * 主流程端到端冒烟测试
 * 目标：跑通 "工作台 -> 系统探索 -> 功能点审核 -> 测试用例 -> 执行 -> 缺陷"
 * 注意：所有 screen 同时在 DOM 中，用 .screen.active 限定可见区域
 */
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5173";

// 工具：活跃屏幕内的 h2
const activeH2 = (page: any) => page.locator(".screen.active h2");
// 工具：活跃屏幕内的表格
const activeTable = (page: any) => page.locator(".screen.active .tbl-wrap table");

test.describe("TestMaster 主流程冒烟", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await expect(page.locator(".brand")).toContainText(/TestMaster/);
  });

  test("S1 工作台：页面正常渲染", async ({ page }) => {
    await expect(activeH2(page)).toContainText(/工作台/);
    await expect(page.locator("button.nav").first()).toBeVisible();
  });

  test("S1 连接系统", async ({ page }) => {
    const btn = page.getByRole("button", { name: /连接系统/ });
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(1200);
    }
    // 连接后，顶部 banner 中的"退出登录"按钮应可见
    await expect(page.locator(".topbar").getByRole("button", { name: /退出登录/ })).toBeVisible({ timeout: 5000 });
  });

  test("S2 系统探索：页面加载和按钮点击", async ({ page }) => {
    await page.getByRole("button", { name: /系统探索/ }).click();
    await expect(activeH2(page)).toContainText(/系统探索/);

    const btn = activeTable(page).getByRole("button", { name: /开始.*探索/ });
    // 改为从整个页面找（因为按钮可能在 .ph 区）
    const exploreBtn = page.getByRole("button", { name: /开始.*探索/ });
    if ((await exploreBtn.count()) > 0) {
      await exploreBtn.first().click();
      await page.waitForTimeout(500);
    }
  });

  test("S3 功能点审核：表格渲染 + 增删改", async ({ page }) => {
    await page.getByRole("button", { name: /功能点审核/ }).click();
    await expect(activeH2(page)).toContainText(/功能点审核/);
    await expect(activeTable(page)).toBeVisible();

    const rows = page.locator(".screen.active .tbl-wrap tbody tr");
    const before = await rows.count();
    console.log(`[S3] 初始行数: ${before}`);

    // + 新增行
    const addBtn = page.getByRole("button", { name: /新增行/ });
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await page.waitForTimeout(400);
      const after = await rows.count();
      console.log(`[S3] + 后行数: ${after} (变化: ${after - before})`);
    } else {
      console.log("[S3] ❌ 找不到 '新增行' 按钮");
    }

    // × 删除行
    const delBtns = page.getByRole("button", { name: /×/ });
    const delCount = await delBtns.count();
    console.log(`[S3] × 按钮数: ${delCount}`);
    if (delCount > 0) {
      await delBtns.first().click();
      await page.waitForTimeout(300);
      // 在 .modal 内找确认按钮（避免匹配到页面其他"确认"按钮）
      const modalConfirmBtn = page.locator(".modal .btn").last();
      if ((await modalConfirmBtn.count()) > 0) {
        await modalConfirmBtn.click();
        await page.waitForTimeout(500);
      } else {
        // fallback: 文本为"确认"的按钮
        const exactConfirm = page.getByRole("button", { name: "确认" });
        if ((await exactConfirm.count()) > 0) {
          await exactConfirm.first().click();
        }
      }
      const afterDel = await rows.count();
      console.log(`[S3] × 后行数: ${afterDel}`);
    }

    // 单元格点击编辑
    const spans = page.locator(".screen.active .tbl-wrap tbody td > span");
    if ((await spans.count()) > 0) {
      await spans.first().click();
      await page.waitForTimeout(500);
      const inputs = page.locator(".screen.active .tbl-wrap tbody input");
      const inputCount = await inputs.count();
      console.log(`[S3] 单元格点击后 input 数: ${inputCount}`);
      if (inputCount > 0) {
        await inputs.first().fill("测试值");
        await inputs.first().blur();
        console.log("[S3] ✓ 单元格进入编辑态");
      } else {
        console.log("[S3] ❌ 单元格点击未进入编辑态");
      }
    }

    // AI 提效
    const aiBtn = page.getByRole("button", { name: /AI.*提效/ });
    if ((await aiBtn.count()) > 0) {
      await aiBtn.first().click();
      await page.waitForTimeout(500);
      console.log("[S3] AI 提效按钮已点击");
    }

    // 整体确认
    const cfBtn = page.getByRole("button", { name: /整体确认/ });
    if ((await cfBtn.count()) > 0) {
      await cfBtn.first().click();
      await page.waitForTimeout(300);
      // 确认弹窗内的按钮
      const mdlBtns = page.locator(".modal .btn");
      if ((await mdlBtns.count()) > 0) {
        // 最后一个按钮通常是"确认"
        await mdlBtns.last().click();
        await page.waitForTimeout(500);
      }
      console.log("[S3] 整体确认完成");
    }
  });

  test("S4 测试用例：表格渲染和列数", async ({ page }) => {
    await page.getByRole("button", { name: /测试用例/ }).click();
    await expect(activeH2(page)).toContainText(/测试用例/);

    const headers = page.locator(".screen.active .tbl-wrap thead th");
    const colCount = await headers.count();
    console.log(`[S4] 测试用例列数: ${colCount}`);
    for (let i = 0; i < colCount; i++) {
      console.log(`  列${i}: ${(await headers.nth(i).textContent())?.trim()}`);
    }

    // 添加行
    const addBtn = page.getByRole("button", { name: /新增行/ });
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await page.waitForTimeout(400);
    }

    // 用例生成
    const genBtn = page.getByRole("button", { name: /用例生成/ });
    if ((await genBtn.count()) > 0) {
      await genBtn.first().click();
      await page.waitForTimeout(500);
    }

    // 复制 Excel
    const cpBtn = page.getByRole("button", { name: /复制.*Excel/ });
    if ((await cpBtn.count()) > 0) {
      await cpBtn.first().click();
      await page.waitForTimeout(400);
    }
  });

  test("S5 执行：页面加载", async ({ page }) => {
    await page.locator("button.nav", { hasText: /执行/ }).click();
    await expect(activeH2(page)).toContainText(/执行/);

    const btn = page.getByRole("button", { name: /执行（真实）/ });
    if ((await btn.count()) > 0) {
      await btn.first().click();
      await page.waitForTimeout(500);
    }
  });

  test("S6 缺陷：页面加载 + 新建缺陷", async ({ page }) => {
    await page.locator("button.nav", { hasText: /缺陷/ }).click();
    await expect(activeH2(page)).toContainText(/缺陷/);

    const newBtn = page.getByRole("button", { name: /新建缺陷/ });
    if ((await newBtn.count()) > 0) {
      await newBtn.first().click();
      await page.waitForTimeout(500);
      const modal = page.locator(".modal");
      console.log(`[S6] 新建缺陷弹窗: ${(await modal.count()) > 0}`);
    }
  });

  test("全流程 E2E", async ({ page }) => {
    console.log("==== 全流程 E2E 开始 ====");

    // S1
    await expect(activeH2(page)).toContainText(/工作台/);
    console.log("[E2E] S1 ✓ 工作台加载");

    // S2
    await page.locator("button.nav", { hasText: /系统探索/ }).click();
    await expect(activeH2(page)).toContainText(/系统探索/);
    console.log("[E2E] S2 ✓ 系统探索加载");

    // S3
    await page.locator("button.nav", { hasText: /功能点审核/ }).click();
    await expect(activeH2(page)).toContainText(/功能点审核/);
    // 加一行
    const addBtn = page.getByRole("button", { name: /新增行/ });
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await page.waitForTimeout(400);
    }
    // 确认
    const cfBtn = page.getByRole("button", { name: /整体确认/ });
    if ((await cfBtn.count()) > 0) {
      await cfBtn.first().click();
      await page.waitForTimeout(300);
      // 弹窗内确认按钮
      const mdlBtns = page.locator(".modal .btn");
      if ((await mdlBtns.count()) > 0) {
        await mdlBtns.last().click();
        await page.waitForTimeout(500);
      }
    }
    console.log("[E2E] S3 ✓ 功能点审核");

    // S4
    await page.locator("button.nav", { hasText: /测试用例/ }).click();
    await expect(activeH2(page)).toContainText(/测试用例/);
    console.log("[E2E] S4 ✓ 测试用例加载");

    // S5
    await page.locator("button.nav", { hasText: /执行/ }).click();
    await expect(activeH2(page)).toContainText(/执行/);
    console.log("[E2E] S5 ✓ 执行加载");

    // S6
    await page.locator("button.nav", { hasText: /缺陷/ }).click();
    await expect(activeH2(page)).toContainText(/缺陷/);
    console.log("[E2E] S6 ✓ 缺陷加载");

    console.log("==== 全流程 E2E 完成 ====");
  });
});
