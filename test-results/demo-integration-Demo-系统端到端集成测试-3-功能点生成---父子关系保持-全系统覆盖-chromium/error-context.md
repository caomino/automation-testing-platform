# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: demo-integration.spec.ts >> Demo 系统端到端集成测试 >> 3. 功能点生成 - 父子关系保持 + 全系统覆盖
- Location: e2e\demo-integration.spec.ts:131:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.textContent: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('.screen.active .tbl-wrap table tbody tr').nth(1).locator('td').nth(5)

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e4]: TestMaster · 商业版
    - generic [ref=e6]:
      - generic [ref=e7]: 📁 E2E测试项目
      - text: ›
      - generic [ref=e8]:
        - text: 🖥️ fantastic
        - code [ref=e9]: https://fantastic-admin-pro-example.pages.dev/#/
    - generic [ref=e10]: ✓ 已登录 · fantastic
    - button "退出登录" [ref=e12] [cursor=pointer]
    - button "播放下一步 ▷" [ref=e13] [cursor=pointer]
  - generic [ref=e14]:
    - complementary [ref=e15]:
      - generic [ref=e16]:
        - heading "流水线" [level=6] [ref=e17]
        - button "1 工作台" [ref=e18] [cursor=pointer]:
          - generic [ref=e19]: "1"
          - text: 工作台
        - button "2 系统探索" [ref=e20] [cursor=pointer]:
          - generic [ref=e21]: "2"
          - text: 系统探索
        - button "3 功能点审核" [active] [ref=e22] [cursor=pointer]:
          - generic [ref=e23]: "3"
          - text: 功能点审核
        - button "4 测试用例" [ref=e24] [cursor=pointer]:
          - generic [ref=e25]: "4"
          - text: 测试用例
        - button "5 执行" [ref=e26] [cursor=pointer]:
          - generic [ref=e27]: "5"
          - text: 执行
        - button "6 缺陷" [ref=e28] [cursor=pointer]:
          - generic [ref=e29]: "6"
          - text: 缺陷
      - generic [ref=e30]:
        - heading "系统" [level=6] [ref=e31]
        - button "⚙ 日志管理" [ref=e32] [cursor=pointer]:
          - generic [ref=e33]: ⚙
          - text: 日志管理
        - button "AI AI 模型配置" [ref=e34] [cursor=pointer]:
          - generic [ref=e35]: AI
          - text: AI 模型配置
      - generic [ref=e36]:
        - heading "项目" [level=6] [ref=e37]
        - button "9 项目管理" [ref=e38] [cursor=pointer]:
          - generic [ref=e39]: "9"
          - text: 项目管理
        - button "10 知识库" [ref=e40] [cursor=pointer]:
          - generic [ref=e41]: "10"
          - text: 知识库
    - main [ref=e42]:
      - generic [ref=e43]:
        - generic [ref=e44]:
          - generic [ref=e45]:
            - heading "③ 功能点审核" [level=2] [ref=e46]
            - generic [ref=e47]: 九列 + 纵向合并 + 增删 + 整体确认 · 镜像 TestMaster · 严格遵循金标准
          - generic [ref=e48]:
            - button "加载固定模板" [ref=e49] [cursor=pointer]
            - button "加载本轮版本" [ref=e50] [cursor=pointer]
            - button "生成功能点" [ref=e51] [cursor=pointer]
            - button "保存草稿" [ref=e52] [cursor=pointer]
            - button "导出 Excel" [ref=e53] [cursor=pointer]
            - button "✓ 整体确认" [ref=e54] [cursor=pointer]
        - generic [ref=e55]:
          - button "+ 新增行" [ref=e56] [cursor=pointer]
          - button "📋 复制到 Excel" [ref=e57] [cursor=pointer]
          - generic [ref=e58]: 待确认
        - table [ref=e60]:
          - rowgroup [ref=e61]:
            - row [ref=e62]:
              - columnheader "序号" [ref=e63]
              - columnheader "测试类型" [ref=e64]
              - columnheader "需求章节" [ref=e65]
              - columnheader "系统名称" [ref=e66]
              - columnheader "主模块" [ref=e67]
              - columnheader "子模块" [ref=e68]
              - columnheader "功能点" [ref=e69]
              - columnheader "测试点" [ref=e70]
              - columnheader "测试点标识" [ref=e71]
              - columnheader "操作" [ref=e72]
          - rowgroup [ref=e73]:
            - row [ref=e74]:
              - cell "1" [ref=e75]
              - cell "功能性测试" [ref=e76]
              - cell [ref=e77]
              - cell "fantastic" [ref=e78]
              - cell "欢迎使用 👋🏻Fantastic-admin 账号密码登录 扫码登录记住我忘记密码了?登录..." [ref=e79]
              - cell "DIV" [ref=e80]
              - cell "欢迎使用 👋🏻Fantastic-admin 账号密码登录 扫码登录记住我忘记密码了?登录...-BUTTON" [ref=e81]
              - cell "BUTTON" [ref=e82]
              - cell "FANTASTIC_A79FAE_120A3E_01" [ref=e83]
              - cell [ref=e84]:
                - generic [ref=e85]:
                  - button "+" [ref=e86] [cursor=pointer]
                  - button "×" [ref=e87] [cursor=pointer]
            - row [ref=e88]:
              - cell "1" [ref=e89]
              - cell "欢迎使用 👋🏻Fantastic-admin 账号密码登录 扫码登录记住我忘记密码了?登录..." [ref=e90]
              - cell "BUTTON" [ref=e91]
              - cell "FANTASTIC_A79FAE_A79FAE_01" [ref=e92]
              - cell [ref=e93]:
                - generic [ref=e94]:
                  - button "+" [ref=e95] [cursor=pointer]
                  - button "×" [ref=e96] [cursor=pointer]
            - row [ref=e97]:
              - cell "1" [ref=e98]
              - cell "DIV" [ref=e99]
              - cell "BUTTON" [ref=e100]
              - cell "FANTASTIC_A79FAE_BDC6B7_01" [ref=e101]
              - cell [ref=e102]:
                - generic [ref=e103]:
                  - button "+" [ref=e104] [cursor=pointer]
                  - button "×" [ref=e105] [cursor=pointer]
            - row [ref=e106]:
              - cell "2" [ref=e107]
              - cell "BUTTON" [ref=e108]
              - cell "FANTASTIC_A79FAE_BDC6B7_02" [ref=e109]
              - cell [ref=e110]:
                - generic [ref=e111]:
                  - button "+" [ref=e112] [cursor=pointer]
                  - button "×" [ref=e113] [cursor=pointer]
            - row [ref=e114]:
              - cell "1" [ref=e115]
              - cell "欢迎使用 👋🏻Fantastic-admin" [ref=e116]
              - cell "欢迎使用 👋🏻Fantastic-admin 账号密码登录 扫码登录记住我忘记密码了?登录...-欢迎使用 👋🏻" [ref=e117]
              - cell "欢迎使用 👋🏻" [ref=e118]
              - cell "FANTASTIC_299A5A_761599_01" [ref=e119]
              - cell [ref=e120]:
                - generic [ref=e121]:
                  - button "+" [ref=e122] [cursor=pointer]
                  - button "×" [ref=e123] [cursor=pointer]
            - row [ref=e124]:
              - cell "2" [ref=e125]
              - cell "欢迎使用 👋🏻Fantastic-admin 账号密码登录 扫码登录记住我忘记密码了?登录...-Fantastic-admin" [ref=e126]
              - cell "Fantastic-admin" [ref=e127]
              - cell "FANTASTIC_299A5A_761599_02" [ref=e128]
              - cell [ref=e129]:
                - generic [ref=e130]:
                  - button "+" [ref=e131] [cursor=pointer]
                  - button "×" [ref=e132] [cursor=pointer]
            - row [ref=e133]:
              - cell "1" [ref=e134]
              - cell "账号密码登录 扫码登录" [ref=e135]
              - cell "账号密码登录" [ref=e136]
              - cell "账号密码登录 扫码登录-账号密码登录" [ref=e137]
              - cell "账号密码登录" [ref=e138]
              - cell "FANTASTIC_CFBAF6_34A070_01" [ref=e139]
              - cell [ref=e140]:
                - generic [ref=e141]:
                  - button "+" [ref=e142] [cursor=pointer]
                  - button "×" [ref=e143] [cursor=pointer]
            - row [ref=e144]:
              - cell "1" [ref=e145]
              - cell "扫码登录" [ref=e146]
              - cell "账号密码登录 扫码登录-扫码登录" [ref=e147]
              - cell "扫码登录" [ref=e148]
              - cell "FANTASTIC_CFBAF6_79AC1E_01" [ref=e149]
              - cell [ref=e150]:
                - generic [ref=e151]:
                  - button "+" [ref=e152] [cursor=pointer]
                  - button "×" [ref=e153] [cursor=pointer]
            - row [ref=e154]:
              - cell "1" [ref=e155]
              - cell "DIV" [ref=e156]
              - cell "account" [ref=e157]
              - cell "DIV-account" [ref=e158]
              - cell "account" [ref=e159]
              - cell "FANTASTIC_159501_90EE1B_01" [ref=e160]
              - cell [ref=e161]:
                - generic [ref=e162]:
                  - button "+" [ref=e163] [cursor=pointer]
                  - button "×" [ref=e164] [cursor=pointer]
            - row [ref=e165]:
              - cell "2" [ref=e166]
              - cell "DIV-DIV" [ref=e167]
              - cell "DIV" [ref=e168]
              - cell "FANTASTIC_159501_90EE1B_02" [ref=e169]
              - cell [ref=e170]:
                - generic [ref=e171]:
                  - button "+" [ref=e172] [cursor=pointer]
                  - button "×" [ref=e173] [cursor=pointer]
            - row [ref=e174]:
              - cell "1" [ref=e175]
              - cell "DIV" [ref=e176]
              - cell "DIV" [ref=e177]
              - cell "FANTASTIC_521C98_159501_01" [ref=e178]
              - cell [ref=e179]:
                - generic [ref=e180]:
                  - button "+" [ref=e181] [cursor=pointer]
                  - button "×" [ref=e182] [cursor=pointer]
            - row [ref=e183]:
              - cell "1" [ref=e184]
              - cell "password" [ref=e185]
              - cell "DIV-password" [ref=e186]
              - cell "password" [ref=e187]
              - cell "FANTASTIC_999B6E_BD7E3F_01" [ref=e188]
              - cell [ref=e189]:
                - generic [ref=e190]:
                  - button "+" [ref=e191] [cursor=pointer]
                  - button "×" [ref=e192] [cursor=pointer]
            - row [ref=e193]:
              - cell "2" [ref=e194]
              - cell "DIV-DIV" [ref=e195]
              - cell "DIV" [ref=e196]
              - cell "FANTASTIC_999B6E_BD7E3F_02" [ref=e197]
              - cell [ref=e198]:
                - generic [ref=e199]:
                  - button "+" [ref=e200] [cursor=pointer]
                  - button "×" [ref=e201] [cursor=pointer]
            - row [ref=e202]:
              - cell "1" [ref=e203]
              - cell "DIV" [ref=e204]
              - cell "DIV" [ref=e205]
              - cell "FANTASTIC_02C78B_999B6E_01" [ref=e206]
              - cell [ref=e207]:
                - generic [ref=e208]:
                  - button "+" [ref=e209] [cursor=pointer]
                  - button "×" [ref=e210] [cursor=pointer]
            - row [ref=e211]:
              - cell "1" [ref=e212]
              - cell "记住我" [ref=e213]
              - cell "记住我" [ref=e214]
              - cell "记住我-记住我" [ref=e215]
              - cell "记住我" [ref=e216]
              - cell "FANTASTIC_D05938_25DE0E_01" [ref=e217]
              - cell [ref=e218]:
                - generic [ref=e219]:
                  - button "+" [ref=e220] [cursor=pointer]
                  - button "×" [ref=e221] [cursor=pointer]
            - row [ref=e222]:
              - cell "1" [ref=e223]
              - cell "记住我-DIV" [ref=e224]
              - cell "DIV" [ref=e225]
              - cell "FANTASTIC_1AC7BF_D05938_01" [ref=e226]
              - cell [ref=e227]:
                - generic [ref=e228]:
                  - button "+" [ref=e229] [cursor=pointer]
                  - button "×" [ref=e230] [cursor=pointer]
            - row [ref=e231]:
              - cell "1" [ref=e232]
              - cell "记住我忘记密码了?登录还没有帐号?注册新帐号" [ref=e233]
              - cell "记住我忘记密码了?" [ref=e234]
              - cell "记住我忘记密码了?登录还没有帐号?注册新帐号-忘记密码了?" [ref=e235]
              - cell "忘记密码了?" [ref=e236]
              - cell "FANTASTIC_651FE6_15C8EF_01" [ref=e237]
              - cell [ref=e238]:
                - generic [ref=e239]:
                  - button "+" [ref=e240] [cursor=pointer]
                  - button "×" [ref=e241] [cursor=pointer]
            - row [ref=e242]:
              - cell "1" [ref=e243]
              - cell "记住我忘记密码了?登录还没有帐号?注册新帐号演示账号一键登录 admin test" [ref=e244]
              - cell "记住我忘记密码了?登录还没有帐号?注册新帐号" [ref=e245]
              - cell "记住我忘记密码了?登录还没有帐号?注册新帐号演示账号一键登录 admin test-登录" [ref=e246]
              - cell "登录" [ref=e247]
              - cell "FANTASTIC_4F0DAB_651FE6_01" [ref=e248]
              - cell [ref=e249]:
                - generic [ref=e250]:
                  - button "+" [ref=e251] [cursor=pointer]
                  - button "×" [ref=e252] [cursor=pointer]
            - row [ref=e253]:
              - cell "1" [ref=e254]
              - cell "记住我忘记密码了?登录还没有帐号?注册新帐号" [ref=e255]
              - cell "还没有帐号?注册新帐号" [ref=e256]
              - cell "记住我忘记密码了?登录还没有帐号?注册新帐号-注册新帐号" [ref=e257]
              - cell "注册新帐号" [ref=e258]
              - cell "FANTASTIC_651FE6_A0EB7C_01" [ref=e259]
              - cell [ref=e260]:
                - generic [ref=e261]:
                  - button "+" [ref=e262] [cursor=pointer]
                  - button "×" [ref=e263] [cursor=pointer]
            - row [ref=e264]:
              - cell "1" [ref=e265]
              - cell "记住我忘记密码了?登录还没有帐号?注册新帐号演示账号一键登录 admin test" [ref=e266]
              - cell "演示账号一键登录 admin test" [ref=e267]
              - cell "记住我忘记密码了?登录还没有帐号?注册新帐号演示账号一键登录 admin test-演示账号一键登录" [ref=e268]
              - cell "演示账号一键登录" [ref=e269]
              - cell "FANTASTIC_4F0DAB_1E8D9E_01" [ref=e270]
              - cell [ref=e271]:
                - generic [ref=e272]:
                  - button "+" [ref=e273] [cursor=pointer]
                  - button "×" [ref=e274] [cursor=pointer]
            - row [ref=e275]:
              - cell "1" [ref=e276]
              - cell "演示账号一键登录 admin test" [ref=e277]
              - cell "admin test" [ref=e278]
              - cell "演示账号一键登录 admin test-admin" [ref=e279]
              - cell "admin" [ref=e280]
              - cell "FANTASTIC_1E8D9E_486A59_01" [ref=e281]
              - cell [ref=e282]:
                - generic [ref=e283]:
                  - button "+" [ref=e284] [cursor=pointer]
                  - button "×" [ref=e285] [cursor=pointer]
            - row [ref=e286]:
              - cell "2" [ref=e287]
              - cell "演示账号一键登录 admin test-test" [ref=e288]
              - cell "test" [ref=e289]
              - cell "FANTASTIC_1E8D9E_486A59_02" [ref=e290]
              - cell [ref=e291]:
                - generic [ref=e292]:
                  - button "+" [ref=e293] [cursor=pointer]
                  - button "×" [ref=e294] [cursor=pointer]
            - row [ref=e295]:
              - cell "1" [ref=e296]
              - cell "欢迎使用 👋🏻Fantastic-admin 账号密码登录 扫码登录记住我忘记密码了?登录..." [ref=e297]
              - cell "Copyright2020-presentFantastic-admin" [ref=e298]
              - cell "欢迎使用 👋🏻Fantastic-admin 账号密码登录 扫码登录记住我忘记密码了?登录...-Fantastic-admin" [ref=e299]
              - cell "Fantastic-admin" [ref=e300]
              - cell "FANTASTIC_A79FAE_FE8DC6_01" [ref=e301]
              - cell [ref=e302]:
                - generic [ref=e303]:
                  - button "+" [ref=e304] [cursor=pointer]
                  - button "×" [ref=e305] [cursor=pointer]
            - row [ref=e306]:
              - cell "2" [ref=e307]
              - cell "欢迎使用 👋🏻Fantastic-admin 账号密码登录 扫码登录记住我忘记密码了?登录...-DIV" [ref=e308]
              - cell "DIV" [ref=e309]
              - cell "FANTASTIC_A79FAE_FE8DC6_02" [ref=e310]
              - cell [ref=e311]:
                - generic [ref=e312]:
                  - button "+" [ref=e313] [cursor=pointer]
                  - button "×" [ref=e314] [cursor=pointer]
```

# Test source

```ts
  84  |   // ========== 流程1: 探索 ==========
  85  |   test("2. 探索流程 - MCP 浏览器控制 + 菜单/功能探索", async ({ request, page }) => {
  86  |     console.log(`\n[探索] 开始 MCP 浏览器探索流程`);
  87  | 
  88  |     // 先用 UI 方式走一遍探索
  89  |     await page.goto(BASE);
  90  |     console.log(`[探索] 已进入工作台页面`);
  91  | 
  92  |     // 连接系统
  93  |     const loginBtn = page.getByRole("button", { name: /连接系统/ });
  94  |     if ((await loginBtn.count()) > 0) {
  95  |       await loginBtn.click();
  96  |       await page.waitForTimeout(1500);
  97  |       console.log(`[探索] ✓ 系统连接完成`);
  98  |     }
  99  | 
  100 |     // 进入探索页
  101 |     await page.locator("button.nav", { hasText: /系统探索/ }).click();
  102 |     console.log(`[探索] ✓ 已进入系统探索页面`);
  103 | 
  104 |     // 点击开始探索
  105 |     const exploreBtn = page.getByRole("button", { name: /开始.*探索|AI.*探索|自动探索/ });
  106 |     const btnCount = await exploreBtn.count();
  107 |     console.log(`[探索] 探索按钮数: ${btnCount}`);
  108 | 
  109 |     if (btnCount > 0) {
  110 |       await exploreBtn.first().click();
  111 |       await page.waitForTimeout(3000);
  112 |       console.log(`[探索] ✓ 已触发探索流程`);
  113 |     }
  114 | 
  115 |     // 检查模块树
  116 |     const treeItems = page.locator(".tree-item, .tree-node, [class*='node']");
  117 |     const treeCount = await treeItems.count();
  118 |     console.log(`[探索] 模块树节点数: ${treeCount}`);
  119 | 
  120 |     // 检查待入树项
  121 |     const pendingItems = page.locator("[class*='pending'] li, [class*='Pending'] li");
  122 |     const pendingCount = await pendingItems.count();
  123 |     console.log(`[探索] 待入树项数: ${pendingCount}`);
  124 | 
  125 |     // 截图
  126 |     await page.screenshot({ path: "test-results/demo-explore.png", fullPage: true });
  127 |     console.log(`[探索] ✓ 探索完成，截图已保存`);
  128 |   });
  129 | 
  130 |   // ========== 流程2: 功能点生成 ==========
  131 |   test("3. 功能点生成 - 父子关系保持 + 全系统覆盖", async ({ page }) => {
  132 |     console.log(`\n[功能点] 开始功能点生成流程`);
  133 | 
  134 |     await page.goto(BASE);
  135 | 
  136 |     // 确保已登录
  137 |     const loginBtn = page.getByRole("button", { name: /连接系统/ });
  138 |     if ((await loginBtn.count()) > 0) {
  139 |       await loginBtn.click();
  140 |       await page.waitForTimeout(1200);
  141 |     }
  142 | 
  143 |     // 进入功能点审核页
  144 |     await page.locator("button.nav", { hasText: /功能点审核/ }).click();
  145 |     console.log(`[功能点] ✓ 已进入功能点审核页面`);
  146 | 
  147 |     // 获取当前表格数据
  148 |     const table = page.locator(".screen.active .tbl-wrap table");
  149 |     await expect(table).toBeVisible();
  150 | 
  151 |     const headers = table.locator("thead th");
  152 |     const colCount = await headers.count();
  153 |     console.log(`[功能点] 表格列数: ${colCount}`);
  154 | 
  155 |     const rows = table.locator("tbody tr");
  156 |     const rowCount = await rows.count();
  157 |     console.log(`[功能点] 当前行数: ${rowCount}`);
  158 | 
  159 |     // 使用 AI 批量生成功能点
  160 |     const aiBtn = page.getByRole("button", { name: /AI 提效|AI 生成|批量生成/ });
  161 |     if ((await aiBtn.count()) > 0) {
  162 |       console.log(`[功能点] 发现 AI 生成按钮`);
  163 |       const beforeCount = await rows.count();
  164 | 
  165 |       await aiBtn.first().click();
  166 |       await page.waitForTimeout(3000);
  167 | 
  168 |       const afterCount = await page.locator(".screen.active .tbl-wrap table tbody tr").count();
  169 |       const newRows = afterCount - beforeCount;
  170 |       console.log(`[功能点] AI 生成: 新增 ${newRows} 行`);
  171 |     }
  172 | 
  173 |     // 检查父子关系
  174 |     const updatedRows = page.locator(".screen.active .tbl-wrap table tbody tr");
  175 |     const totalRows = await updatedRows.count();
  176 | 
  177 |     if (totalRows > 0) {
  178 |       console.log(`[功能点] 检查父子关系 (前${Math.min(totalRows, 10)}条):`);
  179 |       const hierarchy: { module: string; subModule: string; feature: string; id: string }[] = [];
  180 | 
  181 |       for (let i = 0; i < Math.min(totalRows, 10); i++) {
  182 |         const cells = updatedRows.nth(i).locator("td");
  183 |         const module = (await cells.nth(4).textContent())?.trim() || "";  // 主模块
> 184 |         const subModule = (await cells.nth(5).textContent())?.trim() || "";  // 子模块
      |                                               ^ Error: locator.textContent: Test timeout of 30000ms exceeded.
  185 |         const feature = (await cells.nth(6).textContent())?.trim() || "";  // 功能点
  186 |         const id = (await cells.nth(8).textContent())?.trim() || "";  // 测试点标识
  187 | 
  188 |         hierarchy.push({ module, subModule, feature, id });
  189 |         console.log(`  ${i + 1}. ${module} > ${subModule} > ${feature} [ID: ${id}]`);
  190 |       }
  191 | 
  192 |       // 验证完整性
  193 |       const emptyFields = hierarchy.filter(h => !h.module || !h.subModule || !h.feature);
  194 |       if (emptyFields.length === 0) {
  195 |         console.log(`[功能点] ✓ 所有记录父子关系完整`);
  196 |       } else {
  197 |         console.log(`[功能点] ⚠️  有 ${emptyFields.length} 条记录缺少必要字段`);
  198 |       }
  199 | 
  200 |       // 验证 ID 格式
  201 |       const validIds = hierarchy.filter(h => h.id && h.id.length > 0);
  202 |       console.log(`[功能点] ID 有效率: ${validIds.length}/${hierarchy.length}`);
  203 |     }
  204 | 
  205 |     await page.screenshot({ path: "test-results/demo-feature.png", fullPage: true });
  206 |   });
  207 | 
  208 |   // ========== 流程3: 测试用例生成 ==========
  209 |   test("4. 测试用例生成 - 场景覆盖全面性检查", async ({ page }) => {
  210 |     console.log(`\n[测试用例] 开始测试用例生成流程`);
  211 | 
  212 |     await page.goto(BASE);
  213 | 
  214 |     // 确保已登录
  215 |     const loginBtn = page.getByRole("button", { name: /连接系统/ });
  216 |     if ((await loginBtn.count()) > 0) {
  217 |       await loginBtn.click();
  218 |       await page.waitForTimeout(1200);
  219 |     }
  220 | 
  221 |     // 进入测试用例页
  222 |     await page.locator("button.nav", { hasText: /测试用例/ }).click();
  223 |     console.log(`[测试用例] ✓ 已进入测试用例页面`);
  224 | 
  225 |     const table = page.locator(".screen.active .tbl-wrap table");
  226 |     await expect(table).toBeVisible();
  227 | 
  228 |     // 检查列结构
  229 |     const headers = table.locator("thead th");
  230 |     const colCount = await headers.count();
  231 |     console.log(`[测试用例] 列数: ${colCount}`);
  232 | 
  233 |     const expectedCols = ["#", "用例编号", "内容", "步骤", "操作", "预期结果", "首次结果", "回归结果", "结论"];
  234 |     const headerCheck: string[] = [];
  235 |     for (let i = 0; i < colCount; i++) {
  236 |       const text = (await headers.nth(i).textContent())?.trim() || "";
  237 |       const expected = expectedCols[i] || `列${i}`;
  238 |       const match = text === expected || text.includes(expected);
  239 |       headerCheck.push(match ? "✓" : "✗");
  240 |       console.log(`  列${i}: ${text} (期望: ${expected}) ${match ? "✓" : "✗"}`);
  241 |     }
  242 | 
  243 |     // 获取用例数据
  244 |     const rows = table.locator("tbody tr");
  245 |     const rowCount = await rows.count();
  246 |     console.log(`[测试用例] 总用例数: ${rowCount}`);
  247 | 
  248 |     if (rowCount > 0) {
  249 |       // 提取所有用例内容
  250 |       const cases: { no: string; content: string; step: string; expected: string }[] = [];
  251 |       const sampleSize = Math.min(rowCount, 30);
  252 | 
  253 |       for (let i = 0; i < sampleSize; i++) {
  254 |         const cells = rows.nth(i).locator("td");
  255 |         const no = (await cells.nth(1).textContent())?.trim() || "";
  256 |         const content = (await cells.nth(2).textContent())?.trim() || "";
  257 |         const step = (await cells.nth(3).textContent())?.trim() || "";
  258 |         const expected = (await cells.nth(4).textContent())?.trim() || "";
  259 |         cases.push({ no, content, step, expected });
  260 |       }
  261 | 
  262 |       // 场景分析
  263 |       console.log(`\n[测试用例] 场景覆盖度分析 (样本: ${sampleSize}条):`);
  264 | 
  265 |       const sceneAnalysis = analyzeScenes(cases.map(c => c.content + " " + c.step));
  266 |       for (const [scene, count] of Object.entries(sceneAnalysis)) {
  267 |         const pct = Math.round((count / sampleSize) * 100);
  268 |         const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
  269 |         console.log(`  ${scene.padEnd(12)}: ${bar} ${count}条 (${pct}%)`);
  270 |       }
  271 | 
  272 |       const coveredTypes = Object.values(sceneAnalysis).filter(c => c > 0).length;
  273 |       console.log(`\n  覆盖场景类型: ${coveredTypes}/8`);
  274 | 
  275 |       // 详细用例列表
  276 |       console.log(`\n[测试用例] 用例详情:`);
  277 |       for (const c of cases.slice(0, 10)) {
  278 |         console.log(`  ${c.no}: ${c.content.slice(0, 50)}...`);
  279 |       }
  280 | 
  281 |       // 完整性检查
  282 |       const emptyContent = cases.filter(c => !c.content).length;
  283 |       const emptyStep = cases.filter(c => !c.step).length;
  284 |       const emptyExpected = cases.filter(c => !c.expected).length;
```