import { describe, it, expect } from 'vitest';
import { PipelineOrchestrator } from '../index.js';
import { createStore } from '@test-platform/infra-store';
import { createEngine } from '@test-platform/engine-mcp';

describe('Real-World Management System E2E Pipeline (https://demo.yunzong.cn/#/dashboard/index)', () => {
  it(
    'runs complete pipeline (explore -> feature -> case) against live SPA without evaluate/__name errors',
    async () => {
      const store = createStore(':memory:');
      const orchestrator = new PipelineOrchestrator({
        store,
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

      // 1. 探索阶段
      const exploreRes = await orchestrator.runStage('explore', {
        systemUrl: 'https://demo.yunzong.cn/#/dashboard/index',
        systemId: 'demo_yunzong',
        subsystemId: 'demo_yunzong',
        sessionHandle,
        scope: 'all',
      });

      expect(exploreRes).toBeDefined();
      expect(exploreRes.moduleTree.length).toBeGreaterThan(0);

      // 2. 功能提取阶段
      const featureRes = await orchestrator.runStage('feature', {
        systemName: '云纵智能管理系统',
        confirmedOnly: false,
        moduleTree: exploreRes.moduleTree,
      });

      expect(featureRes).toBeDefined();
      expect(featureRes.featureTable?.length).toBeGreaterThan(0);
      expect(featureRes.featureIds?.length).toBeGreaterThan(0);

      // 3. 用例生成阶段
      const caseRes = await orchestrator.runStage('case', {
        systemId: 'demo_yunzong',
        systemUrl: 'https://demo.yunzong.cn/#/dashboard/index',
        sessionHandle,
        scope: 'all',
        featureTable: featureRes.featureTable,
        featurePaths: featureRes.featurePaths,
        featureProfiles: featureRes.featureProfiles,
        featureEvidence: featureRes.featureEvidence,
        metaConfig: { precondition: '用户已登录管理控制台' },
      });

      expect(caseRes).toBeDefined();
      const sheets = caseRes.caseWorkbook || (caseRes as any).caseSheets || (caseRes as any).caseGroups || [];
      expect(sheets.length).toBeGreaterThan(0);
      expect(caseRes.featureResults?.length).toBeGreaterThan(0);
      expect(caseRes.caseRows?.length).toBeGreaterThan(0);
    },
    180000,
  );
});
