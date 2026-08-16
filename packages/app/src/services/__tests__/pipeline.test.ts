/**
 * @file pipeline.test.ts
 * @description PipelineService 单元测试 — 仅测试类型转换函数
 *   （createPipelineService 需要真实后端，集成测试在 e2e 中进行）
 */

import { describe, it, expect } from 'vitest';
import {
  toFeatureView,
  toCaseView,
  toDefectView,
  toModuleView,
} from '../pipeline';

describe('toFeatureView', () => {
  it('应将 9 列 string[][] 转换为 FeatureRowView[]', () => {
    const table: string[][] = [
      ['1', '功能性测试', '3.2.1', '区域影像系统', '配置', '检查室', '检查室管理', '查询', 'QYYX_PZ_JCX_01'],
    ];
    const views = toFeatureView(table);
    expect(views.length).toBe(1);
    expect(views[0].seq).toBe('1');
    expect(views[0].type).toBe('功能性测试');
    expect(views[0].chapter).toBe('3.2.1');
    expect(views[0].system).toBe('区域影像系统');
    expect(views[0].mainModule).toBe('配置');
    expect(views[0].subModule).toBe('检查室');
    expect(views[0].feature).toBe('检查室管理');
    expect(views[0].testPoint).toBe('查询');
    expect(views[0].testPointId).toBe('QYYX_PZ_JCX_01');
  });

  it('应处理空行', () => {
    const views = toFeatureView([]);
    expect(views.length).toBe(0);
  });

  it('应处理不足 9 列的行（填充空值）', () => {
    const table: string[][] = [
      ['1', '测试'],
    ];
    const views = toFeatureView(table);
    expect(views.length).toBe(1);
    expect(views[0].seq).toBe('1');
    expect(views[0].type).toBe('测试');
    expect(views[0].chapter).toBe('');
  });
});

describe('toCaseView', () => {
  it('应将 CaseSheet[] 转换为 CaseRowView[] + MetaHeader', () => {
    const sheets = [
      {
        sheetName: '检查室',
        meta: {
          systemName: '区域影像',
          testPointId: 'TP-01',
          testPoint: '检查室',
          testers: '张三',
          clientStaff: '李四',
          developerStaff: '王五',
          firstTestDate: '2026-08-01',
          regressionDate: '2026-08-15',
          conclusionRule: 'pass',
          precondition: '系统正常',
        },
        rows: [
          {
            caseNo: 'TC-01',
            content: '查询',
            step: 'Step1',
            operation: '点击【查询】',
            expected: '成功',
            firstResult: '通过',
            regressionResult: '通过',
            conclusion: '通过',
            id: '1',
            featureId: 'TP-01',
            targetTestPoint: '查询',
            scenarioId: 'normal',
            origin: 'system_generated' as const,
            evidenceLevel: 'derived' as const,
            confidence: 1,
          },
        ],
        colWidths: [],
      },
    ];
    const { rows, meta } = toCaseView(sheets);
    expect(rows.length).toBe(1);
    expect(rows[0].caseNo).toBe('TC-01');
    expect(meta.system).toBe('区域影像');
    expect(meta.testPointId).toBe('TP-01');
    expect(meta.testPoint).toBe('检查室');
    expect(meta.testers).toBe('张三');
    expect(meta.clientStaff).toBe('李四');
    expect(meta.times).toBe('2026-08-01 / 2026-08-15');
    expect(meta.rules).toBe('pass');
  });

  it('应处理空 sheets', () => {
    const { rows, meta } = toCaseView([]);
    expect(rows.length).toBe(0);
    expect(meta.system).toBe('');
  });

  it('应合并多个 sheets 的 rows', () => {
    const sheets = [
      {
        sheetName: 'Sheet1',
        meta: { systemName: '系统A', testPointId: 'TP-01', testPoint: '点1', testers: '', clientStaff: '', developerStaff: '', firstTestDate: '', regressionDate: '', conclusionRule: '', precondition: '' },
        rows: [
          { caseNo: 'TC-01', content: 'A', step: '1', operation: 'op', expected: 'ok', firstResult: '\\', regressionResult: '\\', conclusion: '\\', id: '1', featureId: 'F1', targetTestPoint: 'tp', confidence: 1 },
        ],
        colWidths: [],
      },
      {
        sheetName: 'Sheet2',
        meta: { systemName: '系统A', testPointId: 'TP-02', testPoint: '点2', testers: '', clientStaff: '', developerStaff: '', firstTestDate: '', regressionDate: '', conclusionRule: '', precondition: '' },
        rows: [
          { caseNo: 'TC-02', content: 'B', step: '1', operation: 'op', expected: 'ok', firstResult: '\\', regressionResult: '\\', conclusion: '\\', id: '2', featureId: 'F2', targetTestPoint: 'tp', confidence: 1 },
        ],
        colWidths: [],
      },
    ];
    const { rows } = toCaseView(sheets);
    expect(rows.length).toBe(2);
  });
});

describe('toDefectView', () => {
  it('应将 DefectOutput 转换为 DefectRowView[]', () => {
    const defectOutput = {
      defectTable: [
        [
          { sequence: 1, description: '按钮无反应', screenshotRef: 'ss-001', level: '高' as const, qualityAttribute: '功能正确性', environment: 'Chrome 120' },
        ],
      ],
      screenshots: [],
    };
    const views = toDefectView(defectOutput);
    expect(views.length).toBe(1);
    expect(views[0].seq).toBe(1);
    expect(views[0].description).toBe('按钮无反应');
    expect(views[0].level).toBe('高');
    expect(views[0].screenshot).toBe('ss-001');
  });

  it('应处理空缺陷表', () => {
    const views = toDefectView({ defectTable: [], screenshots: [] });
    expect(views.length).toBe(0);
  });
});

describe('toModuleView', () => {
  it('应将 ModuleNode[] 转换为 ModuleNodeView[]', () => {
    const nodes = [
      { id: 'm1', label: '模块1', parentId: null as string | null, subsystemId: 'sys', type: 'module' as const, status: 'covered' as const, children: [], depth: 0, manuallyAdded: false },
    ];
    const views = toModuleView(nodes);
    expect(views.length).toBe(1);
    expect(views[0].id).toBe('m1');
    expect(views[0].name).toBe('模块1');
    expect(views[0].status).toBe('已覆盖');
  });

  it('应递归处理子节点', () => {
    const nodes = [
      {
        id: 'root',
        label: '根',
        parentId: null,
        subsystemId: 'sys',
        type: 'module' as const,
        status: 'covered' as const,
        children: [
          { id: 'child', label: '子', parentId: 'root', subsystemId: 'sys', type: 'page' as const, status: 'needs_review' as const, children: [], depth: 1, manuallyAdded: false },
        ],
        depth: 0,
        manuallyAdded: false,
      },
    ];
    const views = toModuleView(nodes);
    expect(views.length).toBe(1);
    expect(views[0].children).toBeDefined();
    expect(views[0].children![0].name).toBe('子');
    expect(views[0].children![0].status).toBe('needs_review');
  });
});
