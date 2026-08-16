/**
 * @file abbreviation.ts
 * @description 测试点标识缩写派生（确定性、无外部依赖、无硬编码密钥）
 *
 * base = 系统缩写_父目录缩写_子系统缩写（严格 3 段），由模块树节点 id 确定性派生。
 * 核心不变量：每个分量（toAbbrToken 的返回值）恒为「单段 token」（不含 '_'），
 * 从而 base 的段数恒为 3。
 *   - 普通语义 id（如 sys_qyyx）→ 去除已知前缀后取首段：QYYX
 *   - UUID / 路径哈希 / 多词元 id（如 a-b-c-d、/a/b/c）→ 稳定哈希收敛为单段 token
 *   - 中文 id / 标签 → 按 docs R-A-01 转拼音首字母大写（企业营销→QYYX），
 *     未知汉字回退到短哈希，保证生成的标识不含原生中文、风格对齐 QYYX_PZ_JCX。
 */

/** 已知节点 id 前缀（派生缩写时剥离，避免 SYS_/MOD_ 等噪声） */
const KNOWN_PREFIXES = new Set([
  'SYS', 'SYSTEM', 'MOD', 'MODULE', 'PAGE', 'SUB', 'SUBSYSTEM',
  'ACT', 'ACTION', 'NODE', 'N', 'ROOT',
]);

/** 常见汉字 → 拼音首字母大写（覆盖医疗/影像/企业管理等高频字；其余回退短哈希） */
const CJK_INITIALS: Record<string, string> = {
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
  台: 'T', 应: 'Y',
};

const CJK_RANGE = /[一-鿿]/;
const ASCII_ALNUM = /[A-Za-z0-9]/;

/** 稳定短哈希（FNV-1a），用于无语义词元 / 未知汉字的兜底缩写 */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6).toUpperCase();
}

/**
 * 将 CJK / 混合字符串转为「单段」首字母 token：
 *   - ASCII 字母数字原样保留并大写
 *   - 已知汉字取拼音首字母大写
 *   - 未知汉字回退到 2 位短哈希（仍不含 '_'，保持单段）
 * 分隔符（_ - 空格 /）被跳过，保证输出为单一连续 token。
 */
function toSingleToken(raw: string): string {
  let out = '';
  for (const ch of raw) {
    if (ASCII_ALNUM.test(ch)) {
      out += ch.toUpperCase();
    } else if (CJK_RANGE.test(ch)) {
      const initial = CJK_INITIALS[ch];
      out += initial ?? shortHash(ch).slice(0, 2);
    }
    // 其余分隔符 / 符号直接忽略
  }
  return out;
}

/**
 * 将任意标识（节点 id / 中文标签）派生为「单段」稳定缩写 token。
 * 返回恒不包含 '_'，从而保证 base = 系统缩写_父目录缩写_子系统缩写 严格为 3 段。
 *   - 语义 id（sys_qyyx）→ 去前缀取首段：QYYX
 *   - UUID / 路径哈希 / 多词元 id → 稳定哈希收敛为单段 token
 *   - 中文 id（企业营销）→ 拼音首字母大写：QYYX
 *   - 空输入 → X
 */
export function toAbbrToken(raw: string): string {
  const cleaned = (raw ?? '').trim();
  if (!cleaned) return 'X';

  const segments = cleaned.split(/[_\-\s/]+/).filter(Boolean);
  const words = segments
    .map((s) => s.toUpperCase())
    .filter((s) => s.length > 0 && !KNOWN_PREFIXES.has(s));

  if (words.length === 0) {
    // 仅含已知前缀 / 纯分隔符 / 无语义词元
    if (CJK_RANGE.test(cleaned)) {
      const initials = toSingleToken(cleaned);
      return initials.length > 0 ? initials : shortHash(cleaned);
    }
    return shortHash(cleaned);
  }

  if (words.length === 1) {
    // 普通语义 id：取首段（段内 CJK 仍转拼音首字母）
    return toSingleToken(words[0]);
  }

  // 多词元 / UUID / 路径哈希：稳定哈希收敛为单段 token（不按 '-' 拆成多段）
  return shortHash(cleaned);
}

/** 由 subsystemId（如 sys_qyyx）派生系统缩写（QYYX）；缺省时回退到系统名称（可中文） */
export function systemAbbrFromSubsystemId(subsystemId: string, fallbackSystemName: string): string {
  if (subsystemId && subsystemId.trim()) return toAbbrToken(subsystemId);
  return toAbbrToken(fallbackSystemName);
}
