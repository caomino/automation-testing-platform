/**
 * @file example.ts
 * @description PipelineOrchestrator 使用示例
 * 
 * 本文件演示如何初始化并运行完整的自动化测试流水线。
 * 所有模块（基础设施、引擎、6个 Stage）都已串联。
 */

import { PipelineOrchestrator, type PipelineInput, type PipelineResult } from './index';

async function main() {
  console.log('🚀 启动自动化测试平台流水线...');

  // 1. 初始化编排器（使用默认配置）
  const orchestrator = new PipelineOrchestrator({
    // 可选：配置日志路径
    // loggerConfig: { dir: './my-logs', retentionDays: 90 },
    
    // 可选：注入自定义引擎工厂（如 Mock 引擎或特殊配置）
    // engineFactory: (config) => createEngine({ ...config, headless: false }),
  });

  // 2. 准备流水线输入
  const pipelineInput: PipelineInput = {
    // Stage 1: 登录配置（必填）
    login: {
      systemId: 'target_system_01',
      systemUrl: 'https://www.example-system.com',
      mode: 'credential', // 'no-login' | 'credential' | 'manual-takeover'
      credentialRef: 'ref_to_stored_credential', // 凭证引用
      // 如果是子系统，需要指定父门户 URL
      // parentPortalUrl: 'https://parent-portal.com',
    },

    // Stage 2: 探索配置（可选，有默认值）
    explore: {
      // subsystemId: 'target_system_01', // 默认为 login.systemId
      // manualSupplement: { ... },     // 人工补充的 clickPath
    },

    // Stage 3: 功能点配置（可选）
    feature: {
      systemName: '目标业务系统',
      confirmedOnly: false, // 是否只显示已确认的功能点
    },

    // Stage 4: 用例配置（可选）
    case: {
      scope: 'all', // 或 'selected_modules'
      // selectedModuleIds: ['module_a', 'module_b'],
      metaConfig: {
        precondition: '系统已登录，测试数据已准备就绪',
      },
    },

    // Stage 5: 执行配置（可选）
    execute: {
      browserOSMatrix: [
        { os: 'Windows', browser: 'Chrome', version: '120' },
        { os: 'Windows', browser: 'Edge', version: '120' },
        { os: 'macOS', browser: 'Safari', version: '17' },
      ],
      // ownerTaskId: 'my-test-run-001',
    },

    // Stage 6: 缺陷配置（可选）
    defect: {
      // moduleFilter: '支付模块', // 只看某个模块的缺陷
    },
  };

  // 3. 运行流水线
  console.log('📦 开始执行流水线...');
  const result: PipelineResult = await orchestrator.run(pipelineInput);

  // 4. 输出结果
  console.log('✅ 流水线执行完成！\n');
  
  console.log('📊 各阶段结果摘要:');
  console.log(`  1. 登录: ${result.login.loginStatus === 'ok' ? '成功' : '失败'}`);
  console.log(`  2. 探索: 发现 ${result.explore.moduleTree.length} 个模块`);
  console.log(`  3. 功能点: 生成 ${result.feature.featureTable.length} 行功能点`);
  console.log(`  4. 用例: 生成 ${result.case.caseWorkbook.length} 个 Sheet`);
  console.log(`  5. 执行: 执行 ${result.execute.executionReport.length} 条用例`);
  console.log(`  6. 缺陷: 发现 ${result.defect.defectTable.length} 组缺陷`);

  // 5. 访问详细数据
  const passedCount = result.execute.executionReport.filter(r => r.status === 'passed').length;
  const failedCount = result.execute.executionReport.filter(r => r.status === 'failed').length;
  console.log(`\n📈 通过率: ${passedCount} 通过, ${failedCount} 失败`);

  // 6. 会话可复用
  console.log(`🔑 会话 ID: ${result.session.sessionId} (可用于后续子系统登录复用)`);
  
  // 7. 获取日志查询
  const logger = orchestrator.getLogger();
  const recentLogs = logger.query({ scope: 'orchestrator' });
  console.log(`\n📝 最近日志: ${recentLogs.length} 条`);
}

// 运行示例
main().catch(console.error);

/*
 * ──────────────────────────────────────────────
 * 测试模式示例（使用 no-login 模式，无需真实凭证）
 * ──────────────────────────────────────────────
 * 
 * const testInput: PipelineInput = {
 *   login: {
 *     systemId: 'test_system',
 *     systemUrl: 'https://localhost:3000',
 *     mode: 'no-login', // 直接返回 ok 状态，跳过真实登录
 *   },
 *   // 后续 stage 会自动根据前序输出生成默认输入
 * };
 * 
 * const result = await orchestrator.run(testInput);
 * // 所有 stage 都会执行，但登录阶段是假的
 */
