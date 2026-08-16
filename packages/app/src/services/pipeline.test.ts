import { describe, it, expect } from 'vitest';
import {
  fromModuleView,
  toModuleView,
  fromFeatureView,
  toFeatureView,
  fromCaseView,
  toCaseView,
  fromExecView,
  toExecView,
  toDefectView,
} from './pipeline';
import type {
  ModuleNodeView,
  FeatureRowView,
  CaseRowView,
  ExecMatrixRow,
  ExecMatrixCell,
  MetaHeader,
  ExecModuleState,
} from '../context';
import type {
  ModuleNode,
  FeatureRow,
  CaseSheet,
  ExecutionResult,
  DefectOutput,
} from '@test-platform/contracts';

describe('pipeline.ts - 数据转换逻辑', () => {
  describe('ModuleNode 转换', () => {
    it('toModuleView: 应正确转换 ModuleNode 为 ModuleNodeView', () => {
      const input: ModuleNode[] = [
        { id: '1', label: '模块1', status: 'covered', type: 'module', children: [], depth: 0, manuallyAdded: false, parentId: null, subsystemId: 'sys' },
        { id: '2', label: '模块2', status: 'unexplored', type: 'module', children: [], depth: 0, manuallyAdded: false, parentId: null, subsystemId: 'sys' },
      ];
      const result = toModuleView(input);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('模块1');
      expect(result[0].status).toBe('已覆盖');
      expect(result[1].status).toBe('未探索');
    });

    it('fromModuleView: 应正确转换 ModuleNodeView 为 ModuleNode', () => {
      const input: ModuleNodeView[] = [
        { id: '1', name: '模块1', status: '已覆盖' },
        { id: '2', name: '模块2', status: 'needs_review' },
      ];
      const result = fromModuleView(input);
      expect(result).toHaveLength(2);
      expect(result[0].label).toBe('模块1');
      expect(result[0].status).toBe('covered');
      expect(result[1].status).toBe('needs_review');
      expect(result[0].manuallyAdded).toBe(true);
    });

    it('fromModuleView / toModuleView: 往返转换应保持 ID 与层级关系', () => {
      const tree: ModuleNodeView[] = [
        {
          id: 'root',
          name: '根模块',
          status: '已覆盖',
          children: [
            { id: 'child1', name: '子模块1', status: '未探索' },
          ],
        },
      ];
      const contractNodes = fromModuleView(tree);
      expect(contractNodes[0].children).toHaveLength(1);
      expect(contractNodes[0].children[0].parentId).toBe('root');

      const viewNodes = toModuleView(contractNodes);
      expect(viewNodes[0].id).toBe('root');
      expect(viewNodes[0].children![0].id).toBe('child1');
      expect(viewNodes[0].children![0].status).toBe('未探索');
    });
  });

  describe('FeatureRow 转换', () => {
    it('toFeatureView: 应正确解析二维数组', () => {
      const table: string[][] = [
        ['001', '功能', '第一章', '系统A', '主模块', '子模块', '功能点1', '测试点1', 'TP-001'],
      ];
      const result = toFeatureView(table);
      expect(result).toHaveLength(1);
      expect(result[0].seq).toBe('001');
      expect(result[0].feature).toBe('功能点1');
      expect(result[0].testPointId).toBe('TP-001');
    });

    it('fromFeatureView: 应正确生成二维数组', () => {
      const rows: FeatureRowView[] = [
        { seq: '1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'F', testPoint: 'TP', testPointId: 'TP-1' },
      ];
      const result = fromFeatureView(rows);
      expect(result).toHaveLength(1); // 外层 array
      expect(result[0]).toHaveLength(1); // 一行
      expect(result[0][0]).toEqual(['1', '功能', 'C1', 'S', 'M', 'SM', 'F', 'TP', 'TP-1']);
    });
  });

  describe('CaseSheet 转换', () => {
    it('toCaseView: 应从 CaseSheet 提取 Meta 和 Rows', () => {
      const sheets: CaseSheet[] = [
        {
          sheetName: 'Sheet1',
          meta: { systemName: 'SYS', testPointId: 'TP-1', testPoint: 'TP', testers: 'T1', clientStaff: 'C1', developerStaff: '', firstTestDate: '2026-01-01', regressionDate: '2026-02-01', conclusionRule: '规则1', precondition: '' },
          rows: [
            { caseNo: 'C1', content: '测试内容', step: '步骤1', operation: '操作1', expected: '预期1', firstResult: 'pass', regressionResult: 'pass', conclusion: 'pass' }
          ]
        }
      ];
      const { rows, meta } = toCaseView(sheets);
      expect(meta.system).toBe('SYS');
      expect(meta.times).toContain('2026-01-01');
      expect(rows).toHaveLength(1);
      expect(rows[0].caseNo).toBe('C1');
    });

    it('fromCaseView: 应正确生成 CaseSheet', () => {
      const meta: MetaHeader = { system: 'SYS', testPointId: 'TP-1', testPoint: 'TP', testers: 'T1', clientStaff: 'C1', times: '2026-01-01 / 2026-02-01', rules: '规则1' };
      const rows: CaseRowView[] = [
        { caseNo: 'C1', content: '测试内容', step: '步骤1', operation: '操作1', expected: '预期1', firstResult: 'pass', regressionResult: 'fail', conclusion: 'fail' }
      ];
      const sheets = fromCaseView(rows, meta);
      expect(sheets).toHaveLength(1);
      expect(sheets[0].meta.systemName).toBe('SYS');
      expect(sheets[0].rows).toHaveLength(1);
      expect(sheets[0].rows[0].caseNo).toBe('C1');
    });
  });

  describe('ExecutionResult 转换', () => {
    it('toExecView: 应正确将 ExecutionResult 聚合为矩阵', () => {
      const results: ExecutionResult[] = [
        { caseNo: 'C1', env: { os: 'Windows', browser: 'Chrome', version: '120' }, status: 'passed', steps: [] },
        { caseNo: 'C1', env: { os: 'Windows', browser: 'Firefox', version: '120' }, status: 'failed', steps: [] },
      ];
      const browsers = ['Windows·Chrome', 'Windows·Firefox'];
      const matrix = toExecView(results, browsers);
      expect(matrix).toHaveLength(1);
      expect(matrix[0].caseNo).toBe('C1');
      expect(matrix[0].cells).toHaveLength(2);
      expect(matrix[0].cells.find(c => c.browser === 'Windows·Chrome')!.status).toBe('pass');
    });

    it('fromExecView: 应正确将矩阵拆分为 ExecutionResult', () => {
      const matrix: ExecMatrixRow[] = [
        { caseNo: 'C1', steps: 5, cells: [{ browser: 'Windows·Chrome', status: 'pass' }] }
      ];
      const modules: ExecModuleState[] = [{ name: 'M', cases: 1 }];
      const results = fromExecView(matrix, modules);
      expect(results).toHaveLength(1);
      expect(results[0].caseNo).toBe('C1');
      expect(results[0].env.browser).toBe('Chrome');
      expect(results[0].status).toBe('passed');
    });
  });

  describe('DefectOutput 转换', () => {
    it('toDefectView: 应将分组缺陷扁平化为 DefectRowView 列表', () => {
      const output: DefectOutput = {
        defectTable: [
          [
            { description: '缺陷1', level: 'high' },
            { description: '缺陷2', level: 'low' },
          ],
        ],
      };
      const rows = toDefectView(output);
      expect(rows).toHaveLength(2);
      expect(rows[0].seq).toBe(1);
      expect(rows[0].description).toBe('缺陷1');
      expect(rows[1].seq).toBe(2);
    });
  });
});
