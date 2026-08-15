/**
 * @file logic.ts
 * @description 缺陷提取纯函数（无副作用，便于单测与 verify）
 * @frozen 行为对齐 contracts/DefectContract；不修改 contracts/engine-mcp 接口
 */
import type { ExecutionResult, DefectRow } from '@test-platform/contracts';
import { DefectRowSchema } from '@test-platform/contracts';

/** 问题级别枚举（冻结） */
export type DefectLevel = DefectRow['level'];

/**
 * 从用例编号推导模块分组键：去掉末尾 _NN 序号。
 * 已知限制：ExecutionResult 未携带显式模块字段，故以用例编号基（测试点标识组）作为分组键，
 * moduleFilter 须与推导出的模块键精确匹配（见 index.ts 注释）。
 */
export function deriveModule(caseNo: string): string {
  return caseNo.replace(/_\d+$/, '');
}

/** 构建缺陷描述：取首个失败步骤「预期≠实际」，否则回退到用例级失败说明 */
export function buildDescription(result: ExecutionResult): string {
  const failedStep = result.steps.find((s) => s.result === 'failed');
  if (failedStep) {
    return `${failedStep.step}·${failedStep.operation}：预期「${failedStep.expected}」，实际「${failedStep.actual}」`;
  }
  return `用例 ${result.caseNo} 执行失败`;
}

/** OS 别名归一（解决同一 OS 多种写法导致缺陷环境不可比） */
const OS_CANON: Record<string, string> = {
  win: 'Win11', windows: 'Win11', win11: 'Win11', win10: 'Win10',
  mac: 'macOS', macos: 'macOS', osx: 'macOS',
  linux: 'Linux', ubuntu: 'Linux',
};
/** 浏览器别名归一 */
const BROWSER_CANON: Record<string, string> = {
  chrome: 'Chrome', chromium: 'Chrome',
  edge: 'Edge', firefox: 'Firefox', safari: 'Safari',
};

/** 环境字段大小写/别名归一（导出供 createDefect / normalize 复用） */
export function normalizeEnv(os: string, browser: string): { os: string; browser: string } {
  const o = (os ?? '').trim().toLowerCase();
  const b = (browser ?? '').trim().toLowerCase();
  return {
    os: OS_CANON[o] ?? (os || 'unknown'),
    browser: BROWSER_CANON[b] ?? (browser || 'unknown'),
  };
}

/**
 * 问题产生环境：{os}·{browser}[·{version}]·{caseNo}[/失败步骤]
 * 对齐原型「Win11·Chrome·QYYX_PZ_JCX_01/S2」三段式；含 version 时以 '·' 续接（无空格），
 * os/browser 经别名归一（③-3 修复）。
 */
export function deriveEnvironment(result: ExecutionResult): string {
  const { env } = result;
  const failedStep = result.steps.find((s) => s.result === 'failed');
  const tail = failedStep ? `/${failedStep.step}` : '';
  const ver = env.version ? `·${env.version}` : '';
  const { os, browser } = normalizeEnv(env.os, env.browser);
  return `${os}·${browser}${ver}·${result.caseNo}${tail}`;
}

const LEVEL_HIGH = ['安全', '权限', '越权', '数据丢失', '崩溃', '删除', '丢失'];
const LEVEL_LOW = ['易用性', '乱码', '显示', '布局', '刷新', '样式', '提示', '体验'];

/** 问题级别：安全/数据类→高，外观/体验类→低，其余→中 */
export function deriveLevel(description: string): DefectLevel {
  if (LEVEL_HIGH.some((k) => description.includes(k))) return '高';
  if (LEVEL_LOW.some((k) => description.includes(k))) return '低';
  return '中';
}

/** 质量特性：基于缺陷描述关键词归类（功能正确性 / 健壮性 / 易用性 / 安全性） */
export function deriveQualityAttribute(description: string): string {
  if (['安全', '权限', '越权'].some((k) => description.includes(k))) return '安全性';
  if (['异常', '崩溃', '超时', '报错', '脚本', '卡死', '挂起'].some((k) => description.includes(k))) return '健壮性';
  if (['乱码', '显示', '布局', '刷新', '样式', '提示', '操作'].some((k) => description.includes(k))) return '易用性';
  return '功能正确性';
}

/**
 * 规范化整段产生环境字符串（如 `win11·chromium·QYYX_PZ_JCX_01/S2`）。
 * 仅对首个 OS 段、次个浏览器段做别名归一，其余（用例号/失败步骤）原样保留，
 * 对齐原型 `Win11·Chrome·...` 形态；段不足两段时原样返回。
 */
export function normalize(environment: string): string {
  const parts = environment.split('·');
  if (parts.length < 2) return environment;
  const [osRaw, browserRaw, ...rest] = parts;
  const { os, browser } = normalizeEnv(osRaw, browserRaw);
  return [os, browser, ...rest].join('·');
}

/** 创建六列缺陷记录所需的入参（环境以结构化字段传入，内部经 normalizeEnv 归一） */
export interface CreateDefectParams {
  /** 序号 */
  sequence: number;
  /** 问题描述 */
  description: string;
  /** 问题产生环境（结构化） */
  environment: {
    /** 操作系统（原始写法，如 win11/chrome... 经归一） */
    os: string;
    /** 浏览器（原始写法） */
    browser: string;
    /** 版本（可选） */
    version?: string;
    /** 关联用例编号（作为环境尾缀） */
    caseNo: string;
    /** 失败步骤（可选，作为环境尾缀 /S2） */
    step?: string;
  };
  /** 问题截图引用（可选） */
  screenshotRef?: string;
  /** 问题级别（缺省按描述推导） */
  level?: DefectLevel;
  /** 质量特性（缺省按描述推导） */
  qualityAttribute?: string;
}

/**
 * 真实缺陷创建逻辑：六列固定（序号/问题描述/问题截图/级别/质量特性/产生环境）。
 * - 产生环境经 normalizeEnv 规范化为 `Win11/macOS/Linux` + `Chrome/Edge/Firefox/Safari` 等；
 * - 级别 / 质量特性未显式给定时按描述关键词推导（见 deriveLevel / deriveQualityAttribute）；
 * - 输出严格对齐 DefectRow，可用 DefectRowSchema 校验。
 */
export function createDefect(params: CreateDefectParams): DefectRow {
  const { os, browser } = normalizeEnv(params.environment.os, params.environment.browser);
  const ver = params.environment.version ? `·${params.environment.version}` : '';
  const tail = params.environment.step ? `/${params.environment.step}` : '';
  const environment = `${os}·${browser}${ver}·${params.environment.caseNo}${tail}`;
  return {
    sequence: params.sequence,
    description: params.description,
    screenshotRef: params.screenshotRef,
    level: params.level ?? deriveLevel(params.description),
    qualityAttribute: params.qualityAttribute ?? deriveQualityAttribute(params.description),
    environment,
  };
}

/** Excel 导入导出六列表头（顺序固定，对齐 DefectRow 六列） */
export const DEFECT_TSV_HEADER = ['序号', '问题描述', '问题截图', '问题级别', '质量特性', '问题产生环境'] as const;

/** JSON 导出结构（Excel 友好：扁平行 + 版本号，便于 round-trip 校验） */
export interface DefectExport {
  /** 格式版本 */
  version: 1;
  /** 六列缺陷行（扁平） */
  rows: DefectRow[];
}

/** 导出缺陷表为 JSON 友好结构（保留分组前的扁平行） */
export function exportDefects(table: DefectRow[][]): DefectExport {
  return { version: 1, rows: table.flat() };
}

/** 导出缺陷表为 JSON 字符串 */
export function exportDefectsJSON(table: DefectRow[][]): string {
  return JSON.stringify(exportDefects(table), null, 2);
}

/** 解析 JSON 字符串回缺陷行（逐行经 DefectRowSchema 校验，结构非法即抛错） */
export function importDefectsJSON(json: string): DefectRow[] {
  const parsed = JSON.parse(json) as { version?: number; rows?: unknown };
  if (!Array.isArray(parsed.rows)) throw new Error('invalid defect export: rows missing');
  return parsed.rows.map((r, i) => {
    const res = DefectRowSchema.safeParse(r);
    if (!res.success) throw new Error(`defect row ${i} invalid: ${res.error.message}`);
    return res.data;
  });
}

/** 导出缺陷表为 Excel 友好 TSV（六列顺序固定，首行为表头） */
export function exportDefectsTSV(table: DefectRow[][]): string {
  const lines = [DEFECT_TSV_HEADER.join('\t')];
  for (const r of table.flat()) {
    lines.push(
      [String(r.sequence), r.description, r.screenshotRef ?? '', r.level, r.qualityAttribute, r.environment].join('\t'),
    );
  }
  return lines.join('\n');
}

/** 解析 Excel 友好 TSV 回缺陷行（首行若为表头则跳过） */
export function importDefectsTSV(tsv: string): DefectRow[] {
  const lines = tsv.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const start = lines[0].split('\t')[0] === DEFECT_TSV_HEADER[0] ? 1 : 0;
  const rows: DefectRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const [seq, description, screenshotRef, level, qualityAttribute, environment] = lines[i].split('\t');
    const row: DefectRow = {
      sequence: Number(seq),
      description,
      screenshotRef: screenshotRef || undefined,
      level: level as DefectRow['level'],
      qualityAttribute,
      environment,
    };
    const res = DefectRowSchema.safeParse(row);
    if (!res.success) throw new Error(`defect TSV row ${i} invalid: ${res.error.message}`);
    rows.push(res.data);
  }
  return rows;
}
