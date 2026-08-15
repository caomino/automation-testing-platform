/**
 * @file index.ts
 * @description 测试用例生成 stage（八列 + meta + 选中模块/全部 + 复杂逻辑分层）
 * @frozen v1.0 — 仅暴露 run(input): Promise<CaseOutput>
 *
 * 真实生成逻辑（P1 绑定内核）：
 *  - 每个已确认功能点 => 一组步骤化用例行（正常路径 / 边界值 / 异常输入），用例编号 = 功能点.测试点标识（4段 base_NN）。
 *  - 一子系统（子模块）一 sheet；meta 头可编辑行透传 input.metaConfig。
 *  - scope = all | selected_modules；selected_modules 按主/子模块名过滤。
 *  - AI 辅助生成默认关闭，接口由输入 aiConfig 预留（本 stage 仅模板生成）。
 *  - 复杂逻辑识别（§15）留待后续阶段，complexLogicDetected 置 false。
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
} from '@test-platform/contracts';

const FC = DEFAULT_FEATURE_COLUMNS;

/** 场景类型：正常路径 / 边界值 / 异常输入（每个功能点至少覆盖，见原型系统提示词） */
type ScenarioKey = 'normal' | 'boundary' | 'exception';

/**
 * 场景编码后缀：绑定功能点 4 段值（base_NN）后追加，保证同一功能点的
 * 三条用例行在 sheet 内用例编号唯一（且仍绑定功能点标识）。
 */
const SCENARIO_SUFFIX: Record<ScenarioKey, string> = {
  normal: '_N1',
  boundary: '_N2',
  exception: '_N3',
};

/** 场景生成上下文（取自功能点行 + meta 预置条件；仅保留真正使用的字段） */
interface ScenarioContext {
  subModule: string;
  featureName: string;
  testPoint: string;
  precondition: string;
}

/** 安全取列（数据边界：缺失列以空串兜底，避免越界崩溃） */
function col(row: FeatureRow, idx: number): string {
  return row[idx] ?? '';
}

/** 单场景的操作说明与预期结果模板 */
function scenarioContent(
  key: ScenarioKey,
  ctx: ScenarioContext,
): { operation: string; expected: string } {
  switch (key) {
    case 'normal':
      return {
        operation: `进入[${ctx.subModule}]模块，在[${ctx.featureName}]功能下，对"${ctx.testPoint}"执行正常操作（预置条件：${ctx.precondition}）。`,
        expected: `系统正常响应，"${ctx.testPoint}"操作成功，返回/显示结果与预期一致。`,
      };
    case 'boundary':
      return {
        operation: `在"${ctx.testPoint}"中输入边界值（最小值/最大值/临界长度）后执行。`,
        expected: `系统在边界条件下处理正确，无溢出或异常，结果符合业务规则。`,
      };
    case 'exception':
      return {
        operation: `在"${ctx.testPoint}"中输入非法/异常数据（空值、超长、错误格式）后提交。`,
        expected: `系统给出明确错误提示，拒绝非法输入并保持原状态，不崩溃。`,
      };
  }
}

/** 为单个功能点生成 3 条场景用例行（用例编号 = 功能点测试点标识 + 场景后缀，行内唯一） */
function generateCaseRowsForFeature(row: FeatureRow, precondition: string): CaseRow[] {
  const testPointId = col(row, FC.testPointId);
  const testPoint = col(row, FC.testPoint);
  const ctx: ScenarioContext = {
    subModule: col(row, FC.subModule),
    featureName: col(row, FC.featureName),
    testPoint,
    precondition,
  };
  const keys: ScenarioKey[] = ['normal', 'boundary', 'exception'];
  return keys.map((key, i) => {
    const { operation, expected } = scenarioContent(key, ctx);
    // 绑定功能点 4 段值；testPointId 缺失/空时兜底空串（数据边界）
    const caseNo = testPointId ? `${testPointId}${SCENARIO_SUFFIX[key]}` : '';
    return {
      caseNo,
      content: testPoint,
      step: `Step${i + 1}`,
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
  });
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

/** 生成测试用例（真实逻辑：绑定内核 + 模板场景引擎） */
export const run: CaseRun = async (input: CaseInput): Promise<CaseOutput> => {
  const precondition = input.metaConfig.precondition;

  // 展平（功能点表按模块分组）→ 过滤生成范围
  const inScope = input.featureTable
    .flat()
    .filter((row) => isInScope(row, input.scope, input.selectedModuleIds));

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
    const sheetRows = rows.flatMap((row) =>
      generateCaseRowsForFeature(row, precondition),
    );
    caseRows.push(sheetRows);
    caseWorkbook.push({
      sheetName,
      meta: cloneMeta(input.metaConfig),
      rows: sheetRows,
      colWidths: CASE_COLUMN_WIDTHS,
    });
  }

  return {
    caseWorkbook,
    caseRows,
    metaHeader: cloneMeta(input.metaConfig),
    qualityGateIssues: [],
    complexLogicDetected: false,
  };
};

export default run;
