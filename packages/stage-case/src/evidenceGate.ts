/**
 * @file evidenceGate.ts
 * @description 功能点证据门（spec §6.2）：对每个功能点独立判定其专属证据是否可复用，
 *              形成 missingFeatureIds。禁止用"全局 exploredElements 非空"代替逐功能点判断。
 */
import type { FeatureEvidence, FeatureProfile } from '@test-platform/contracts';

export interface EvidenceGateResult {
  /** 是否拥有可用于本功能点的专属证据 */
  hasEvidence: boolean;
  /** 证据是否通过一致性校验（不通过则降级为 needs_review，不阻断生成） */
  consistent: boolean;
  reasons: string[];
}

export interface EvidenceGateOptions {
  systemId?: string;
  featureRevision?: string;
}

function urlsSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
}

/**
 * 判定字段名是否疑似 DOM name/id token 泄漏（如 theSelect、btSelectAll、userName）。
 * 纯英文/数字标识符、无中文字符、长度适中 → 视为不可读 token，是采集阶段未过滤干净的脏数据标志。
 * 与 featureEvidenceExplorer.isLeakedToken 同源（stage-case 不依赖 orchestrator，故就近内联一份）。
 */
function isLeakedTokenName(name: string | undefined): boolean {
  if (!name) return false;
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && name.length <= 40 && !/[\u4e00-\u9fff]/.test(name);
}

export function gateFeatureEvidence(
  featureId: string,
  profile: FeatureProfile | undefined,
  evidence: FeatureEvidence | undefined,
  pagePath?: string,
  options?: EvidenceGateOptions,
): EvidenceGateResult {
  const reasons: string[] = [];

  if (!evidence) {
    return { hasEvidence: false, consistent: false, reasons: ['无当前功能点专属证据'] };
  }
  if (evidence.featureId && evidence.featureId !== featureId) {
    reasons.push('证据 featureId 与当前功能点不一致');
  }
  if (options?.systemId && evidence.systemId !== options.systemId) {
    reasons.push(evidence.systemId ? '证据系统与当前系统不一致' : '证据缺少当前系统身份');
  }
  if (options?.featureRevision && evidence.featureRevision !== options.featureRevision) {
    reasons.push(evidence.featureRevision ? '证据功能点版本与当前版本不一致' : '证据缺少当前功能点版本身份');
  }
  const expectedEntry = profile?.clickSelector || profile?.sourceSelector;
  // 仅当功能点档案已明确动作类型（非未知 other）时，才对证据动作类型做一致性校验；
  // 档案为 other（探索未识别）而证据经页面反推得到具体类型属正向纠偏，不应判为不一致。
  if (profile && evidence.actionKind && evidence.actionKind !== profile.actionKind && profile.actionKind !== 'other') {
    reasons.push('证据动作类型与功能点档案不一致');
  }
  const requiredActionState = profile && (['create', 'update', 'detail'] as string[]).includes(profile.actionKind)
    ? profile.actionKind as FeatureEvidence['states'][number]
    : undefined;
  if (requiredActionState && !evidence.states.includes(requiredActionState)) {
    reasons.push(`证据缺少${requiredActionState}动作状态`);
  }
  if (pagePath && evidence.pageUrl && pagePath.startsWith('http') && evidence.pageUrl.startsWith('http')) {
    try {
      const expected = new URL(pagePath);
      const actual = new URL(evidence.pageUrl);
      const expectedPath = `${expected.origin}${expected.pathname.replace(/\/$/, '')}${expected.search}${expected.hash}`;
      const actualPath = `${actual.origin}${actual.pathname.replace(/\/$/, '')}${actual.search}${actual.hash}`;
      if (expectedPath !== actualPath) reasons.push('证据页面路径与功能点入口不一致');
    } catch {
      if (!urlsSameOrigin(pagePath, evidence.pageUrl) || pagePath !== evidence.pageUrl) {
        reasons.push('证据页面路径与功能点入口不一致');
      }
    }
  }
  if ((options?.systemId || options?.featureRevision) && !evidence.pageEntry) {
    reasons.push('证据缺少功能点页面入口身份');
  }
  if (pagePath && evidence.pageEntry && /^https?:\/\//i.test(pagePath) && /^https?:\/\//i.test(evidence.pageEntry)) {
    try {
      const expected = new URL(pagePath);
      const actual = new URL(evidence.pageEntry);
      const expectedPath = `${expected.origin}${expected.pathname.replace(/\/$/, '')}${expected.search}${expected.hash}`;
      const actualPath = `${actual.origin}${actual.pathname.replace(/\/$/, '')}${actual.search}${actual.hash}`;
      if (expectedPath !== actualPath) reasons.push('证据页面入口与功能点入口不一致');
    } catch {
      if (pagePath !== evidence.pageEntry) reasons.push('证据页面入口与功能点入口不一致');
    }
  }
  if (expectedEntry && !reasons.some((reason) => reason.includes('页面路径'))) {
    const matchingEntry = evidence.actionEntries.some((entry) =>
      entry.selector === expectedEntry || entry.ref === expectedEntry,
    );
    if (!matchingEntry) {
      reasons.push(evidence.actionEntries.length > 0
        ? '证据动作入口与功能点档案不一致'
        : '证据缺少功能点动作入口');
    }
  }
  const hasContent =
    (evidence.fields?.length ?? 0) > 0
    || (evidence.actionEntries?.length ?? 0) > 0
    || (evidence.tables?.length ?? 0) > 0
    || !!evidence.structuredDesign;
  if (!hasContent) {
    reasons.push('证据缺少可生成场景的字段/入口/表格/设计信息');
  }
  // 字段名疑似 DOM token 泄漏（theSelect/btSelectAll/userName 等）：说明该证据来自未净化的采集，
  // 不应作为可信证据复用，强制判为不一致 → 触发重新采集，终结"改了代码却毫无变化"的脏证据无限复用。
  const leakedFields = (evidence.fields ?? []).filter((field) => isLeakedTokenName(field.name ?? field.ref));
  if (leakedFields.length > 0) {
    reasons.push(`证据字段名疑似 DOM token 泄漏（${leakedFields.slice(0, 3).map((field) => field.name ?? field.ref).join('/')} 等 ${leakedFields.length} 个），需重新采集`);
  }

  return {
    hasEvidence: true,
    consistent: reasons.length === 0,
    reasons,
  };
}
