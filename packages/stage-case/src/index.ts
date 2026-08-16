/**
 * @file index.ts
 * @description 测试用例生成 stage（八列 + meta + 选中模块/全部 + 复杂逻辑分层）
 * @frozen v1.0 — 仅暴露 run(input): Promise<CaseOutput>
 *
 * 真实生成逻辑（P1 绑定内核）：
 *  - 每个已确认功能点 => 5 类场景用例（正常/边界/异常/流程/权限），编号 = 功能点.测试点标识（4段 base_NN）+ 场景后缀（_N1.._N5）。
 *  - 一子系统（子模块）一 sheet；meta 头可编辑行透传 input.metaConfig。
 *  - scope = all | selected_modules；selected_modules 按主/子模块名过滤。
 *  - AI 双模：编排器通过 setAIClient 注入 AI 客户端 → 启用 AI 生成（带证据门 needs_review）；未注入则模板生成。
 *  - 探索元素（exploredElements）：有则生成真实步骤；无则模板兜底。
 *  - qualityGate：complexLogic 检测 + sanitize 三级对齐（数量/编号绑定/内容）兜底。
 */
import {
  CASE_COLUMN_WIDTHS,
  DEFAULT_FEATURE_COLUMNS,
  type CaseInput,
  type CaseOutput,
  type CaseRow,
  type CaseRun,
  type CaseSheet,
  type FeatureRow,
  type QualityGateIssue,
  type ExploredElement,
} from '@test-platform/contracts';
import {
  SCENARIO_ORDER,
  SCENARIO_SUFFIX,
  scenarioContent,
  type ScenarioContext,
} from './templateScenarioEngine';
import { buildAiCandidateCaseRows, type CaseAIClient } from './aiCaseRows';
import { sanitizeCaseRowsAgainstFeatureRows } from './caseRows';

const FC = DEFAULT_FEATURE_COLUMNS;

/** AI 客户端（由编排器注入；null = 模板生成） */
let aiClient: CaseAIClient | null = null;

/** 注入 AI 客户端（启用 AI 生成分支）。传 null 关闭。 */
export function setAIClient(client: CaseAIClient | null): void {
  aiClient = client;
}

/** 安全取列（数据边界：缺失列以空串兜底，避免越界崩溃） */
function col(row: FeatureRow, idx: number): string {
  return row[idx] ?? '';
}

/** 检测复杂逻辑：功能点总数 ≥ 5 或跨 ≥3 子系统时标记（非阻塞建议） */
function detectComplexLogic(featureTable: FeatureRow[][]): { detected: boolean; issues: QualityGateIssue[] } {
  const issues: QualityGateIssue[] = [];
  const flat = featureTable.flat();
  if (flat.length === 0) return { detected: false, issues };

  if (flat.length >= 5) {
    issues.push({
      caseRowId: 'complexity_warning_1',
      type: '泛化',
      message: `功能点数量较多（${flat.length} 个），建议开启 AI 辅助生成用例覆盖更多边界场景`,
      blocking: false,
    });
  }
  const subModules = new Set(flat.map((r) => col(r, FC.subModule)));
  if (subModules.size >= 3) {
    issues.push({
      caseRowId: 'complexity_warning_2',
      type: '越权',
      message: `涉及 ${subModules.size} 个子系统，建议在执行阶段增加数据隔离检查`,
      blocking: false,
    });
  }
  return { detected: issues.length > 0, issues };
}

/** 深拷贝 meta 头，避免 round-trip 编辑污染输入引用（返回新对象而非别名） */
function cloneMeta(meta: CaseInput['metaConfig']): CaseInput['metaConfig'] {
  return structuredClone(meta);
}

/** 是否在生成范围内（all 全量；selected_modules 按主/子模块名匹配，缺省宽松回退） */
function isInScope(
  row: FeatureRow,
  scope: CaseInput['scope'],
  selectedModuleIds: string[] | undefined,
): boolean {
  if (scope === 'all') return true;
  if (!selectedModuleIds || selectedModuleIds.length === 0) return true;
  const sub = col(row, FC.subModule);
  const main = col(row, FC.mainModule);
  return selectedModuleIds.includes(sub) || selectedModuleIds.includes(main);
}

/**
 * 为单个功能点生成 5 类场景用例行。
 *  - AI 注入时优先 AI 生成（带证据门）；AI 缺失/失败回退模板。
 *  - 用例编号 = 功能点测试点标识（4段 base_NN）+ 场景后缀，强绑定功能点标识。
 */
async function generateCaseRowsForFeature(
  row: FeatureRow,
  precondition: string,
  exploredElements?: ExploredElement[],
): Promise<CaseRow[]> {
  const testPointId = col(row, FC.testPointId);
  const testPoint = col(row, FC.testPoint);
  const ctx: ScenarioContext = {
    subModule: col(row, FC.subModule),
    featureName: col(row, FC.featureName),
    testPoint,
    precondition,
  };

  const rows: CaseRow[] = [];
  for (const key of SCENARIO_ORDER) {
    let rowData: CaseRow | null = null;
    if (aiClient) {
      rowData = await buildAiCandidateCaseRows(testPointId, ctx, key, aiClient);
    }
    if (!rowData) {
      const { operation, expected } = scenarioContent(key, ctx, exploredElements);
      rowData = {
        caseNo: testPointId ? `${testPointId}${SCENARIO_SUFFIX[key]}` : '',
        content: testPoint,
        step: `Step_${key}`,
        operation,
        expected,
        firstResult: '\\',
        regressionResult: '\\',
        conclusion: '\\',
        id: `${testPointId || 'EMPTY'}__${key}`,
        featureId: testPointId,
        targetTestPoint: testPoint,
        scenarioId: key,
        origin: 'system_generated',
        evidenceLevel: 'derived',
        confidence: 1,
      } satisfies CaseRow;
    }
    rows.push(rowData);
  }
  return rows;
}

/** 生成测试用例（真实逻辑：绑定内核 + 模板/AI 场景引擎 + sanitize 三级对齐） */
export const run: CaseRun = async (input: CaseInput): Promise<CaseOutput> => {
  const precondition = input.metaConfig.precondition;
  const exploredElements = input.exploredElements ?? [];

  // 边界检查：空 featureTable 时返回空工作簿而非崩溃
  const flatFeatures = input.featureTable.flat();
  if (flatFeatures.length === 0) {
    return {
      caseWorkbook: [],
      caseRows: [],
      metaHeader: cloneMeta(input.metaConfig),
      qualityGateIssues: [],
      complexLogicDetected: false,
    };
  }

  // 展平（功能点表按模块分组）→ 过滤生成范围
  const inScope = flatFeatures.filter((row) => isInScope(row, input.scope, input.selectedModuleIds));

  // 按子系统（子模块）分组，一子系统一 sheet
  const groups = new Map<string, FeatureRow[]>();
  for (const row of inScope) {
    const key = col(row, FC.subModule) || col(row, FC.mainModule) || 'DEFAULT';
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const caseRows: CaseRow[][] = [];
  const caseWorkbook: CaseSheet[] = [];
  for (const [sheetName, rows] of groups) {
    const sheetRows: CaseRow[] = [];
    for (const row of rows) {
      const generated = await generateCaseRowsForFeature(row, precondition, exploredElements);
      sheetRows.push(...generated);
    }
    caseRows.push(sheetRows);
    caseWorkbook.push({
      sheetName,
      meta: cloneMeta(input.metaConfig),
      rows: sheetRows,
      colWidths: CASE_COLUMN_WIDTHS,
    });
  }

  // 质量门：复杂逻辑检测 + sanitize 三级对齐（数量/编号绑定/内容）
  const { detected: complexLogicDetected, issues: complexityIssues } = detectComplexLogic(input.featureTable);
  const sanitizeIssues = sanitizeCaseRowsAgainstFeatureRows(caseRows, input.featureTable);

  return {
    caseWorkbook,
    caseRows,
    metaHeader: cloneMeta(input.metaConfig),
    qualityGateIssues: [...complexityIssues, ...sanitizeIssues],
    complexLogicDetected,
  };
};

export default run;
