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
  CaseRow,
  ExecuteInput,
  ExecuteOutput,
  DefectInput,
  DefectOutput,
  ModuleNode,
  CaseSheet,
  ExecutionResult,
  FeatureRow,
  FeatureEvidence,
  FeatureProfile,
} from '@test-platform/contracts';

import type {
  FeatureRowView,
  CaseRowView,
  MetaHeader,
  DefectRowView,
  ModuleNodeView,
  ExecMatrixRow,
  ExecMatrixCell,
  ExecModuleState,
  CaseGroupView,
} from '../context';
import {
  buildFeatureBase,
  nextTestPointIdFor,
  toAbbrToken,
  toAbbrTokenWithLabel,
  tryParseBaseFromId,
} from './abbr';

// ===== 类型转换函数（contract → 前端 view） =====

export function toFeatureView(table: string[][] | string[][][]): FeatureRowView[] {
  const rows: FeatureRowView[] = [];
  const is3D = table.length > 0 && Array.isArray(table[0]) && Array.isArray((table as string[][][])[0]?.[0]);
  const flat: string[][] = is3D
    ? (table as string[][][]).flat()
    : (table as string[][]);
  for (const row of flat) {
    // state.featureRows 保存"原始 FeatureRow 九列原文"——normalizeDisplayLabel/父子去重
    // 只在 Feature.tsx 用 deriveDisplayRows 派生成显示态，不写回 state。
    // 保证 fromFeatureViewToTable 序列化时不会把 UI 层"去重空列""去括号名"误当成真实值。
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
  const visibleSheets = sheets.map((sheet) => ({
    ...sheet,
    rows: sheet.rows.filter(isCurrentCaseRow),
  }));

  for (const sheet of visibleSheets) {
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
        id: r.id,
        targetTestPoint: r.targetTestPoint,
        caseNo: r.caseNo,
        content: r.content,
        step: r.step,
        operation: r.operation,
        expected: r.expected,
        firstResult: r.firstResult ?? '\\',
        regressionResult: r.regressionResult ?? '\\',
        conclusion: r.conclusion ?? '\\',
        scenarioId: r.scenarioId,
        scenarioName: r.scenarioName,
        priority: r.priority,
        coverageKeys: r.coverageKeys,
        evidenceLevel: r.evidenceLevel,
        needsReview: r.needsReview,
        reviewReason: r.reviewReason,
        featureId: r.featureId,
        evidenceId: r.evidenceId,
        origin: r.origin,
        confidence: r.confidence,
        manualEdited: r.manualEdited,
        quality: r.quality,
        qualityGateStatus: r.qualityGateStatus,
        batchId: r.batchId,
      });
    }
  }

  const groupsMap = new Map<string, CaseGroupView>();
  for (const sheet of visibleSheets) {
    const moduleName = sheet.sheetName ?? '';
    for (const r of sheet.rows) {
      if (!groupsMap.has(r.caseNo)) {
        groupsMap.set(r.caseNo, {
          id: r.id,
          targetTestPoint: r.targetTestPoint,
          groupId: `grp-${r.caseNo}`,
          caseNo: r.caseNo,
          content: r.content,
          moduleName,
          precondition: sheet.meta?.precondition ?? '',
          scenarioId: r.scenarioId,
          scenarioName: r.scenarioName,
          priority: r.priority,
          coverageKeys: r.coverageKeys,
          evidenceLevel: r.evidenceLevel,
          needsReview: r.needsReview,
          reviewReason: r.reviewReason,
          featureId: r.featureId,
          evidenceId: r.evidenceId,
          origin: r.origin,
          confidence: r.confidence,
          manualEdited: r.manualEdited,
          quality: r.quality,
          qualityGateStatus: r.qualityGateStatus,
          batchId: r.batchId,
          steps: [],
        });
      }
      const group = groupsMap.get(r.caseNo)!;
      const stepId = `step-${group.steps.length}`;
      group.steps.push({
        id: r.id,
        targetTestPoint: r.targetTestPoint,
        stepId,
        stepNumber: r.step,
        operation: r.operation,
        expected: r.expected,
        firstResult: r.firstResult,
        regressionResult: r.regressionResult,
        conclusion: r.conclusion,
        scenarioId: r.scenarioId,
        scenarioName: r.scenarioName,
        priority: r.priority,
        coverageKeys: r.coverageKeys,
        evidenceLevel: r.evidenceLevel,
        needsReview: r.needsReview,
        reviewReason: r.reviewReason,
        featureId: r.featureId,
        evidenceId: r.evidenceId,
        origin: r.origin,
        confidence: r.confidence,
        manualEdited: r.manualEdited,
        quality: r.quality,
        qualityGateStatus: r.qualityGateStatus,
        batchId: r.batchId,
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
  featureProfiles?: FeatureProfile[],
  featureEvidence?: Record<string, FeatureEvidence>,
  regenerateSelected?: boolean,
  currentCaseWorkbook?: CaseSheet[],
  aiConfigId?: string,
): CaseInput {
  const selectedModuleIds = scope === 'selected_modules' ? caseSelectedModules : undefined;
  return {
    scope,
    selectedModuleIds,
    featureTable: fromFeatureViewToTable(featureRows),
    featurePaths,
    featureProfiles,
    featureEvidence,
    currentCaseWorkbook,
    aiConfig: aiEnabled
      ? { configId: aiConfigId || 'default', enabled: true as const }
      : { enabled: false as const },
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
    ...(regenerateSelected ? { regenerateSelected: true } : {}),
  } as CaseInput;
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
 * 业务规则（与 docs/自动化测试平台-主规格.md §5.3、问题分析与补充定义.md §1.4 一致）：
 *   - 仅对 type==='action' 的叶子节点生成一行（按钮级颗粒度）
 *   - 主模块 = 最近的 type==='module' 祖先标签（=父目录）
 *   - 子模块 = 最近的 type==='page' 祖先标签（=子系统）
 *   - 功能点 = 所在 page 标签；无 page 时回退为 module 标签
 *   - 测试点 = action 标签（具体按钮）
 *   - 测试点标识（4 段） = base_NN
 *       base（3 段）= 系统缩写_主模块缩写_子模块缩写；中文取拼音首字母大写
 *       NN 递增维度 = 子系统（同一子系统内从 01 起；不同子系统各自 01）
 *   - 测试类型固定 '功能性测试'；需求章节留空
 *
 * 该转换器让「人工结构化补录的树」可直接刷新生成功能表，闭环了此前断开的链路。
 */
export function moduleTreeToFeatureTable(tree: ModuleNodeView[], systemName: string): FeatureRowView[] {
  const rows: FeatureRowView[] = [];
  /** 子系统维度计数器：key = 3 段 base（SYS_MAIN_SUB） */
  const counters = new Map<string, number>();
  let index = 0;
  const sysAbbr = toAbbrTokenWithLabel('', systemName);

  // 一级目录永远 = 主模块；二级目录 = 子模块；仅有一级时子模块留空。
  // walk 传递「最近层级祖先 nearest」与「次近层级祖先 second」：
  //   子模块 = 最近层级（仅当存在二级目录时），主模块 = 次近层级（一级目录），无则回退最近。
  // 与后端 featureTable.ts 的 main=ancestors[1]??ancestors[0]、sub=ancestors[0]??null 保持一致。
  const walk = (nodes: ModuleNodeView[], nearest: string, second: string): void => {
    for (const n of nodes) {
      const isLevel = n.type === 'module' || n.type === 'page';
      const curNearest = isLevel ? n.name : nearest;  // 最近层级祖先
      const curSecond = isLevel ? nearest : second;   // 次近层级祖先
      const mainLabel = curSecond || curNearest;      // 主模块 = 一级目录
      const subLabel = curSecond ? curNearest : '';   // 子模块 = 二级目录（无则留空）

      if (n.type === 'action') {
        index += 1;
        const mainAbbr = toAbbrTokenWithLabel('', mainLabel);
        const subAbbr = toAbbrTokenWithLabel('', subLabel);
        const base = buildFeatureBase(sysAbbr, mainAbbr, subAbbr);
        const next = (counters.get(base) ?? 0) + 1;
        counters.set(base, next);
        const nn = String(next).padStart(2, '0');
        rows.push({
          seq: String(index),
          type: '功能性测试',
          chapter: '',
          system: systemName,
          mainModule: mainLabel,
          subModule: subLabel,
          feature: subLabel || mainLabel,
          testPoint: n.name,
          testPointId: `${base}_${nn}`,
        });
      }

      if (n.children && n.children.length > 0) {
        walk(n.children, curNearest, curSecond);
      }
    }
  };

  walk(tree, '', '');
  return rows;
}

export { toAbbrToken, toAbbrTokenWithLabel, buildFeatureBase, tryParseBaseFromId, nextTestPointIdFor };

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

function isLegacyCaseNo(caseNo: string): boolean {
  return /_(?:N[1-5]|A\d{2})$/.test(caseNo);
}

function isCurrentCaseRow(row: Pick<CaseRow, 'caseNo' | 'featureId'>): boolean {
  return Boolean(row.caseNo && !isLegacyCaseNo(row.caseNo));
}

function legacyFeatureId(caseNo: string, scenarioId?: string): string {
  if (scenarioId) {
    const dot = scenarioId.indexOf('.');
    if (dot > 0) return scenarioId.slice(0, dot);
  }
  // 仅作为旧工作簿的兼容回退：新记录必须携带 featureId。
  return caseNo.replace(/_(?:(?:A|N)?\d+)$/, '');
}

export function fromCaseView(groups: CaseGroupView[], meta: MetaHeader): CaseSheet[] {
  const flatRows: CaseRowView[] = [];
  for (const group of groups) {
    const groupFeatureId = group.featureId ?? group.steps.find((step) => step.featureId)?.featureId;
    if (!groupFeatureId || group.caseNo !== groupFeatureId || isLegacyCaseNo(group.caseNo)) continue;
    for (const step of group.steps) {
      flatRows.push({
        id: step.id ?? group.id,
        targetTestPoint: step.targetTestPoint ?? group.targetTestPoint,
        caseNo: group.caseNo,
        content: group.content,
        step: step.stepNumber,
        operation: step.operation,
        expected: step.expected,
        firstResult: step.firstResult,
        regressionResult: step.regressionResult,
        conclusion: step.conclusion,
        scenarioId: step.scenarioId ?? group.scenarioId,
        scenarioName: step.scenarioName ?? group.scenarioName,
        priority: step.priority ?? group.priority,
        coverageKeys: step.coverageKeys ?? group.coverageKeys,
        evidenceLevel: step.evidenceLevel ?? group.evidenceLevel,
        needsReview: step.needsReview ?? group.needsReview,
        reviewReason: step.reviewReason ?? group.reviewReason,
        featureId: step.featureId ?? group.featureId,
        evidenceId: step.evidenceId ?? group.evidenceId,
        origin: step.origin ?? group.origin,
        confidence: step.confidence ?? group.confidence,
        manualEdited: step.manualEdited ?? group.manualEdited,
        quality: step.quality ?? group.quality,
        qualityGateStatus: step.qualityGateStatus ?? group.qualityGateStatus,
      });
    }
  }
  if (flatRows.length === 0) return [];
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
      scenarioId: r.scenarioId,
      scenarioName: r.scenarioName,
      priority: r.priority,
      coverageKeys: r.coverageKeys,
      evidenceLevel: r.evidenceLevel,
      needsReview: r.needsReview,
      reviewReason: r.reviewReason,
      evidenceId: r.evidenceId,
      origin: r.origin,
      confidence: r.confidence,
      manualEdited: r.manualEdited,
      quality: r.quality,
      qualityGateStatus: r.qualityGateStatus,
      id: r.id ?? r.scenarioId ?? `${r.caseNo}__${r.step}`,
      featureId: r.featureId ?? legacyFeatureId(r.caseNo, r.scenarioId),
      targetTestPoint: r.targetTestPoint ?? r.content,
    })),
  };
  return [sheet];
}

export function fromExecView(matrix: ExecMatrixRow[], _modules: ExecModuleState[]): ExecutionResult[] {
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
