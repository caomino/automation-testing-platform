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

/** 常见汉字 → 拼音首字母大写（覆盖功能点审核模板与 Ruoyi 真实模板高频字；其余回退短哈希） */
const CJK_INITIALS: Record<string, string> = {
  
  区: 'Q', 域: 'Y', 影: 'Y', 像: 'X', 系: 'X', 统: 'T', 检: 'J', 查: 'C',
  室: 'S', 管: 'G', 理: 'L', 配: 'P', 置: 'Z', 询: 'X', 新: 'X', 增: 'Z',
  导: 'D', 出: 'C', 修: 'X', 改: 'G', 删: 'S', 除: 'C', 报: 'B', 告: 'G',
  企: 'Q', 业: 'Y', 营: 'Y', 销: 'X', 模: 'M', 块: 'K', 功: 'G', 能: 'N',
  用: 'Y', 户: 'H', 录: 'L', 登: 'D', 权: 'Q', 限: 'X', 数: 'S', 据: 'J',
  看: 'K', 编: 'B', 辑: 'J', 搜: 'S', 索: 'S', 计: 'J', 设: 'S', 入: 'R',
  预: 'Y', 览: 'L', 审: 'S', 核: 'H', 批: 'P', 提: 'T', 效: 'X', 错: 'C',
  误: 'W', 存: 'C', 储: 'C', 文: 'W', 件: 'J', 打: 'D', 印: 'Y', 全: 'Q',
  部: 'B', 选: 'X', 择: 'Z', 过: 'G', 滤: 'L', 详: 'X', 情: 'Q', 操: 'C',
  作: 'Z', 步: 'B', 归: 'G', 论: 'L', 测: 'C', 试: 'S', 点: 'D', 主: 'Z',
  子: 'Z', 平: 'P', 台: 'T', 应: 'Y', 超: 'C', 声: 'S', 列: 'L', 表: 'B',
  风: 'F', 格: 'G', 实: 'S', 验: 'Y', 航: 'H', 面: 'M', 包: 'B', 屑: 'X',
  保: 'B', 活: 'H', 页: 'Y', 终: 'Z', 始: 'S', 展: 'Z', 开: 'K', 动: 'D',
  态: 'T', 徽: 'H', 章: 'Z', 图: 'T', 标: 'B', 参: 'C', 居: 'J', 中: 'Z',
  布: 'B', 局: 'J', 签: 'Q', 栏: 'L', 组: 'Z', 演: 'Y', 示: 'S', 医: 'Y',
  师: 'S', 站: 'Z', 大: 'D', 若: 'R', 依: 'Y', 概: 'G', 况: 'K', 技: 'J',
  术: 'S', 型: 'X', 刷: 'S', 首: 'S', 时: 'S', 状: 'Z', 访: 'F', 问: 'W',
  发: 'F', 档: 'D', 源: 'Y', 社: 'S', 创: 'C', 建: 'J', 对: 'D', 话: 'H',
  送: 'S', 消: 'X', 息: 'X', 重: 'C', 命: 'M', 名: 'M', 题: 'T', 历: 'L',
  史: 'S', 快: 'K', 捷: 'J', 跳: 'T', 转: 'Z', 官: 'G', 方: 'F', 门: 'M',
  网: 'W', 监: 'J', 控: 'K', 工: 'G', 具: 'J', 角: 'J', 色: 'S', 单: 'D',
  个: 'G', 量: 'L', 密: 'M', 码: 'M', 分: 'F', 职: 'Z', 菜: 'C', 岗: 'G',
  位: 'W', 字: 'Z', 典: 'D', 类: 'L', 通: 'T', 知: 'Z', 公: 'G', 日: 'R',
  志: 'Z', 流: 'L', 水: 'S', 解: 'J', 锁: 'S', 异: 'Y', 常: 'C', 账: 'Z',
  号: 'H', 在: 'Z', 线: 'X', 会: 'H', 强: 'Q', 退: 'T', 即: 'J', 立: 'L',
  执: 'Z', 行: 'X', 次: 'C', 获: 'H', 取: 'Q', 内: 'N', 磁: 'C', 盘: 'P',
  率: 'L', 缓: 'H', 指: 'Z', 定: 'D', 键: 'J', 清: 'Q', 库: 'K', 结: 'J',
  构: 'G', 拖: 'T', 拽: 'Z', 链: 'L', 复: 'F', 制: 'Z'
};

/** 确定性短哈希：6 位大写十六进制，保证任意多段/无词元 id 收敛为单段 token */
export function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) >>> 0;
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(6, '0').slice(-6);
}

/**
 * 金标准冻结词条（来源：docs/问题分析与补充定义.md §2 示例表、模块接口契约与开发规范.md、主规格 §6 示例）。
 * —— 这些缩写已被金标准 Excel、原型 Screen3/4、用例编号完全固化（例：检查室→JCX，配置→PZ，区域影像系统→QYYX），
 *    不能被"逐字拼音首字母自然派生"重新计算（否则"检查室"误算 JCS、"影像报告"误算 YXBG vs JCBG）。
 *    仅当 trimmed 输入字符串精确匹配整条时生效；子串不会被错误替换。
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
  // 常见功能点（docs 历史上常用）
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

/** 剥离已知节点前缀（SYS_/MOD_/SUB_/PAGE_ 等）；仅前缀本身视为空词元 */
function stripKnownPrefix(value: string): { stripped: string; empty: boolean } {
  const upper = value.toUpperCase();
  for (const prefix of KNOWN_PREFIXES) {
    if (upper === prefix) return { stripped: '', empty: true };
    if (upper.startsWith(prefix + '_')) return { stripped: value.slice(prefix.length + 1), empty: false };
  }
  return { stripped: value, empty: false };
}

/** 中文/ASCII 标签 → 大写 token；无法完全映射返回 null（回退短哈希） */
function labelToToken(value: string): string | null {
  const frozen = tryFrozenToken(value);
  if (frozen) return frozen;
  let out = '';
  for (const ch of value) {
    if (/[一-鿿]/.test(ch)) {
      const initial = CJK_INITIALS[ch];
      if (!initial) return null;
      out += initial;
    } else if (/[A-Za-z0-9]/.test(ch)) {
      out += ch.toUpperCase();
    } else {
      return null;
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * 将任意节点 id 收敛为「单段 token」（不含 '_'）：
 * - 空值 → 'X'（保证 base 至少一段）；
 * - 金标准冻结词条（如"检查室"→JCX）精确匹配优先；
 * - 普通语义 id（sys_qyyx）→ 去前缀取首段大写（QYYX）；
 * - 中文 id / 标签 → 逐字拼音首字母（企业营销→QYYX）；
 * - UUID / 路径 / 多词元 id / 未知汉字 → shortHash 单段。
 */
export function toAbbrToken(id: string): string {
  if (!id) return 'X';
  const frozen = tryFrozenToken(id);
  if (frozen) return frozen;
  const { stripped, empty } = stripKnownPrefix(id);
  if (empty) return shortHash(id);
  if (/^[A-Za-z0-9]+$/.test(stripped)) return stripped.toUpperCase();
  if (/[一-鿿]/.test(stripped)) {
    const initials = labelToToken(stripped);
    if (initials) return initials;
  }
  return shortHash(id);
}

/** 清洗标签：去掉英文括号注释，保留中文主名（"首页 (Index / Dashboard)" → "首页"） */
function normalizeLabel(text: string): string {
  return (text ?? '')
    .replace(/\s*[（(][^)）]*[)）]\s*/g, '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .trim();
}

/**
 * 有中文/语义标签时优先用标签派生缩写（先冻结词条→再拼音首字母 → 金标准 QYYX_PZ_JCX 风格），否则回退 id 派生。
 * 标签先清洗括号注释（"首页 (Index / Dashboard)" → "首页"→SY），保证缩写基于中文主名而非英文注释/hash。
 */
export function toAbbrTokenWithLabel(id: string, label: string | undefined): string {
  const text = normalizeLabel(label ?? '');
  if (text) {
    const frozen = tryFrozenToken(text);
    if (frozen) return frozen;
    if (/^[A-Za-z0-9]+$/.test(text)) return text.toUpperCase();
    if (/[一-鿿]/.test(text)) {
      const initials = labelToToken(text);
      if (initials) return initials;
    }
  }
  return toAbbrToken(id);
}

/** UUID 形态（8-4-4-4-12，含 '-'）：无业务语义，不能用其哈希充当系统缩写 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 系统缩写：subsystemId 语义 id 优先；UUID/空时用系统名称中文兜底。
 * 修复：真实系统 subsystemId 常为随机 UUID（如 ruoyi），若直接 toAbbrToken 会退化为
 * 6 位十六进制哈希（026DCD），丧失"系统缩写=系统名"的可读性 → UUID 一律回退系统名。
 */
export function systemAbbrFromSubsystemId(subsystemId: string | undefined, systemName: string | undefined): string {
  if (subsystemId && subsystemId.trim() && !UUID_RE.test(subsystemId.trim())) {
    return toAbbrToken(subsystemId.trim());
  }
  return systemName ? toAbbrToken(systemName.trim()) : 'X';
}
