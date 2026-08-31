import { pinyin } from 'pinyin-pro';

/**
 * @file abbr.ts
 * @description 前端轻量版测试点标识缩写派生（基于 pinyin-pro 动态生成，零硬编码）。
 *   与 @test-platform/stage-feature/src/abbreviation.ts 的核心派生规则保持等价：
 *     base（3段）= 系统缩写 _ 主模块缩写 _ 子模块缩写（中文取拼音首字母大写）；
 *     未知字符回退到稳定短哈希，保证不含 '_'，严格单段。
 */

const KNOWN_PREFIXES = new Set([
  'SYS', 'SYSTEM', 'MOD', 'MODULE', 'PAGE', 'SUB', 'SUBSYSTEM',
  'ACT', 'ACTION', 'NODE', 'N', 'ROOT',
]);

/** 稳定短哈希（FNV-1a），与 stage-feature.shortHash 算法一致 */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6).toUpperCase();
}

/** 剥离已知节点前缀（SYS_/MOD_/SUB_/PAGE_ 等）；仅前缀本身视为空词元 */
function stripKnownPrefix(value: string): { stripped: string; empty: boolean } {
  const upper = value.toUpperCase();
  for (const prefix of KNOWN_PREFIXES) {
    if (upper === prefix) return { stripped: '', empty: true };
    if (upper.startsWith(prefix + '_')) return { stripped: value.slice(prefix.length + 1), empty: false };
  }
  return { stripped: value, empty: false };
}

/** 动态提取中文/英文/数字的首字母缩写 */
function getInitials(text: string): string {
  const cleaned = (text ?? '').trim();
  if (!cleaned) return '';
  const letters = pinyin(cleaned, {
    pattern: 'first',
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  });
  return letters.join('').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * 派生单段稳定缩写 token（与后端 toAbbrToken 等价）。
 * 返回恒不含 '_'，保证拼接后 3 段 base 的段数正确。
 */
export function toAbbrToken(raw: string): string {
  const cleaned = (raw ?? '').trim();
  if (!cleaned) return 'X';

  const { stripped, empty } = stripKnownPrefix(cleaned);
  if (empty) return shortHash(cleaned);
  if (/^[A-Za-z0-9]+$/.test(stripped)) return stripped.toUpperCase();

  const initials = getInitials(stripped);
  if (initials) return initials;

  return shortHash(cleaned);
}

/** 按「label 优先」派生：中文 label 存在优先用 label 动态派生拼音缩写，否则回退 id。与后端 toAbbrTokenWithLabel 等价。 */
export function toAbbrTokenWithLabel(id: string, label?: string | null): string {
  const cleanedLabel = (label ?? '')
    .replace(/\s*[（(][^)）]*[)）]\s*/g, '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .trim();
  if (cleanedLabel) {
    if (/^[A-Za-z0-9]+$/.test(cleanedLabel)) return cleanedLabel.toUpperCase();
    const initials = getInitials(cleanedLabel);
    if (initials) return initials;
  }
  return toAbbrToken(id);
}

/** 拼接 3 段 base；空段统一用 'X' 兜底，保证 base 永远 3 段。 */
export function buildFeatureBase(sysAbbr: string, mainAbbr: string, subAbbr: string): string {
  const norm = (s: string) => s || 'X';
  return `${norm(sysAbbr)}_${norm(mainAbbr)}_${norm(subAbbr)}`;
}

/**
 * 解析现有 testPointId 的 3 段 base，找不到时返回 null。
 * 允许形如 "SYS_MAIN_SUB_01" 或兼容旧 "SYS_MAIN_SUB"（无尾号）。
 */
export function tryParseBaseFromId(testPointId: string): string | null {
  const s = (testPointId ?? '').trim();
  if (!s) return null;
  const parts = s.split('_');
  // 4 段标准：AAA_BBB_CCC_NN → 取前 3
  if (parts.length === 4) return parts.slice(0, 3).join('_');
  // 3 段：直接复用
  if (parts.length === 3 && /^[A-Z0-9]+$/.test(parts.join(''))) return parts.join('_');
  // 其他形态（base_01 等）视为旧占位，不做强解析
  return null;
}

/**
 * 在 feature 视图 rows 里：按「系统_主_子」三段分组，返回每个分组下的"下一个 NN（两位补零）"。
 * 等价于后端 featureTable.ts 的「子系统维度自增」。
 */
export function groupNextNnMap(rows: { system: string; mainModule: string; subModule: string }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const sys = toAbbrToken(r.system || '');
    const main = toAbbrToken(r.mainModule || '');
    const sub = toAbbrToken(r.subModule || r.mainModule || '');
    const key = buildFeatureBase(sys, main, sub);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [k, n] of counts) out.set(k, String(n + 1).padStart(2, '0'));
  return out;
}

/**
 * 展示层文本归一化（默认用于 功能审核表 显示：去掉 DOM/模板原文里的 (英文名/别名) 括号及内容，统一去空白）。
 * ——只对"显示态视图层"生效，不会修改 contracts/前端 state.featureRows 原文；
 *   上游保存的 FeatureRow 九列、缩写派生一律基于原始值，确保溯源和缩写确定性。
 */
export function normalizeDisplayLabel(raw: string | null | undefined): string {
  let s = (raw ?? '').trim();
  if (!s) return '';
  // 去除「中文原文 + (英文翻译/备注/角标)」括号（半角/全角圆括号、方括号、黑括号，上限80字符防贪婪匹配失败），再合并空白
  s = s.replace(/\s*[(（\[【][^)\]\）】]{0,80}[)）\]】]\s*/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * 为 featureRows（原始态）派生出"显示态 rows"用于 UI 渲染：
 *   ① 4 列文本 normalizeDisplayLabel 去括号；
 *   ② 需求章节列 X.0.0 等占位符置空（正常显示为空白并合并单元格）；
 *   ③ 父子模块重复显示优化（main==sub 主置空、sub==feature 功能置空）。
 * 显示态只用于 Feature.tsx 渲染/合并/导出HTML，绝对不写回 state.featureRows，
 * 保证 fromFeatureViewToTable→contracts 不会把"去重后空列""去括号后文本"误当成用户真实值落库。
 */
export function deriveDisplayRows<T extends { mainModule: string; subModule: string; feature: string; testPoint: string; chapter?: string; seq?: string }>(rows: T[]): T[] {
  return rows.map((r, idx) => {
    const mainNorm = normalizeDisplayLabel(r.mainModule);
    const subNorm = normalizeDisplayLabel(r.subModule);
    const featNorm = normalizeDisplayLabel(r.feature);
    const tpNorm = normalizeDisplayLabel(r.testPoint);
    let chapterNorm = r.chapter ? normalizeDisplayLabel(r.chapter) : '';
    // X.0.0 / 1.0.0 / X.Y.Z 等纯占位格式在界面上显示为空白，并参与整块单元格合并
    if (/^[X\d]+\.0\.0$/i.test(chapterNorm) || /^X\.Y\.Z$/i.test(chapterNorm)) {
      chapterNorm = '';
    }
    return {
      ...r,
      ...(r.seq !== undefined ? { seq: String(idx + 1) } : {}),
      chapter: chapterNorm,
      mainModule: mainNorm && mainNorm === subNorm ? '' : mainNorm,
      subModule: subNorm,
      // feature 与 sub 或 main 重复都隐藏（首页组：主=首页、子空 → feature 不再重复显示"首页"）
      feature: featNorm && (featNorm === subNorm || featNorm === mainNorm) ? '' : featNorm,
      testPoint: tpNorm,
    };
  });
}

/**
 * 从一组 rows 中：根据目标行的系统/主/子，推断其完整 testPointId。
 *   - 如果已有 rows 中有该分组的 id，则取其 base + 本分组最大 NN + 1；
 *   - 如果分组还没有 id，派生全新 base 并以 01 起。
 */
export function nextTestPointIdFor(
  rows: { system: string; mainModule: string; subModule: string; testPointId: string }[],
  target: { system: string; mainModule: string; subModule: string },
): string {
  const sys = toAbbrToken(target.system || '');
  const main = toAbbrToken(target.mainModule || '');
  const sub = toAbbrToken(target.subModule || target.mainModule || '');
  const base = buildFeatureBase(sys, main, sub);

  let maxNn = 0;
  for (const r of rows) {
    const parts = (r.testPointId ?? '').split('_');
    if (parts.length === 4 && parts.slice(0, 3).join('_') === base) {
      const n = Number(parts[3]);
      if (Number.isFinite(n) && n > maxNn) maxNn = n;
    }
  }
  return `${base}_${String(maxNn + 1).padStart(2, '0')}`;
}

