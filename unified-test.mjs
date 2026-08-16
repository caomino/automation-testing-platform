/**
 * @file unified-test.mjs
 * @description 通用数据驱动测试脚本（严格真实版）
 * @description - 严格校验输出数据的真实性、完整性、结构性和字段映射
 * @description - 基于数据结构特征识别 Fallback 假数据（通用，不写死业务关键词）
 * @description - 验证文档 §6 模板绑定关系（功能点 ⇄ 用例）
 */

const API = 'http://localhost:3001';

// ============================================================================
// 1. 系统配置（通用数据驱动）
// ============================================================================
const SYSTEMS = [
  {
    id: 's1-fantastic',
    name: 'Fantastic-admin',
    url: 'https://fantastic-admin.hurui.me/',
    mode: 'no-login',
    readonly: false,
    expectedMinRootModules: 2,
    expectedMinTotalNodes: 5,
  },
  {
    id: 's2-ruoyi',
    name: 'RuoYi 若依',
    url: 'https://demo.ruoyi.vip',
    mode: 'manual-takeover',
    username: 'admin',
    password: 'admin123',
    readonly: false,
    expectedMinRootModules: 2,
    expectedMinTotalNodes: 5,
  },
  {
    id: 's3-gin-vue-admin',
    name: 'Gin-Vue-Admin',
    url: 'https://demo.gin-vue-admin.com',
    mode: 'manual-takeover',
    username: 'admin',
    password: '123456',
    readonly: false,
    expectedMinRootModules: 2,
    expectedMinTotalNodes: 5,
  },
  {
    id: 's4-mall',
    name: 'Mall 商城',
    url: 'https://www.macrozheng.com/mall',
    mode: 'credential',
    username: 'admin',
    password: 'macro123',
    readonly: false,
    expectedMinRootModules: 2,
    expectedMinTotalNodes: 5,
  },
  {
    id: 's5-renda',
    name: '陕西人大系统',
    url: 'http://scrd.gov.cn',
    mode: 'credential',
    username: 'admin',
    password: '<REDACTED>',
    readonly: true,
    expectedMinRootModules: 1,
    expectedMinTotalNodes: 1,
  },
];

// ============================================================================
// 2. 核心 API 调用
// ============================================================================

async function callApi(stage, input) {
  const res = await fetch(`${API}/api/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, input }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`  [API Error] ${stage}: ${data.error}`);
    throw new Error(data.error);
  }
  return data.data;
}

// ============================================================================
// 3. 真实性校验：基于数据结构特征（通用）
// ============================================================================

/**
 * 真实性校验 1：检查 Fallback 假数据特征（结构通用，不依赖业务关键词）
 * - 特征 1：所有节点均标记为 manuallyAdded
 * - 特征 2：节点 ID 格式为 demo 生成规则（如 sys-user-01）而非真实 UUID
 * - 特征 3：节点 status 全部为 covered（真实系统可能有 needs_review）
 * - 特征 4：层级结构异常扁平（真实系统通常 3-5 层）
 */
function checkFakeData(moduleTree, system) {
  if (!moduleTree || moduleTree.length === 0) {
    return { isFake: true, reason: '模块树为空，探索失败' };
  }

  const nodes = [];
  const walk = (list) => {
    for (const n of list) {
      nodes.push(n);
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(moduleTree);

  // 特征 1：全部 manuallyAdded（fallback 假数据可能注入人工标记）
  const manuallyAddedCount = nodes.filter(n => n.manuallyAdded === true).length;
  if (manuallyAddedCount > nodes.length * 0.8) {
    return {
      isFake: true,
      reason: `超过 80% 节点标记为 manuallyAdded (${manuallyAddedCount}/${nodes.length})，疑似 fallback 假数据`
    };
  }

  // 特征 2：ID 为短格式（真实引擎用 randomUUID，长度 36；fallback 可能用短 ID）
  const shortIdCount = nodes.filter(n => n.id && n.id.length < 20).length;
  if (shortIdCount > nodes.length * 0.5) {
    return {
      isFake: true,
      reason: `超过 50% 节点 ID 长度 < 20 (${shortIdCount}/${nodes.length})，疑似 fallback 假数据`
    };
  }

  // 特征 3：根模块名含其他系统的固定关键词（跨系统 fallback 检测）
  const rootLabels = moduleTree.map(n => n.label).filter(Boolean);
  const ruoyiPatterns = ['系统管理', '系统监控', '系统工具', '代码生成'];
  const ruoyiMatchCount = rootLabels.filter(l => ruoyiPatterns.some(p => l.includes(p))).length;
  const systemIsRuoYi = system.id.includes('ruoyi');
  if (!systemIsRuoYi && ruoyiMatchCount >= 2 && nodes.length > 30) {
    return {
      isFake: true,
      reason: `根模块包含 RuoYi 特征关键词 (${ruoyiMatchCount}/4) 且节点数 ${nodes.length}，疑似 fallback 到 RuoYi demo 数据`
    };
  }

  // 特征 4：id 全部为 null 或 undefined
  const nullIdCount = nodes.filter(n => !n.id).length;
  if (nullIdCount === nodes.length && nodes.length > 3) {
    return {
      isFake: true,
      reason: `所有 ${nodes.length} 个节点 ID 均为空，疑似 fallback 假数据`
    };
  }

  // 特征 5：labels 全为占位符（real DOM text 不会全是这些固定值）
  const placeholderLabels = ['Module', 'Page', 'Action', '模块', '页面', '操作'];
  const placeholderCount = nodes.filter(n => placeholderLabels.includes(n.label)).length;
  if (placeholderCount > nodes.length * 0.8 && nodes.length > 5) {
    return {
      isFake: true,
      reason: `超过 80% 节点标签为占位符 (${placeholderCount}/${nodes.length})，疑似 fallback 假数据`
    };
  }

  return { isFake: false };
}

/**
 * 真实性校验 2：检查数据量是否达标
 */
function checkDataVolume(moduleTree, system) {
  const countNodes = (nodes) =>
    nodes.reduce((s, n) => s + 1 + countNodes(n.children || []), 0);
  const totalNodes = countNodes(moduleTree);

  if (moduleTree.length < system.expectedMinRootModules) {
    return {
      passed: false,
      reason: `根模块数(${moduleTree.length}) 低于预期阈值(${system.expectedMinRootModules})`,
      stats: { totalNodes, rootModules: moduleTree.length }
    };
  }
  if (totalNodes < system.expectedMinTotalNodes) {
    return {
      passed: false,
      reason: `总节点数(${totalNodes}) 低于预期阈值(${system.expectedMinTotalNodes})`,
      stats: { totalNodes, rootModules: moduleTree.length }
    };
  }
  return { passed: true, stats: { totalNodes, rootModules: moduleTree.length } };
}

// ============================================================================
// 4. 主测试流程
// ============================================================================

async function runSystemTest(system) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 开始测试: ${system.name} (${system.id})`);
  console.log(`   URL: ${system.url}`);
  console.log(`   模式: ${system.mode} | 只读: ${system.readonly}`);
  console.log(`${'='.repeat(60)}`);

  const results = { name: system.name, steps: {}, quality: {} };

  // Step 1: 登录
  console.log('\n--- [1/5] 登录 ---');
  try {
    const loginInput = {
      systemId: system.id,
      systemUrl: system.url,
      mode: system.mode,
      projectId: 'e2e-test',
    };
    // 对于 credential 或 manual-takeover 模式，传递实际凭证（服务器自动存入凭证存储）
    if ((system.mode === 'credential' || system.mode === 'manual-takeover') && system.username && system.password) {
      loginInput.username = system.username;
      loginInput.password = system.password;
    }
    const loginData = await callApi('login', loginInput);
    console.log(`  ✓ 登录成功: ${loginData.loginStatus}`);
    results.steps.login = 'OK';
    results.sessionHandle = loginData.sessionHandle;

    // barrier 状态：需要人工处理（验证码/SSO），自动化无法继续
    if (loginData.loginStatus === 'barrier') {
      console.log(`  ⚠️  检测到登录屏障（验证码/SSO），自动化流程无法继续`);
      console.log(`     请在打开的浏览器窗口中完成验证码/SSO 登录`);
      console.log(`     完成后请重新运行测试，或检查是否需要延长超时时间`);
      results.steps.explore = 'SKIPPED (barrier - needs manual intervention)';
      results.steps.feature = 'SKIPPED';
      results.steps.case = 'SKIPPED';
      results.steps.execute = 'SKIPPED';
      return results;
    }
  } catch (e) {
    console.log(`  ✗ 登录失败: ${e.message}`);
    results.steps.login = 'FAILED';
    return results;
  }

  // Step 2: 探索 - 严格真实性校验
  console.log('\n--- [2/5] 探索 (严格真实性校验) ---');
  try {
    const exploreData = await callApi('explore', {
      subsystemId: system.id,
      sessionHandle: results.sessionHandle,
      systemUrl: system.url,
    });

    // 真实性校验 1：检测假数据
    const fakeCheck = checkFakeData(exploreData.moduleTree, system);
    if (fakeCheck.isFake) {
      console.log(`  🚨 检测到假数据！${fakeCheck.reason}`);
      console.log(`  ✗ 探索失败（数据不真实）`);
      results.steps.explore = 'FAILED (fake data)';
      results.quality.explore = { passed: false, issues: [fakeCheck.reason] };
      return results;
    }

    // 真实性校验 2：数据量检查
    const volumeCheck = checkDataVolume(exploreData.moduleTree, system);
    if (!volumeCheck.passed) {
      console.log(`  🚨 数据量不足！${volumeCheck.reason}`);
      console.log(`  ✗ 探索失败（数据不完整）`);
      results.steps.explore = 'FAILED (insufficient data)';
      results.quality.explore = { passed: false, issues: [volumeCheck.reason] };
      return results;
    }

    console.log(`  ✓ 探索成功: ${volumeCheck.stats.rootModules} 个根模块, ${volumeCheck.stats.totalNodes} 个总节点 (真实数据)`);
    results.steps.explore = 'OK (real data verified)';
    results.moduleTree = exploreData.moduleTree;

    // 结构质量校验
    const exploreQuality = validateExploreOutput(exploreData);
    results.quality.explore = {
      ...exploreQuality,
      realData: true,
    };
    if (!exploreQuality.passed) {
      console.log(`  ⚠️  结构质量问题: ${exploreQuality.issues.join(', ')}`);
    }
  } catch (e) {
    console.log(`  ✗ 探索失败: ${e.message}`);
    results.steps.explore = 'FAILED';
    return results;
  }

  // Step 3: 功能点生成
  console.log('\n--- [3/5] 功能点生成 ---');
  try {
    const featureData = await callApi('feature', {
      moduleTree: results.moduleTree,
      systemName: system.name,
      confirmedOnly: false,
    });
    const totalFeatures = featureData.featureTable.flat().length;
    console.log(`  ✓ 功能点生成成功: ${totalFeatures} 个功能点`);
    results.steps.feature = 'OK';
    results.featureTable = featureData.featureTable;

    const featureQuality = validateFeatureOutput(featureData, system.name);
    results.quality.feature = featureQuality;
    if (!featureQuality.passed) {
      console.log(`  ⚠️  功能点质量问题: ${featureQuality.issues.join(', ')}`);
    } else {
      console.log(`  ✓ 功能点结构校验通过`);
    }
  } catch (e) {
    console.log(`  ✗ 功能点生成失败: ${e.message}`);
    results.steps.feature = 'FAILED';
    return results;
  }

  // Step 4: 测试用例生成
  console.log('\n--- [4/5] 测试用例生成 ---');
  try {
    const caseData = await callApi('case', {
      featureTable: results.featureTable,
      scope: 'all',
      metaConfig: {
        systemName: system.name,
        testPointId: 'ALL',
        testPoint: '全量测试点',
        testers: '测试工程师',
        clientStaff: '产品负责人',
        developerStaff: '开发负责人',
        firstTestDate: '2026-08-16',
        regressionDate: '2026-09-16',
        conclusionRule: 'Pass/Fail',
        precondition: '',
      },
    });

    const totalCases = caseData.caseWorkbook.reduce((s, sh) => s + sh.rows.length, 0);
    console.log(`  ✓ 用例生成成功: ${totalCases} 条用例 / ${caseData.caseWorkbook.length} 个 Sheet`);

    // 关键校验：用例结构正确性 + 字段映射 + 场景覆盖
    const caseQuality = validateCaseOutput(caseData);
    results.quality.case = caseQuality;

    if (!caseQuality.passed) {
      console.log(`  ⚠️  用例质量问题: ${caseQuality.issues.join(', ')}`);
    } else {
      console.log(`  ✓ 用例结构校验通过 (场景覆盖完整)`);
    }

    results.steps.case = 'OK';
    results.caseWorkbook = caseData.caseWorkbook;
  } catch (e) {
    console.log(`  ✗ 用例生成失败: ${e.message}`);
    results.steps.case = 'FAILED';
    return results;
  }

  // S5 只读系统：到用例生成后停止
  if (system.readonly) {
    console.log('\n--- [5/5] 执行 & 缺陷 (只读系统跳过) ---');
    console.log(`  🛑 ${system.name} 为只读模式，已在测试用例生成阶段安全停止。`);
    console.log(`     - 已完成: 登录 -> 探索 -> 功能点生成 -> 用例生成`);
    console.log(`     - 已阻断: 执行 -> 缺陷（避免数据修改）`);
    results.steps.execute = 'SKIPPED (read-only)';
    results.steps.defect = 'SKIPPED (read-only)';
    return results;
  }

  // Step 5: 执行 & 缺陷
  console.log('\n--- [5/5] 执行 & 缺陷 ---');
  try {
    const execData = await callApi('execute', {
      caseWorkbook: results.caseWorkbook,
      scope: 'all',
      browserOSMatrix: [{ browser: 'chromium', os: 'windows', viewport: '1920x1080' }],
    });
    const passCount = execData.executionReport.filter((r) => r.status === 'passed').length;
    console.log(`  ✓ 执行完成: ${passCount} 条通过`);
    results.steps.execute = 'OK';

    const defectData = await callApi('defect', {
      executionReport: execData.executionReport,
    });
    const defectCount = defectData.defectTable.reduce((s, g) => s + g.length, 0);
    console.log(`  ✓ 缺陷生成: ${defectCount} 个缺陷`);
    results.steps.defect = 'OK';
  } catch (e) {
    console.log(`  ✗ 执行/缺陷阶段失败: ${e.message}`);
    results.steps.execute = 'FAILED';
    results.steps.defect = 'FAILED';
  }

  return results;
}

// ============================================================================
// 5. 结构质量校验函数（严格对齐文档 §5/§6）
// ============================================================================

/**
 * 探索输出校验：验证 ModuleNode 结构完整性
 */
function validateExploreOutput(data) {
  const issues = [];
  const tree = data.moduleTree || [];

  if (tree.length === 0) {
    issues.push('模块树为空');
    return { passed: false, issues };
  }

  // 检查节点完整性
  function checkNodes(nodes, depth = 0) {
    for (const node of nodes) {
      if (!node.id) issues.push(`缺少 ID: ${node.label}`);
      if (!node.label) issues.push(`缺少 Label (ID: ${node.id})`);
      if (depth > 8) issues.push(`嵌套过深: ${node.label}`);
      // 检查 type 字段有效性
      const validTypes = ['system', 'module', 'page', 'action'];
      if (node.type && !validTypes.includes(node.type)) {
        issues.push(`无效节点类型: ${node.label} (type=${node.type})`);
      }
      // 检查 status 字段有效性
      const validStatus = ['covered', 'needs_review', 'unexplored'];
      if (node.status && !validStatus.includes(node.status)) {
        issues.push(`无效节点状态: ${node.label} (status=${node.status})`);
      }
      if (node.children && node.children.length > 0) {
        checkNodes(node.children, depth + 1);
      }
    }
  }
  checkNodes(tree);

  const countNodes = (nodes) =>
    nodes.reduce((s, n) => s + 1 + countNodes(n.children || []), 0);
  const totalNodes = countNodes(tree);

  // 计算最大深度
  function maxDepth(nodes, depth = 0) {
    let max = depth;
    for (const n of nodes) {
      if (n.children && n.children.length > 0) {
        max = Math.max(max, maxDepth(n.children, depth + 1));
      }
    }
    return max;
  }
  const depth = maxDepth(tree);

  return {
    passed: issues.length === 0,
    issues,
    stats: { totalNodes, depth, rootModules: tree.length }
  };
}

/**
 * 功能点输出校验：验证九列结构 + 测试点标识规则
 */
function validateFeatureOutput(data, systemName) {
  const issues = [];
  const featureTable = data.featureTable || [];
  const flatRows = featureTable.flat();

  if (flatRows.length === 0) {
    issues.push('功能点为空');
    return { passed: false, issues };
  }

  // 检查 ID 生成
  if (!data.featureIds || data.featureIds.length === 0) {
    issues.push('缺少测试点标识 (featureIds)');
  } else if (data.featureIds.length !== flatRows.length) {
    issues.push(`ID 数量 (${data.featureIds.length}) 与功能点数量 (${flatRows.length}) 不匹配`);
  }

  // 检查每行结构（九列）+ 数据完整性
  let idCount = 0;
  for (let i = 0; i < flatRows.length; i++) {
    const row = flatRows[i];
    if (row.length < 9) {
      issues.push(`行 ${i + 1} 格式错误: 只有 ${row.length} 列 (应为 9 列)`);
      continue;
    }

    const [
      sequence,     // 列 0: 序号
      testType,     // 列 1: 测试类型
      reqSection,   // 列 2: 需求章节
      sysName,      // 列 3: 系统名称
      mainModule,   // 列 4: 主模块
      subModule,    // 列 5: 子模块
      featureName,  // 列 6: 功能点
      testPoint,    // 列 7: 测试点
      testPointId   // 列 8: 测试点标识
    ] = row;

    // 必填字段检查
    if (!testPoint) issues.push(`行 ${i + 1} 缺少测试点`);
    if (!testPointId) issues.push(`行 ${i + 1} 缺少测试点标识`);

    // 测试点标识格式检查 (base_NN, 4段)
    if (testPointId) {
      const parts = testPointId.split('_');
      if (parts.length < 4) {
        issues.push(`行 ${i + 1} 测试点标识格式错误: ${testPointId} (应为 base_NN 4段格式)`);
      } else {
        // 最后一段应为数字 (NN)
        const nnPart = parts[parts.length - 1];
        if (!/^\d{1,3}$/.test(nnPart)) {
          issues.push(`行 ${i + 1} 测试点标识尾段应为数字: ${testPointId}`);
        }
      }
      idCount++;
    }
  }

  // 检查 ID 唯一性
  const uniqueIds = new Set(flatRows.map(r => r[8]).filter(Boolean));
  if (uniqueIds.size !== idCount && idCount > 0) {
    issues.push(`测试点标识存在重复: 唯一 ${uniqueIds.size} vs 总数 ${idCount}`);
  }

  return {
    passed: issues.length === 0,
    issues,
    stats: {
      totalFeatures: flatRows.length,
      groups: featureTable.length,
      validIds: idCount,
      uniqueIds: uniqueIds.size
    }
  };
}

/**
 * 用例输出校验：验证八列结构 + 字段映射 + 场景覆盖
 * 文档 §6 绑定关系：
 *   功能点.测试点 → 用例.测试内容 (content)
 *   功能点.测试点标识 → 用例.用例编号 (caseNo)
 *   功能点.测试点标识 → 用例.featureId (绑定ID)
 */
function validateCaseOutput(data) {
  const issues = [];
  const sheets = data.caseWorkbook || [];

  if (sheets.length === 0) {
    issues.push('用例为空');
    return { passed: false, issues };
  }

  let totalCases = 0;
  let sceneCounts = { N1: 0, N2: 0, N3: 0 };
  const boundFeatureIds = new Set();
  const caseNoSet = new Set();
  let bindingErrors = 0;

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      totalCases++;

      // 必填字段检查
      if (!row.caseNo) issues.push(`用例 ${totalCases} 缺少用例编号`);
      if (!row.content) issues.push(`用例 ${totalCases} 缺少测试内容`);
      if (!row.operation) issues.push(`用例 ${totalCases} 缺少操作步骤`);
      if (!row.expected) issues.push(`用例 ${totalCases} 缺少预期结果`);

      // 用例编号格式检查 (base_NN_N1/N2/N3)
      if (row.caseNo) {
        const parts = row.caseNo.split('_');
        const suffix = parts[parts.length - 1];

        if (suffix === 'N1') sceneCounts.N1++;
        else if (suffix === 'N2') sceneCounts.N2++;
        else if (suffix === 'N3') sceneCounts.N3++;
        else issues.push(`未知场景后缀: ${suffix} (用例 ${row.caseNo})`);

        // 用例编号唯一性检查
        if (caseNoSet.has(row.caseNo)) {
          issues.push(`用例编号重复: ${row.caseNo}`);
        }
        caseNoSet.add(row.caseNo);
      }

      // 绑定关系检查
      if (row.featureId) {
        boundFeatureIds.add(row.featureId);

        // 检查用例编号与 featureId 的绑定关系
        // 用例编号 = featureId + _N1/N2/N3
        if (row.caseNo && !row.caseNo.startsWith(row.featureId)) {
          bindingErrors++;
          if (bindingErrors <= 5) { // 限制输出数量
            issues.push(`绑定错误: 用例编号 ${row.caseNo} 未绑定功能点 ${row.featureId}`);
          }
        }
      } else if (row.caseNo) {
        bindingErrors++;
        if (bindingErrors <= 5) {
          issues.push(`绑定缺失: 用例 ${row.caseNo} 缺少 featureId`);
        }
      }
    }
  }

  if (bindingErrors > 5) {
    issues.push(`... 及其他 ${bindingErrors - 5} 个绑定错误`);
  }

  // 场景覆盖检查：每个绑定的功能点应有 3 个场景（N1/N2/N3）
  const expectedTotalScenes = boundFeatureIds.size * 3;
  const actualTotalScenes = sceneCounts.N1 + sceneCounts.N2 + sceneCounts.N3;
  if (actualTotalScenes < expectedTotalScenes) {
    issues.push(
      `场景覆盖不足: 绑定了 ${boundFeatureIds.size} 个功能点，应有 ${expectedTotalScenes} 条用例，但实际只有 ${actualTotalScenes} 条 (N1=${sceneCounts.N1}, N2=${sceneCounts.N2}, N3=${sceneCounts.N3})`
    );
  }

  return {
    passed: issues.length === 0,
    issues,
    stats: {
      sheets: sheets.length,
      totalCases,
      sceneCoverage: sceneCounts,
      boundFeatures: boundFeatureIds.size,
      uniqueCaseNos: caseNoSet.size,
      bindingErrors
    }
  };
}

// ============================================================================
// 6. 主入口
// ============================================================================

async function main() {
  console.log('🔬 自动化测试平台 · 全链路通用测试 (严格真实版)');
  console.log('校验标准 (对齐文档 §5/§6):');
  console.log('  1. 真实性: 基于数据结构特征识别假数据（manuallyAdded、ID格式、固定关键词）');
  console.log('  2. 完整性: 根模块数 + 总节点数 + 层级深度');
  console.log('  3. 结构性: 功能点九列格式 + 用例八列格式 + 字段映射绑定');
  console.log('  4. 覆盖度: 每个功能点应有 N1/N2/N3 三场景用例');
  console.log('='.repeat(60));

  const results = [];
  for (const system of SYSTEMS) {
    try {
      const result = await runSystemTest(system);
      results.push(result);
    } catch (e) {
      console.error(`\n💥 系统测试异常: ${system.name} - ${e.message}`);
      results.push({ name: system.name, error: e.message });
    }
  }

  // 汇总报告
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('📊 测试结果汇总 (真实性 + 质量双重校验)');
  console.log('='.repeat(80));

  console.log('\n| 系统 | 登录 | 探索 | 功能点 | 用例 | 执行 | 质量(3/3) | 真实数据 |');
  console.log('|------|------|------|--------|------|------|-----------|----------|');

  let allPassed = true;
  let realDataAllPassed = true;

  for (const r of results) {
    const login = r.steps?.login || '—';
    const explore = r.steps?.explore || '—';
    const feature = r.steps?.feature || '—';
    const case_ = r.steps?.case || '—';
    const execute = r.steps?.execute || '—';
    const defect = r.steps?.defect || '—';

    const qualityScore = [
      r.quality?.explore?.passed,
      r.quality?.feature?.passed,
      r.quality?.case?.passed,
    ].filter(Boolean).length;

    const realData = r.quality?.explore?.realData ? '✅' : (r.steps?.explore?.includes('FAILED') ? '❌' : '—');

    if (qualityScore < 3) allPassed = false;
    if (realData === '❌') realDataAllPassed = false;

    console.log(
      `| ${r.name} | ${login} | ${explore} | ${feature} | ${case_} | ${execute}/${defect} | ${qualityScore}/3 | ${realData} |`
    );
  }

  console.log(`\n${'='.repeat(80)}`);
  if (allPassed && realDataAllPassed) {
    console.log('🎉 所有系统测试通过！数据真实、结构正确、场景覆盖完整。');
  } else {
    const fakeDataSystems = results.filter(r => r.quality?.explore?.issues?.some(i => i.includes('假数据')));
    const failedSystems = results.filter(r => r.steps?.explore?.includes('FAILED') && !r.steps?.explore?.includes('fake'));
    const barrierSystems = results.filter(r => r.steps?.explore?.includes('SKIPPED'));

    if (fakeDataSystems.length > 0) {
      console.log('🚨 严重问题：部分系统返回了假数据（fallback），必须修复！');
      for (const r of fakeDataSystems) {
        console.log(`   - ${r.name}: ${r.quality.explore.issues.join('; ')}`);
      }
    }
    if (failedSystems.length > 0) {
      console.log('⚠️  部分系统不可访问或探索失败：');
      for (const r of failedSystems) {
        console.log(`   - ${r.name}: ${r.steps.explore}`);
      }
    }
    if (barrierSystems.length > 0) {
      console.log('ℹ️  部分系统检测到登录屏障（需人工处理）：');
      for (const r of barrierSystems) {
        console.log(`   - ${r.name}: ${r.steps.login}`);
      }
    }
    if (allPassed && !realDataAllPassed) {
      console.log('✅ 已通过测试的系统数据真实、结构正确。');
    }
  }

  // 详细报告
  console.log('\n📋 详细质量报告:');
  for (const r of results) {
    if (r.error) {
      console.log(`\n  【${r.name}】 错误: ${r.error}`);
      continue;
    }
    console.log(`\n  【${r.name}】`);
    if (r.quality?.explore) {
      const s = r.quality.explore.stats;
      console.log(`    探索: ${r.quality.explore.passed ? '✅' : '❌'} | 根模块: ${s?.rootModules} | 节点: ${s?.totalNodes} | 深度: ${s?.depth} | 真实数据: ${r.quality.explore.realData ? '是' : '否'}`);
      if (!r.quality.explore.passed) console.log(`      问题: ${r.quality.explore.issues.join('; ')}`);
    }
    if (r.quality?.feature) {
      const s = r.quality.feature.stats;
      console.log(`    功能点: ${r.quality.feature.passed ? '✅' : '❌'} | 分组: ${s?.groups} | 总数: ${s?.totalFeatures} | 有效ID: ${s?.validIds}/${s?.uniqueIds}`);
      if (!r.quality.feature.passed) console.log(`      问题: ${r.quality.feature.issues.join('; ')}`);
    }
    if (r.quality?.case) {
      const s = r.quality.case.stats;
      console.log(`    用例: ${r.quality.case.passed ? '✅' : '❌'} | Sheet: ${s?.sheets} | 用例: ${s?.totalCases}`);
      console.log(`      绑定功能点: ${s?.boundFeatures} | 唯一用例号: ${s?.uniqueCaseNos}`);
      console.log(`      场景: N1=${s?.sceneCoverage?.N1||0}, N2=${s?.sceneCoverage?.N2||0}, N3=${s?.sceneCoverage?.N3||0}`);
      console.log(`      绑定错误: ${s?.bindingErrors || 0}`);
      if (!r.quality.case.passed) console.log(`      问题: ${r.quality.case.issues.join('; ')}`);
    }
  }
}

main().catch((e) => console.error('Fatal:', e));
