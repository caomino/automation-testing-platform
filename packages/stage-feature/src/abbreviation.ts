import { pinyin } from 'pinyin-pro';

/**
 * @file abbreviation.ts
 * @description 测试点标识缩写派生（基于 pinyin-pro 动态生成，零硬编码）
 *
 * base = 系统缩写_父目录缩写_子系统缩写（严格 3 段），由模块树节点 id/标签 动态派生。
 * 核心不变量：每个分量（toAbbrToken 的返回值）恒为「单段 token」（不含 '_'）。
 */

/** 已知节点 id 前缀（派生缩写时剥离，避免 SYS_/MOD_ 等噪声） */
const KNOWN_PREFIXES = new Set([
  'SYS', 'SYSTEM', 'MOD', 'MODULE', 'PAGE', 'SUB', 'SUBSYSTEM',
  'ACT', 'ACTION', 'NODE', 'N', 'ROOT',
]);

/** 确定性短哈希：6 位大写十六进制，保证任意多段/无词元 id 收敛为单段 token */
export function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) >>> 0;
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(6, '0').slice(-6);
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
 * 将任意节点 id 收敛为「单段 token」（不含 '_'）：
 * - 空值 → 'X'
 * - 普通纯字母数字 id（如 sys_qyyx）→ 去前缀取首段大写（QYYX）
 * - 中文 id / 标签 → 通过 pinyin-pro 动态提取拼音首字母大写
 * - UUID / 路径 / 无法提取词元 → shortHash 单段
 */
export function toAbbrToken(id: string): string {
  if (!id) return 'X';
  const { stripped, empty } = stripKnownPrefix(id);
  if (empty) return shortHash(id);
  if (/^[A-Za-z0-9]+$/.test(stripped)) return stripped.toUpperCase();
  
  const initials = getInitials(stripped);
  if (initials) return initials;
  return shortHash(id);
}

/** 清洗标签：去掉英文/中文括号注释，保留主名（"首页 (Index / Dashboard)" → "首页"） */
function normalizeLabel(text: string): string {
  return (text ?? '')
    .replace(/\s*[（(][^)）]*[)）]\s*/g, '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .trim();
}

/**
 * 有语义标签时优先用标签动态派生拼音缩写，否则回退 id 派生
 */
export function toAbbrTokenWithLabel(id: string, label: string | undefined): string {
  const text = normalizeLabel(label ?? '');
  if (text) {
    if (/^[A-Za-z0-9]+$/.test(text)) return text.toUpperCase();
    const initials = getInitials(text);
    if (initials) return initials;
  }
  return toAbbrToken(id);
}

/** UUID 形态（8-4-4-4-12，含 '-'）：无业务语义，不能用其哈希充当系统缩写 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 系统缩写：subsystemId 语义 id 优先；UUID/空时用系统名称中文动态派生。
 */
export function systemAbbrFromSubsystemId(subsystemId: string | undefined, systemName: string | undefined): string {
  if (subsystemId && subsystemId.trim() && !UUID_RE.test(subsystemId.trim())) {
    return toAbbrToken(subsystemId.trim());
  }
  return systemName ? toAbbrToken(systemName.trim()) : 'X';
}

