/**
 * @file snapshot-converter.ts
 * @description browser_snapshot → SemanticNode 转换工具
 * @frozen v1.0
 */
import type { SemanticNode, McpSnapshotEntry } from './types.js';

/** 从 browser_snapshot 文本解析条目 */
export function parseSnapshotEntries(snapshotText: string): McpSnapshotEntry[] {
  const entries: McpSnapshotEntry[] = [];
  const lines = snapshotText.split('\n').filter(l => l.trim());

  for (const line of lines) {
    const entry = parseLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseLine(line: string): McpSnapshotEntry | null {
  // 格式: button "Submit" [ref=e15] 或 input "用户名" [ref=e16]
  const refMatch = line.match(/\[ref=([^\]]+)\]/);
  if (!refMatch) return null;

  const ref = refMatch[1];
  const withoutRef = line.replace(/\s*\[ref=[^\]]+\]/, '').trim();

  // 提取元素类型（第一个词）
  const parts = withoutRef.split(/\s+/);
  const elementType = parts[0] || 'element';

  // 提取描述（引号内的内容）
  const descMatch = withoutRef.match(/"([^"]*)"|'([^']*)'/);
  const description = descMatch ? (descMatch[1] || descMatch[2] || '') : withoutRef.substring(elementType.length).trim();

  const interactive = isInteractiveElement(elementType);

  return {
    ref,
    description,
    interactive,
    element: elementType,
  };
}

function isInteractiveElement(element: string): boolean {
  const interactiveSet = new Set([
    'button', 'a', 'input', 'select', 'option', 'textarea',
    'checkbox', 'radio', 'switch', 'link', 'menuitem',
    'tab', 'treeitem', 'combobox', 'listbox', 'searchbox',
    'spinbutton', 'slider', 'scrollbar',
  ]);
  return interactiveSet.has(element.toLowerCase());
}

/** 将 McpSnapshotEntry 列表转换为 SemanticNode[] */
export function convertEntriesToSemanticNodes(entries: McpSnapshotEntry[]): SemanticNode[] {
  return entries.map(entry => {
    const tag = mapToHtmlTag(entry.element || entry.description);
    const isDataControl = ['input', 'textarea', 'select', 'checkbox', 'radio'].includes(tag);

    return {
      tag,
      text: entry.description || undefined,
      selector: `[data-ref="${entry.ref}"]`,
      interactive: entry.interactive,
      isDataControl,
      children: [],
      role: mapToRole(entry.element),
      name: entry.description || undefined,
    };
  });
}

function mapToHtmlTag(element: string): string {
  const map: Record<string, string> = {
    'button': 'button',
    'a': 'a',
    'link': 'a',
    'input': 'input',
    'checkbox': 'input',
    'radio': 'input',
    'switch': 'button',
    'select': 'select',
    'option': 'option',
    'textarea': 'textarea',
    'combobox': 'select',
    'listbox': 'select',
    'searchbox': 'input',
    'spinbutton': 'input',
    'slider': 'input',
    'menuitem': 'li',
    'tab': 'div',
    'treeitem': 'li',
    'heading': 'h1',
    'article': 'article',
    'section': 'section',
    'dialog': 'div',
    'alert': 'div',
    'banner': 'div',
    'form': 'form',
    'navigation': 'nav',
    'region': 'div',
    'textbox': 'input',
    'image': 'img',
    'icon': 'span',
    'paragraph': 'p',
    'list': 'ul',
    'listitem': 'li',
    'table': 'table',
    'cell': 'td',
    'row': 'tr',
    'grid': 'table',
    'gridcell': 'td',
  };
  return map[element.toLowerCase()] || 'div';
}

function mapToRole(element?: string): string | undefined {
  if (!element) return undefined;
  const map: Record<string, string> = {
    'button': 'button',
    'link': 'link',
    'checkbox': 'checkbox',
    'radio': 'radio',
    'switch': 'switch',
    'menuitem': 'menuitem',
    'tab': 'tab',
    'treeitem': 'treeitem',
    'heading': 'heading',
    'article': 'article',
    'form': 'form',
    'navigation': 'navigation',
    'region': 'region',
    'dialog': 'dialog',
    'alert': 'alert',
    'banner': 'banner',
    'grid': 'grid',
    'table': 'table',
    'list': 'list',
    'listitem': 'listitem',
  };
  return map[element.toLowerCase()];
}

/** 从快照文本直接转换为 SemanticNode[] */
export function snapshotToSemanticNodes(snapshotText: string): SemanticNode[] {
  const entries = parseSnapshotEntries(snapshotText);
  return convertEntriesToSemanticNodes(entries);
}

/** 从快照文本提取指定类型的节点 */
export function findNodesByTag(snapshotText: string, tags: string[]): SemanticNode[] {
  const nodes = snapshotToSemanticNodes(snapshotText);
  return nodes.filter(n => tags.includes(n.tag));
}

/** 从快照文本提取交互元素 */
export function findInteractiveNodes(snapshotText: string): SemanticNode[] {
  const nodes = snapshotToSemanticNodes(snapshotText);
  return nodes.filter(n => n.interactive);
}
