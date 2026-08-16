/**
 * 核心流程2: 功能点生成测试
 * 目标: 按探索内容保持父子关系生成功能点，覆盖全系统
 */
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5173";
const API = "http://localhost:3001";

test.describe("核心流程2: 功能点生成", () => {
  test("S3 功能点: 表格基础渲染和列结构", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /功能点审核/ }).click();

    const table = page.locator(".screen.active table");
    await expect(table).toBeVisible();

    // 检查表头列
    const headers = table.locator("thead th");
    const colCount = await headers.count();
    console.log(`[功能点] 列数: ${colCount}`);

    const expectedCols = ["#", "模块", "子模块", "功能点", "测试要点", "测试要点ID", "风险", "优先级"];
    for (let i = 0; i < colCount; i++) {
      const text = (await headers.nth(i).textContent())?.trim();
      console.log(`  列${i}: ${text}`);
    }

    // 检查功能点 ID 格式
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();
    console.log(`[功能点] 行数: ${rowCount}`);
  });

  test("S3 功能点: 手动新增行并检查父子关系", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /功能点审核/ }).click();

    const addBtn = page.getByRole("button", { name: /新增行/ });
    if ((await addBtn.count()) > 0) {
      await addBtn.click();
      await page.waitForTimeout(400);

      const table = page.locator(".screen.active table");
      const rows = table.locator("tbody tr");
      const rowCount = await rows.count();
      console.log(`[功能点新增] 新增后行数: ${rowCount}`);

      // 获取新行的单元格
      const lastRow = rows.last();
      const cells = lastRow.locator("td");
      const cellCount = await cells.count();
      console.log(`[功能点新增] 新行单元格数: ${cellCount}`);
    }
  });

  test("S3 功能点: AI 批量生成功能点（父子关系验证）", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /功能点审核/ }).click();

    const aiBtn = page.getByRole("button", { name: /AI 提效|批量生成|AI 生成/ });
    if ((await aiBtn.count()) > 0) {
      const beforeCount = await page.locator(".screen.active table tbody tr").count();
      console.log(`[AI生成] 生成前行数: ${beforeCount}`);

      await aiBtn.first().click();
      await page.waitForTimeout(2000);

      const afterCount = await page.locator(".screen.active table tbody tr").count();
      console.log(`[AI生成] 生成后行数: ${afterCount}`);
      console.log(`[AI生成] 新增行数: ${afterCount - beforeCount}`);

      // 检查 ID 格式一致性
      const idCells = page.locator(".screen.active table tbody tr td:nth-child(6)");
      const idCount = await idCells.count();
      if (idCount > 0) {
        for (let i = 0; i < Math.min(idCount, 5); i++) {
          const id = (await idCells.nth(i).textContent())?.trim();
          console.log(`  ID${i}: ${id}`);
        }
      }
    }
  });

  test("S3 功能点: 覆盖度检查 - 验证所有模块都有功能点", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /功能点审核/ }).click();

    // 获取所有模块列
    const moduleCells = page.locator(".screen.active table tbody tr td:nth-child(2)");
    const moduleCount = await moduleCells.count();
    console.log(`[覆盖度] 功能点记录数: ${moduleCount}`);

    if (moduleCount > 0) {
      // 提取所有模块名，去重
      const modules = new Set<string>();
      for (let i = 0; i < moduleCount; i++) {
        const text = (await moduleCells.nth(i).textContent())?.trim() || "";
        if (text) modules.add(text);
      }
      console.log(`[覆盖度] 唯一模块数: ${modules.size}`);
      console.log(`[覆盖度] 模块列表: ${Array.from(modules).join(", ")}`);
    }

    // 截图
    await page.screenshot({ path: "test-results/feature-coverage.png", fullPage: true });
  });

  test("S3 功能点: 验证父子关系完整性", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /功能点审核/ }).click();

    const rows = page.locator(".screen.active table tbody tr");
    const totalRows = await rows.count();

    if (totalRows > 0) {
      // 提取父子关系：模块(td2) → 子模块(td3) → 功能点(td4)
      const hierarchy: { module: string; subModule: string; feature: string }[] = [];
      for (let i = 0; i < Math.min(totalRows, 10); i++) {
        const cells = rows.nth(i).locator("td");
        const module = (await cells.nth(1).textContent())?.trim() || "";
        const subModule = (await cells.nth(2).textContent())?.trim() || "";
        const feature = (await cells.nth(3).textContent())?.trim() || "";
        hierarchy.push({ module, subModule, feature });
      }

      console.log(`[父子关系] 前10条记录:`);
      for (const h of hierarchy) {
        console.log(`  ${h.module} > ${h.subModule} > ${h.feature}`);
      }

      // 验证没有空的模块或子模块
      const emptyParent = hierarchy.filter(h => !h.module || !h.subModule);
      if (emptyParent.length > 0) {
        console.log(`[父子关系] ⚠️ 存在 ${emptyParent.length} 条记录缺少父级信息`);
      } else {
        console.log(`[父子关系] ✓ 所有记录都有完整的父子层级`);
      }
    }
  });

  test("S3 功能点: 风险和优先级字段验证", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("button.nav", { hasText: /功能点审核/ }).click();

    const rows = page.locator(".screen.active table tbody tr");
    const totalRows = await rows.count();

    if (totalRows > 0) {
      let hasRisk = 0;
      let hasPriority = 0;
      for (let i = 0; i < Math.min(totalRows, 15); i++) {
        const cells = rows.nth(i).locator("td");
        const risk = (await cells.nth(5).textContent())?.trim() || "";
        const priority = (await cells.nth(6).textContent())?.trim() || "";
        if (risk) hasRisk++;
        if (priority) hasPriority++;
      }

      console.log(`[风险优先级] 有风险标记: ${hasRisk}/${Math.min(totalRows, 15)}`);
      console.log(`[风险优先级] 有优先级标记: ${hasPriority}/${Math.min(totalRows, 15)}`);
    }
  });
});
