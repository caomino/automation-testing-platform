/**
 * @file abbr.ts
 * @description 前端轻量版测试点标识缩写派生。
 *   与 @test-platform/stage-feature/src/abbreviation.ts 的核心派生规则保持等价：
 *     base（3段）= 系统缩写 _ 主模块缩写 _ 子模块缩写（中文取拼音首字母大写）；
 *     未知汉字/无语义词元回退到稳定短哈希，保证不含 '_'，严格单段。
 *
 *   注意：APP 包不得反向依赖 stage-feature（架构：contracts ← infra ← engine ← stage ← app），
 *   因此在 app 内保留一份与后端同构的纯函数实现，保证前后端生成的缩写风格一致。
 */

/** 覆盖高频中文汉字 → 拼音首字母大写（与 stage-feature CJK_INITIALS 冻结字典保持完全一致） */
const CJK_INITIALS: Record<string, string> = {
  // 通用行业/高频字（医疗影像、政务、营销、测试、通用管理）
  区: 'Q', 域: 'Y', 影: 'Y', 像: 'X', 系: 'X', 统: 'T',
  检: 'J', 查: 'C', 室: 'S', 管: 'G', 理: 'L',
  配: 'P', 置: 'Z', 询: 'X', 新: 'X', 增: 'Z',
  导: 'D', 出: 'C', 修: 'X', 改: 'G', 删: 'S', 除: 'C',
  报: 'B', 告: 'G', 企: 'Q', 业: 'Y', 营: 'Y', 销: 'X',
  模: 'M', 块: 'K', 功: 'G', 能: 'N', 用: 'Y', 户: 'H',
  录: 'L', 登: 'D', 权: 'Q', 限: 'X', 数: 'S', 据: 'J',
  看: 'K', 编: 'B', 辑: 'J', 搜: 'S', 索: 'S', 计: 'J',
  设: 'S', 入: 'R', 预: 'Y', 览: 'L', 审: 'S', 核: 'H',
  批: 'P', 提: 'T', 效: 'X', 错: 'C', 误: 'W', 存: 'C',
  储: 'C', 文: 'W', 件: 'J', 打: 'D', 印: 'Y', 全: 'Q',
  部: 'B', 选: 'X', 择: 'Z', 过: 'G', 滤: 'L', 详: 'X',
  情: 'Q', 操: 'C', 作: 'Z', 步: 'B', 归: 'G', 论: 'L',
  测: 'C', 试: 'S', 点: 'D', 主: 'Z', 子: 'Z', 平: 'P',
  台: 'T', 应: 'Y', 超: 'C', 声: 'S', 列: 'L', 表: 'B',
  风: 'F', 格: 'G', 实: 'S', 验: 'Y', 航: 'H',
  面: 'M', 包: 'B', 屑: 'X', 保: 'B', 活: 'H', 页: 'Y',
  终: 'Z', 始: 'S', 展: 'Z', 开: 'K', 动: 'D', 态: 'T',
  徽: 'H', 章: 'Z', 图: 'T', 标: 'B', 参: 'C',
  居: 'J', 中: 'Z', 布: 'B', 局: 'J', 签: 'Q',
  栏: 'L', 组: 'Z', 演: 'Y', 示: 'S',

  // 医疗/影像固定模板
  医: 'Y', 师: 'S', 站: 'Z', 大: 'D',

  // Ruoyi 真实模板（覆盖 9+ 分组与所有功能点/测试点）
  若: 'R', 依: 'Y', 概: 'G', 况: 'K', 技: 'J', 术: 'S', 型: 'X',
  刷: 'S', 首: 'S', 状: 'Z',
  访: 'F', 问: 'W', 发: 'F', 档: 'D', 源: 'Y', 社: 'S',
  创: 'C', 建: 'J', 对: 'D', 话: 'H', 送: 'S',
  消: 'X', 息: 'X', 重: 'C', 命: 'M', 名: 'M', 题: 'T', 历: 'L', 史: 'S',
  快: 'K', 捷: 'J', 跳: 'T', 转: 'Z', 官: 'G', 方: 'F', 门: 'M',
  网: 'W',
  监: 'J', 控: 'K', 工: 'G', 具: 'J',
  角: 'J', 色: 'S', 单: 'D', 个: 'G', 量: 'L', 密: 'M', 码: 'M',
  分: 'F', 职: 'Z', 菜: 'C', 岗: 'G', 位: 'W',
  字: 'Z', 典: 'D', 类: 'L',
  通: 'T', 知: 'Z', 公: 'G', 日: 'R', 志: 'Z', 流: 'L', 水: 'S',
  解: 'J', 锁: 'S', 异: 'Y', 常: 'C', 账: 'Z', 号: 'H',
  在: 'Z', 线: 'X', 会: 'H', 强: 'Q', 退: 'T', 即: 'J', 立: 'L', 执: 'Z',
  行: 'X', 次: 'C', 获: 'H', 取: 'Q', 内: 'N', 磁: 'C', 盘: 'P',
  率: 'L', 缓: 'H', 指: 'Z', 定: 'D', 键: 'J', 清: 'Q',
  库: 'K', 结: 'J', 构: 'G', 拖: 'T', 拽: 'Z',
  链: 'L', 复: 'F', 制: 'Z',
};

const CJK_RANGE = /[一-鿿]/;
const ASCII_ALNUM = /[A-Za-z0-9]/;

/**
 * 金标准冻结词条（与 stage-feature/src/abbreviation.ts 里 FROZEN_TOKENS 保持完全一致）。
 * —— docs 已把这些缩写固化到金标准 Excel、原型 Screen3/4、用例编号，不得被逐字拼音首字母重新派生：
 *   例：检查室(JCX) / 医师站(YSZ) / 配置(PZ) / 区域影像系统(QYYX)。
 */
const FROZEN_TOKENS: Record<string, string> = {
  // 系统名
  '区域影像系统': 'QYYX',
  '区域影像': 'QYYX',
  // 父目录（主模块）
  '配置': 'PZ',
  '报告': 'BG',
  '系统管理': 'XTGL',
  '系统监控': 'XTJK',
  '系统工具': 'XTGJ',
  // 子系统（子模块）
  '检查室': 'JCX',
  '医师站': 'YSZ',
  '影像报告': 'YXBG',
  '公共知识库': 'GGZSK',
  // 常见功能点
  '检查报告': 'JCBG',
  '检查室管理': 'JCSGL',
  '医师站管理': 'YSZGL',
  // Ruoyi 常见子系统
  '用户管理': 'YHGL',
  '角色管理': 'JSGL',
  '菜单管理': 'CDGL',
  '部门管理': 'BMGL',
  '岗位管理': 'GWGL',
  '字典管理': 'ZDGL',
  '参数设置': 'CSSZ',
  '通知公告': 'TZHG',
  '操作日志': 'CZRZ',
  '登录日志': 'DLRZ',
  '在线用户': 'ZXYH',
  '定时任务': 'DSRW',
  '数据监控': 'SJKJ',
  '缓存监控': 'HCKJ',
  '缓存列表': 'HCLB',
  '代码生成': 'DMSC',
  '系统接口': 'XTJK',
  '表单构建': 'DBGJ',
};
function tryFrozenToken(raw: string): string | undefined {
  return FROZEN_TOKENS[(raw ?? '').trim()];
}

/** 稳定短哈希（FNV-1a），与 stage-feature.shortHash 算法一致 */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6).toUpperCase();
}

function toSingleToken(raw: string): string {
  const frozen = tryFrozenToken(raw);
  if (frozen) return frozen;
  let out = '';
  for (const ch of raw) {
    if (ASCII_ALNUM.test(ch)) {
      out += ch.toUpperCase();
    } else if (CJK_RANGE.test(ch)) {
      const initial = CJK_INITIALS[ch];
      out += initial ?? shortHash(ch).slice(0, 2);
    }
  }
  return out;
}

const KNOWN_PREFIXES = new Set([
  'SYS', 'SYSTEM', 'MOD', 'MODULE', 'PAGE', 'SUB', 'SUBSYSTEM',
  'ACT', 'ACTION', 'NODE', 'N', 'ROOT',
]);

/**
 * 派生单段稳定缩写 token（与后端 toAbbrToken 等价）。
 * 返回恒不含 '_'，保证拼接后 3 段 base 的段数正确。
 * 金标准冻结词条（检查室→JCX 等）优先命中，再回退逐字拼音首字母/短哈希。
 */
export function toAbbrToken(raw: string): string {
  const cleaned = (raw ?? '').trim();
  if (!cleaned) return 'X';

  const frozen = tryFrozenToken(cleaned);
  if (frozen) return frozen;

  const segments = cleaned.split(/[_\-\s/]+/).filter(Boolean);
  const words = segments
    .map((s) => s.toUpperCase())
    .filter((s) => s.length > 0 && !KNOWN_PREFIXES.has(s));

  if (words.length === 0) {
    if (CJK_RANGE.test(cleaned)) {
      const initials = toSingleToken(cleaned);
      return initials.length > 0 ? initials : shortHash(cleaned);
    }
    return shortHash(cleaned);
  }

  if (words.length === 1) {
    return toSingleToken(words[0]);
  }

  return shortHash(cleaned);
}

/** 按「label 优先」派生：中文 label 存在优先用 label（先冻结词条 → 拼音首字母 → 金标准 QYYX_PZ_JCX 风格），否则回退 id。与后端 toAbbrTokenWithLabel 等价。 */
export function toAbbrTokenWithLabel(id: string, label?: string | null): string {
  // 与后端 normalizeLabel 一致：去掉括号英文注释（"首页 (Index / Dashboard)" → "首页"），保证缩写基于中文主名
  const cleanedLabel = (label ?? '').replace(/\s*[（(][^)）]*[)）]\s*/g, '').replace(/[（(][^)）]*[)）]/g, '').trim();
  if (cleanedLabel) {
    const frozen = tryFrozenToken(cleanedLabel);
    if (frozen) return frozen;
    return toAbbrToken(cleanedLabel);
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
  // 去除「中文原文 + (英文翻译/备注)」括号（半角/全角/方括号，上限80字符防贪婪匹配失败），再合并空白
  s = s.replace(/\s*[(（\[][^)\]\）]{0,80}[)）\]]\s*/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * 为 featureRows（原始态）派生出"显示态 rows"用于 UI 渲染：
 *   ① 4 列文本 normalizeDisplayLabel 去括号；
 *   ② 父子模块重复显示优化（main==sub 主置空、sub==feature 功能置空）。
 * 显示态只用于 Feature.tsx 渲染/合并/导出HTML，绝对不写回 state.featureRows，
 * 保证 fromFeatureViewToTable→contracts 不会把"去重后空列""去括号后文本"误当成用户真实值落库。
 */
export function deriveDisplayRows<T extends { mainModule: string; subModule: string; feature: string; testPoint: string }>(rows: T[]): T[] {
  return rows.map((r) => {
    const mainNorm = normalizeDisplayLabel(r.mainModule);
    const subNorm = normalizeDisplayLabel(r.subModule);
    const featNorm = normalizeDisplayLabel(r.feature);
    const tpNorm = normalizeDisplayLabel(r.testPoint);
    return {
      ...r,
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
