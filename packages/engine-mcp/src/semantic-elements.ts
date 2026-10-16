/**
 * @file semantic-elements.ts
 * @description SemanticNode[] → ExploredElement[] 的共享转换（direct 引擎与 mcp 适配器共用，
 *              保证两条引擎链路的元素语义完全一致）
 */
import type { SemanticNode, ExploredElement } from './types.js';

function inferAction(tag: string, node: SemanticNode): 'click' | 'fill' | 'select' | 'navigate' {
  if (!node.interactive) return 'navigate';
  if (tag === 'button') return 'click';
  if (tag === 'a') return 'navigate';
  if (tag === 'select') return 'select';
  if (tag === 'input' || tag === 'textarea' || tag === 'form') return 'fill';
  return 'click';
}

export function isFormNodeSafe(node: SemanticNode): boolean {
  return ['INPUT', 'SELECT', 'TEXTAREA', 'FORM'].includes(node.tag);
}

export function toExploredElement(node: SemanticNode): ExploredElement {
  const tag = node.tag.toLowerCase();
  const isFormControl = ['input', 'select', 'textarea', 'form'].includes(tag) && !node.isSelectionControl;
  const suggestedAction = inferAction(tag, node);
  const label = node.ariaLabel || node.placeholder || node.labelFor || node.name;

  const el: ExploredElement & { role?: string; ariaHasPopup?: string; safeReadOnlyOpener?: boolean } = {
    ref: node.selector,
    tag,
    text: node.text,
    selector: node.selector,
    interactive: node.interactive,
    label,
    inputType: node.type,
    href: node.href,
    isFormControl,
    suggestedAction,
    role: node.role,
    ariaHasPopup: node.ariaHasPopup,
    safeReadOnlyOpener: node.safeReadOnlyOpener,
  };
  if (node.required !== undefined) el.required = node.required;
  if (node.minLength !== undefined) el.minLength = node.minLength;
  if (node.maxLength !== undefined) el.maxLength = node.maxLength;
  if (node.minimum !== undefined) el.minimum = node.minimum;
  if (node.maximum !== undefined) el.maximum = node.maximum;
  if (node.pattern !== undefined) el.pattern = node.pattern;
  if (node.options !== undefined) el.options = node.options;
  if (node.multiple !== undefined) el.multiple = node.multiple;
  if (node.readonly !== undefined) el.readonly = node.readonly;
  if (node.disabled !== undefined) el.disabled = node.disabled;
  if (node.checked !== undefined) el.checked = node.checked;
  if ((tag === 'table' || node.isVirtualList) && (node.columns || node.hasPagination || node.hasSorting || node.hasFilter || node.isVirtualList)) {
    el.tableInfo = {
      columns: node.columns ?? [],
      rowCount: node.rowCount ?? 0,
      hasPagination: !!node.hasPagination,
      paginationInfo: node.paginationInfo,
      hasSorting: !!node.hasSorting,
      sortableColumns: node.sortableColumns,
      hasFilter: !!node.hasFilter,
      filterFields: node.filterFields,
      isVirtualList: node.isVirtualList,
    };
  }
  if (node.containers?.length) el.containers = node.containers;
  if (node.uncovered?.length) el.uncovered = node.uncovered;
  return el;
}

/** DOM_WALK 产出的语义树 → 扁平可消费元素列表（与 direct 引擎 extractPageElements 完全一致） */
export function semanticNodesToElements(nodes: SemanticNode[]): ExploredElement[] {
  const elements: ExploredElement[] = [];
  const walk = (list: SemanticNode[]): void => {
    for (const node of list) {
      const tag = node.tag.toLowerCase();
      if (node.interactive || isFormNodeSafe(node) || tag === 'table' || node.isVirtualList || node.containers?.length || node.uncovered?.length) {
        elements.push(toExploredElement(node));
      }
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(nodes);
  return elements;
}
