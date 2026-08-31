/**
 * @file index.ts
 * @description 缺陷管理 stage — 六列 + 截图 + 模块筛选
 * @input DefectInput @output DefectOutput
 * @frozen v1.0 — 实现必须对齐 contracts/DefectContract，不得修改其接口
 */
import type {
  DefectInput,
  DefectOutput,
  DefectRun,
  DefectRow,
  ExecutionResult,
  ScreenshotRef,
} from '@test-platform/contracts';
import { DefectInputSchema } from '@test-platform/contracts';
import {
  buildDescription,
  createDefect,
  deriveModule,
} from './logic';

export {
  buildDescription,
  createDefect,
  deriveEnvironment,
  deriveLevel,
  deriveModule,
  deriveQualityAttribute,
  normalize,
  normalizeEnv,
  exportDefects,
  exportDefectsJSON,
  exportDefectsTSV,
  importDefectsJSON,
  importDefectsTSV,
  DEFECT_TSV_HEADER,
} from './logic';
export type { DefectLevel, CreateDefectParams, DefectExport } from './logic';

/**
 * 由单条失败用例构建一条六列缺陷行（委托 createDefect 复用真实创建逻辑）。
 * screenshotId 来自 ExecutionResult.defectRef（执行失败时落库的截图引用 id）。
 */
function buildDefectRow(result: ExecutionResult, sequence: number, screenshotId?: string): DefectRow {
  const failedStep = result.steps.find((s) => s.result === 'failed');
  return createDefect({
    sequence,
    description: buildDescription(result),
    screenshotRef: screenshotId,
    environment: {
      os: result.env.os,
      browser: result.env.browser,
      version: result.env.version,
      caseNo: result.caseNo,
      step: failedStep?.step,
    },
  });
}

/**
 * 主入口：执行结果 → 六列缺陷表（按模块分组）+ 截图引用。
 *
 * 提取规则：
 *  1. 仅 status==='failed' 的用例计入缺陷；
 *  2. 失败用例按 deriveModule(caseNo) 分组，组内序号 1 起；
 *  3. defectRef 即失败时的截图引用 id，关联进输出 screenshots 与行 screenshotRef；
 *  4. 级别 / 质量特性 / 产生环境由用例内容推导（见 logic.ts）。
 *
 * 边界：
 *  - 无失败用例 → defectTable=[]、screenshots=[]
 *  - 失败用例无 defectRef → 该行 screenshotRef 缺省、screenshots 不含该项
 *  - 指定 moduleFilter → 仅保留模块键精确匹配的分组
 */
export const run: DefectRun = async (input: DefectInput): Promise<DefectOutput> => {
  const valid = DefectInputSchema.parse(input);

  const failed = valid.executionReport.filter((r) => r.status === 'failed');

  // 关联失败用例截图引用；多个失败用例共享同一 defectRef 时按 defectRef 去重（保留首次出现）
  const seenRefs = new Set<string>();
  const screenshots: ScreenshotRef[] = [];
  for (const r of failed) {
    if (!r.defectRef || seenRefs.has(r.defectRef)) continue;
    seenRefs.add(r.defectRef);
    screenshots.push({
      id: r.defectRef,
      fileName: `${r.caseNo}.png`,
      caseNo: r.caseNo,
      path: `screenshots/${r.defectRef}.png`,
    });
  }

  // 按模块分组
  const groups = new Map<string, ExecutionResult[]>();
  for (const r of failed) {
    const mod = deriveModule(r.caseNo);
    const arr = groups.get(mod) ?? [];
    arr.push(r);
    groups.set(mod, arr);
  }

  const defectTable: DefectRow[][] = [];
  for (const [mod, cases] of groups) {
    // moduleFilter 语义：未提供或空串（falsy）视为不过滤，返回全部分组；
    // 非空串时须与推导出的模块键精确匹配。
    if (valid.moduleFilter && mod !== valid.moduleFilter) continue;
    defectTable.push(cases.map((r, i) => buildDefectRow(r, i + 1, r.defectRef)));
  }

  return { defectTable, screenshots };
};
