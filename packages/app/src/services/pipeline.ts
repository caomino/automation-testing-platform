/**
 * @file pipeline.ts
 * @description App ↔ Orchestrator 适配层
 *   通过 HTTP API 调用后端 orchestrator（真实 Playwright MCP 执行）
 *   后端地址: http://localhost:3001（Vite proxy: /api → localhost:3001）
 */

import type {
  LoginInput,
  LoginOutput,
  ExploreInput,
  ExploreOutput,
  FeatureInput,
  FeatureOutput,
  CaseInput,
  CaseOutput,
  ExecuteInput,
  ExecuteOutput,
  DefectInput,
  DefectOutput,
  ModuleNode,
  CaseSheet,
  ExecutionResult,
  FeatureRow,
} from '@test-platform/contracts';

import type {
  FeatureRowView,
  CaseRowView,
  MetaHeader,
  DefectRowView,
  ModuleNodeView,
  ExecMatrixRow,
  ExecMatrixCell,
  CaseStepView,
  CaseGroupView,
} from '../context';

// ===== 类型转换函数（contract → 前端 view） =====

export function toFeatureView(table: string[][] | string[][][]): FeatureRowView[] {
  const rows: FeatureRowView[] = [];
  const is3D = table.length > 0 && Array.isArray(table[0]) && Array.isArray((table as string[][][])[0]?.[0]);
  const flat: string[][] = is3D
    ? (table as string[][][]).flat()
    : (table as string[][]);
  for (const row of flat) {
    rows.push({
      seq: row[0] ?? '',
      type: row[1] ?? '',
      chapter: row[2] ?? '',
      system: row[3] ?? '',
      mainModule: row[4] ?? '',
      subModule: row[5] ?? '',
      feature: row[6] ?? '',
      testPoint: row[7] ?? '',
      testPointId: row[8] ?? '',
    });
  }
  return rows;
}

export function toCaseView(sheets: CaseSheet[]): { rows: CaseRowView[]; groups: CaseGroupView[]; meta: MetaHeader } {
  const rows: CaseRowView[] = [];
  let meta: MetaHeader = { system: '', testPointId: '', testPoint: '', testers: '', clientStaff: '', developerStaff: '', firstTestDate: '', regressionDate: '', conclusionRule: '', precondition: '' };

  for (const sheet of sheets) {
    if (sheet.meta) {
      meta = {
        system: sheet.meta.systemName ?? meta.system,
        testPointId: sheet.meta.testPointId ?? meta.testPointId,
        testPoint: sheet.meta.testPoint ?? meta.testPoint,
        testers: sheet.meta.testers ?? meta.testers,
        clientStaff: sheet.meta.clientStaff ?? meta.clientStaff,
        developerStaff: sheet.meta.developerStaff ?? meta.developerStaff,
        firstTestDate: sheet.meta.firstTestDate ?? meta.firstTestDate,
        regressionDate: sheet.meta.regressionDate ?? meta.regressionDate,
        conclusionRule: sheet.meta.conclusionRule ?? meta.conclusionRule,
        precondition: sheet.meta.precondition ?? meta.precondition,
      };
    }
    for (const r of sheet.rows) {
      rows.push({
        caseNo: r.caseNo,
        content: r.content,
        step: r.step,
        operation: r.operation,
        expected: r.expected,
        firstResult: r.firstResult ?? '\\',
        regressionResult: r.regressionResult ?? '\\',
        conclusion: r.conclusion ?? '\\',
      });
    }
  }

  const groupsMap = new Map<string, CaseGroupView>();
  for (const sheet of sheets) {
    const moduleName = sheet.sheetName ?? '';
    for (const r of sheet.rows) {
      if (!groupsMap.has(r.caseNo)) {
        groupsMap.set(r.caseNo, {
          groupId: `grp-${r.caseNo}`,
          caseNo: r.caseNo,
          content: r.content,
          moduleName,
          precondition: sheet.meta?.precondition ?? '',
          steps: [],
        });
      }
      const group = groupsMap.get(r.caseNo)!;
      const stepId = `step-${group.steps.length}`;
      group.steps.push({
        stepId,
        stepNumber: r.step,
        operation: r.operation,
        expected: r.expected,
        firstResult: r.firstResult,
        regressionResult: r.regressionResult,
        conclusion: r.conclusion,
      });
    }
  }
  const groups = Array.from(groupsMap.values());

  return { rows, groups, meta };
}

/** 将功能点前端视图数据转为 contracts 要求的 FeatureRow[][] 格式（外层=分组/模块，内层=行） */
export function fromFeatureViewToTable(rows: FeatureRowView[]): FeatureRow[][] {
  return [rows.map((r) => [
    r.seq,
    r.type,
    r.chapter,
    r.system,
    r.mainModule,
    r.subModule,
    r.feature,
    r.testPoint,
    r.testPointId,
  ])];
}

/**
 * 构造生成测试用例所需的 CaseInput。
 * 关键契约：featureTable 必须是 FeatureRow[][]（外层=分组/模块，内层=行）。
 * 必须经由 fromFeatureViewToTable 转换，绝不能自己拍平成单层数组——
 * 旧 bug 正是少了外层分组，导致 stage-case 的 .flat() 把整行拍平成字符、用例编号/内容全乱。
 */
export function buildCaseInput(
  featureRows: FeatureRowView[],
  caseSelectedModules: string[],
  metaHeader: MetaHeader,
  scope: 'selected_modules' | 'all',
  featurePaths?: Record<string, string>,
  aiEnabled?: boolean,
): CaseInput {
  const selectedModuleIds = scope === 'selected_modules' ? caseSelectedModules : undefined;
  return {
    scope,
    selectedModuleIds,
    featureTable: fromFeatureViewToTable(featureRows),
    featurePaths,
    aiConfig: { configId: 'default', enabled: !!aiEnabled },
    metaConfig: {
      systemName: metaHeader.system || '',
      testPointId: metaHeader.testPointId || '',
      testPoint: metaHeader.testPoint || '',
      testers: metaHeader.testers || '',
      clientStaff: metaHeader.clientStaff || '',
      developerStaff: metaHeader.developerStaff || '',
      firstTestDate: metaHeader.firstTestDate || '',
      regressionDate: metaHeader.regressionDate || '',
      conclusionRule: metaHeader.conclusionRule || '',
      precondition: metaHeader.precondition || '',
    },
  };
}

export function toExecView(
  report: ExecutionResult[],
  browsers: string[],
): ExecMatrixRow[] {
  const grouped = new Map<string, ExecMatrixRow>();

  for (const r of report) {
    const row = grouped.get(r.caseNo) ?? { caseNo: r.caseNo, steps: r.steps?.length ?? 0, cells: [] };
    grouped.set(r.caseNo, row);

    const browserLabel = `${r.env.os}·${r.env.browser}`;
    const cell: ExecMatrixCell = {
      browser: browserLabel,
      status: r.status === 'passed' ? 'pass' : r.status === 'running' ? 'running' : 'pending',
    };
    row.cells.push(cell);
  }

  for (const row of grouped.values()) {
    for (const b of browsers) {
      if (!row.cells.find((c) => c.browser === b)) {
        row.cells.push({ browser: b, status: 'pending' });
      }
    }
  }

  return Array.from(grouped.values());
}

export function toDefectView(defectOutput: DefectOutput): DefectRowView[] {
  const rows: DefectRowView[] = [];
  let seq = 0;
  for (const group of defectOutput.defectTable) {
    for (const defect of group) {
      seq++;
      rows.push({
        seq,
        description: defect.description ?? '未命名缺陷',
        screenshot: defect.screenshotRef,
        level: defect.level ?? '中',
        qualityAttribute: defect.qualityAttribute ?? '功能正确性',
        environment: defect.environment ?? '',
      });
    }
  }
  return rows;
}

export function toModuleView(nodes: ModuleNode[]): ModuleNodeView[] {
  return nodes.map((n) => ({
    id: n.id,
    name: n.label ?? n.id,
    type: n.type,
    status: n.status === 'covered' ? '已覆盖' : n.status === 'needs_review' ? 'needs_review' : '未探索',
    children: n.children ? toModuleView(n.children) : undefined,
  }));
}

/**
 * 将结构化模块树转换为九列功能表（FeatureRowView[]）。
 *
 * 业务规则（与 docs/问题分析与补充定义.md §1.4 字段映射一致）：
 *   - 仅对 type==='action' 的叶子节点生成一行（按钮级颗粒度）
 *   - 主模块 = 最近的 type==='module' 祖先标签（=父目录）
 *   - 子模块 = 最近的 type==='page' 祖先标签（=子系统）
 *   - 功能点 = 所在 page 标签；无 page 时回退为 module 标签
 *   - 测试点 = action 标签（具体按钮）
 *   - 测试点标识 = base_NN（NN 为全局顺序号，两位补零）
 *   - 测试类型固定 '功能性测试'；需求章节留空
 *
 * 该转换器让「人工结构化补录的树」可直接刷新生成功能表，闭环了此前断开的链路。
 */
export function moduleTreeToFeatureTable(tree: ModuleNodeView[], systemName: string): FeatureRowView[] {
  const rows: FeatureRowView[] = [];
  let index = 0;

  const walk = (nodes: ModuleNodeView[], moduleLabel: string, pageLabel: string): void => {
    for (const n of nodes) {
      const curModule = n.type === 'module' ? n.name : moduleLabel;
      const curPage = n.type === 'page' ? n.name : pageLabel;

      if (n.type === 'action') {
        index += 1;
        const nn = String(index).padStart(2, '0');
        rows.push({
          seq: String(index),
          type: '功能性测试',
          chapter: '',
          system: systemName,
          mainModule: moduleLabel,
          subModule: pageLabel,
          feature: pageLabel || moduleLabel,
          testPoint: n.name,
          testPointId: `base_${nn}`,
        });
      }

      if (n.children && n.children.length > 0) {
        walk(n.children, curModule, curPage);
      }
    }
  };

  walk(tree, '', '');
  return rows;
}

// ===== 反向转换函数（前端 view → contract） =====

export function fromModuleView(nodes: ModuleNodeView[], parentId: string | null = null, subsystemId: string = '', depth: number = 0): ModuleNode[] {
  return nodes.map((n) => ({
    id: n.id,
    label: n.name,
    parentId,
    subsystemId,
    status: n.status === '已覆盖' ? 'covered' : n.status === 'needs_review' ? 'needs_review' : 'unexplored',
    children: n.children ? fromModuleView(n.children, n.id, subsystemId, depth + 1) : [],
    depth,
    manuallyAdded: true,
    type: (n.type ?? 'module') as 'system' | 'module' | 'page' | 'action',
  }));
}

export function fromFeatureView(rows: FeatureRowView[]): string[][][] {
  return [rows.map((r) => [
    r.seq,
    r.type,
    r.chapter,
    r.system,
    r.mainModule,
    r.subModule,
    r.feature,
    r.testPoint,
    r.testPointId,
  ])];
}

export function fromCaseView(groups: CaseGroupView[], meta: MetaHeader): CaseSheet[] {
  const flatRows: CaseRowView[] = [];
  for (const group of groups) {
    for (const step of group.steps) {
      flatRows.push({
        caseNo: group.caseNo,
        content: group.content,
        step: step.stepNumber,
        operation: step.operation,
        expected: step.expected,
        firstResult: step.firstResult,
        regressionResult: step.regressionResult,
        conclusion: step.conclusion,
      });
    }
  }
  const sheet: CaseSheet = {
    sheetName: meta.system || 'System',
    meta: {
      systemName: meta.system,
      testPointId: meta.testPointId,
      testPoint: meta.testPoint,
      testers: meta.testers,
      clientStaff: meta.clientStaff,
      developerStaff: meta.developerStaff,
      firstTestDate: meta.firstTestDate,
      regressionDate: meta.regressionDate,
      conclusionRule: meta.conclusionRule,
      precondition: meta.precondition,
    },
    rows: flatRows.map((r) => ({
      caseNo: r.caseNo,
      content: r.content,
      step: r.step,
      operation: r.operation,
      expected: r.expected,
      firstResult: r.firstResult === '\\' ? '' : (r.firstResult || ''),
      regressionResult: r.regressionResult === '\\' ? '' : (r.regressionResult || ''),
      conclusion: r.conclusion === '\\' ? '' : (r.conclusion || ''),
    })),
  };
  return [sheet];
}

export function fromExecView(matrix: ExecMatrixRow[], modules: ExecModuleState[]): ExecutionResult[] {
  const results: ExecutionResult[] = [];
  for (const row of matrix) {
    for (const cell of row.cells) {
      results.push({
        caseNo: row.caseNo,
        caseRowId: row.caseNo,
        env: {
          os: cell.browser.split('·')[0] ?? 'Unknown',
          browser: cell.browser.split('·')[1] ?? 'Unknown',
          version: '',
        },
        status: cell.status === 'pass' ? 'passed' : cell.status === 'running' ? 'running' : 'failed',
        steps: [],
      });
    }
  }
  return results;
}

// ===== 后端通信 =====

const BACKEND_API = '/api';

async function callBackend<T>(stage: string, input: Record<string, any>): Promise<T> {
  const res = await fetch(`${BACKEND_API}/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, input }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Unknown error');
  return json.data as T;
}

// ===== PipelineService =====

export interface PipelineService {
  launchEngine(): Promise<void>;
  closeEngine(): Promise<void>;
  runStageLogin(input: LoginInput): Promise<LoginOutput>;
  runStageExplore(input: ExploreInput): Promise<ExploreOutput>;
  runStageFeature(input: FeatureInput): Promise<FeatureOutput>;
  runStageCase(input: CaseInput): Promise<CaseOutput>;
  runStageExecute(input: ExecuteInput): Promise<ExecuteOutput>;
  runStageDefect(input: DefectInput): Promise<DefectOutput>;
  runFullPipeline(input: any): Promise<any>;
}

export function createPipelineService(): PipelineService {
  return {
    launchEngine: async (): Promise<void> => {
      try {
        const res = await fetch('/health');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        throw new Error('后端服务未启动，请先运行: pnpm server（端口 3001）');
      }
    },

    closeEngine: async (): Promise<void> => {
      // noop: 后端由独立进程管理
    },

    runStageLogin: async (input: LoginInput): Promise<LoginOutput> => {
      return callBackend<LoginOutput>('login', input);
    },

    runStageExplore: async (input: ExploreInput): Promise<ExploreOutput> => {
      return callBackend<ExploreOutput>('explore', input);
    },

    runStageFeature: async (input: FeatureInput): Promise<FeatureOutput> => {
      return callBackend<FeatureOutput>('feature', input);
    },

    runStageCase: async (input: CaseInput): Promise<CaseOutput> => {
      return callBackend<CaseOutput>('case', input);
    },

    runStageExecute: async (input: ExecuteInput): Promise<ExecuteOutput> => {
      return callBackend<ExecuteOutput>('execute', input);
    },

    runStageDefect: async (input: DefectInput): Promise<DefectOutput> => {
      return callBackend<DefectOutput>('defect', input);
    },

    runFullPipeline: async (input: any): Promise<any> => {
      const res = await fetch(`${BACKEND_API}/full-pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Unknown error');
      return json.data;
    },
  };
}
