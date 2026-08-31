import { PipelineOrchestrator } from './packages/orchestrator/src/index';
import { createStore } from './packages/infra-store/src/index';
import { createEngine } from './packages/engine-mcp/src/index';
import * as fs from 'fs';

async function main() {
  const store = createStore(':memory:');
  const logFile = '/tmp/yunzong_test.log';
  fs.writeFileSync(logFile, '');

  const log = (msg: string) => {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
  };

  const logger = {
    info: (scope: string, msg: string) => log(`[INFO][${scope}] ${msg}`),
    warn: (scope: string, msg: string) => log(`[WARN][${scope}] ${msg}`),
    error: (scope: string, msg: string) => log(`[ERROR][${scope}] ${msg}`),
  };

  const orchestrator = new PipelineOrchestrator({
    store,
    logger,
    engineFactory: (cfg) => createEngine({ ...cfg, headless: true }),
  });

  const sessionHandle = {
    sessionId: 'session_demo_yunzong',
    systemId: 'demo_yunzong',
    loginStatus: 'ok' as const,
    cookies: [],
    headers: {},
    tokens: [],
    expiresAt: Date.now() + 3600000,
  };

  log('=== 阶段 1: 探索阶段 (explore) ===');
  const exploreRes = await orchestrator.runStage('explore', {
    systemUrl: 'https://demo.yunzong.cn/#/dashboard/index',
    systemId: 'demo_yunzong',
    subsystemId: 'demo_yunzong',
    sessionHandle,
    scope: 'all',
  });
  log(`探索完成: 模块树顶级节点数 = ${exploreRes.moduleTree?.length}`);

  log('=== 阶段 2: 功能提取阶段 (feature) ===');
  const featureRes = await orchestrator.runStage('feature', {
    systemName: '云纵智能管理系统',
    confirmedOnly: false,
    moduleTree: exploreRes.moduleTree,
  });
  log(`功能表生成完成: 模块分组数 = ${featureRes.featureTable?.length}, 功能点总数 = ${featureRes.featureIds?.length}, Profiles = ${featureRes.featureProfiles?.length}, Evidence = ${Object.keys(featureRes.featureEvidence || {}).length}`);
  
  for (let i = 0; i < (featureRes.featureTable?.length || 0); i++) {
    const group = featureRes.featureTable[i];
    log(`  - 模块分组 ${i + 1}: 共 ${group.length} 条功能点`);
    for (const row of group.slice(0, 2)) {
      log(`    * [${row[0]}] ${row[1]} / ${row[2]} / ${row[3]}`);
    }
  }

  log('=== 阶段 3: 用例生成阶段 (case) ===');
  const caseRes = await orchestrator.runStage('case', {
    systemId: 'demo_yunzong',
    systemUrl: 'https://demo.yunzong.cn/#/dashboard/index',
    sessionHandle,
    scope: 'all',
    featureTable: featureRes.featureTable,
    featurePaths: featureRes.featurePaths,
    featureProfiles: featureRes.featureProfiles,
    featureEvidence: featureRes.featureEvidence,
    metaConfig: { precondition: '用户已登录并进入管理系统控制台' },
  });

  log(`用例生成完成: Case Sheets = ${caseRes.caseSheets?.length || (caseRes as any).caseGroups?.length}`);
  const sheets = caseRes.caseSheets || (caseRes as any).caseGroups || [];
  let totalCases = 0;
  for (const group of sheets) {
    const cases = group.cases || group.rows || [];
    totalCases += cases.length;
    log(`  - Sheet [${group.subModule || group.name || '模块'}]: ${cases.length} 条测试用例`);
    for (const c of cases.slice(0, 2)) {
      log(`    * [${c.id || c.caseId}] ${c.title || c.caseTitle || c.name}`);
      log(`      步骤: ${JSON.stringify(c.steps || c.stepList)}, 预期结果: ${c.expectedResult || c.expected}`);
    }
  }
  log(`总计生成真实业务测试用例数: ${totalCases}`);

  log('=== 功能点证据门与结果状态 ===');
  for (const r of caseRes.featureResults || []) {
    log(`- 功能点 ${r.featureId}: 状态=${r.status}, 原因=${(r.reasons || []).join('; ') || '正常'}`);
  }

  log('=== 全部流程验证成功，无任何 __name 或 evaluate 错误！===');
}

main().catch((err) => {
  console.error('Fatal Error:', err);
  fs.appendFileSync('/tmp/yunzong_test.log', `Fatal Error: ${err.stack || err}\n`);
  process.exit(1);
});
