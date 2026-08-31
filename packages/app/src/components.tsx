
import type { CSSProperties, ReactNode, ChangeEvent, MouseEvent, DragEvent } from "react";
import { useState } from "react";

/* ===== 按钮 ===== */
export function Button({
  children,
  onClick,
  variant,
  size,
  title,
  className,
  disabled,
  type,
  style,
}: {
  children: ReactNode;
  key?: any;
  onClick?: (e?: MouseEvent) => void;
  variant?: "pri" | "ghost" | "dng";
  size?: "sm";
  title?: string;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  style?: CSSProperties;
}) {
  const cls = ["btn", variant, size, className].filter(Boolean).join(" ");
  return (
    <button type={type ?? "button"} className={cls} onClick={onClick} title={title} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

/* ===== 卡片 ===== */
export function Card({
  title,
  children,
  style,
  titleStyle,
}: {
  title?: ReactNode;
  key?: any;
  children: ReactNode;
  style?: CSSProperties;
  titleStyle?: CSSProperties;
}) {
  return (
    <div className="card" style={style}>
      {title != null && <h4 style={titleStyle}>{title}</h4>}
      {children}
    </div>
  );
}

/* ===== 标签 ===== */
export function Tag({
  children,
  tone,
  title,
  style,
}: {
  children: ReactNode;
  key?: any;
  tone?: "ok" | "warn" | "danger" | "info" | "gray" | "review";
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`tag ${tone ?? ""}`.trim()} title={title} style={style}>
      {children}
    </span>
  );
}

/* ===== 统计卡 ===== */
export function StatCard({ label, value, detail, valueStyle }: { label: string; value: ReactNode; detail?: ReactNode; valueStyle?: CSSProperties }) {
  return (
    <div className="card stat">
      <div className="v" style={valueStyle}>{value}</div>
      <div className="l">{label}</div>
      {detail != null && <div className="d">{detail}</div>}
    </div>
  );
}

/* ===== 表格 ===== */
export interface Col<T = string> {
  key: string;
  title: ReactNode;
  width?: number;
  mono?: boolean;
  merge?: boolean;
  editable?: boolean;
  render?: (row: T, index: number) => ReactNode;
}
export function Table<T extends Record<string, any>>({
  columns,
  rows,
  rowKey,
  onRowAction,
  editable,
  selectable,
  selectedRows,
  onSelectRow,
}: {
  columns: Col<T>[];
  rows: T[];
  rowKey?: (row: T, i: number) => string;
  onRowAction?: (row: T, index: number, action: "add" | "remove" | "edit", value?: string) => void;
  editable?: boolean;
  selectable?: boolean;
  selectedRows?: Set<number>;
  onSelectRow?: (index: number, _checked: boolean) => void;
}) {
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (row: T, i: number, col: Col<T>) => {
    setEditingCell({ rowIndex: i, colKey: col.key });
    setEditValue(String(row[col.key] ?? ''));
  };

  const commitEdit = (row: T, i: number, colKey: string) => {
    if (editingCell && editingCell.rowIndex === i && editingCell.colKey === colKey) {
      onRowAction?.(row, i, "edit", editValue);
      setEditingCell(null);
      setEditValue('');
    }
  };

  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            {selectable && <th style={{ width: 32 }}></th>}
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.title}</th>
            ))}
            {onRowAction && <th style={{ width: 100 }}>操作</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : i}>
              {selectable && (
                <td>
                  <input
                    type="checkbox"
                    checked={selectedRows?.has(i) ?? false}
                    onChange={(e) => onSelectRow?.(i, (e.target as HTMLInputElement).checked)}
                  />
                </td>
              )}
              {columns.map((c) => {
                const cell = c.render ? c.render(r, i) : r[c.key];
                const isEditing = editable && c.editable && editingCell?.rowIndex === i && editingCell?.colKey === c.key;
                return (
                  <td
                    key={c.key}
                    className={[c.mono ? "mono" : "", c.merge ? "merge" : ""].filter(Boolean).join(" ") || undefined}
                    onDoubleClick={() => { if (editable && c.editable) startEdit(r, i, c); }}
                  >
                    {isEditing ? (
                      <input
                        className="cell-edit"
                        value={editValue}
                        autoFocus
                        onChange={(e) => setEditValue((e.target as HTMLInputElement).value)}
                        onBlur={() => commitEdit(r, i, c.key)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(r, i, c.key);
                          if (e.key === 'Escape') { setEditingCell(null); setEditValue(''); }
                        }}
                      />
                    ) : (
                      cell
                    )}
                  </td>
                );
              })}
              {onRowAction && (
                <td className="row-actions">
                  <button className="btn ghost sm" onClick={() => onRowAction(r, i, "add")} title="在下方插入">+</button>
                  <button className="btn ghost sm" onClick={() => onRowAction(r, i, "remove")} title="删除">×</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ===== 表单字段 ===== */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint != null && <div className="hint">{hint}</div>}
    </div>
  );
}

/* ===== 开关 ===== */
export function Toggle({ on, onChange, label }: { on: boolean; onChange?: (v: boolean) => void; label?: ReactNode }) {
  return (
    <div className={`toggle ${on ? "on" : ""}`.trim()} onClick={() => onChange?.(!on)}>
      <div className="sw" />
      {label != null && <span>{label}</span>}
    </div>
  );
}

/* ===== 弹窗 ===== */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="mask on">
      <div className={`modal ${wide ? "wide" : ""}`.trim()}>
        <div className="hd">
          <h3>{title}</h3>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <div className="bd">{children}</div>
        {footer != null && <div className="ft">{footer}</div>}
      </div>
    </div>
  );
}

/* ===== 确认弹窗 ===== */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  danger,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? "确认操作"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant={danger ? "dng" : "pri"} onClick={onConfirm}>{confirmText ?? "确认"}</Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

/* ===== 顶部状态条 ===== */
export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="pill">
      <span className="d" />
      {children}
    </span>
  );
}

/* ===== 面包屑 chip ===== */
export function Crumb({ children, active, code }: { children: ReactNode; active?: boolean; code?: string }) {
  return (
    <span className={`crumb-chip ${active ? "active" : ""}`.trim()}>
      {children}
      {code != null && <code>{code}</code>}
    </span>
  );
}

/* ===== 搜索选择器 ===== */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  multiple,
  selected,
  onSelectedChange,
}: {
  value?: string;
  onChange?: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  multiple?: boolean;
  selected?: string[];
  onSelectedChange?: (sel: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  if (multiple) {
    const sel = selected ?? [];
    return (
      <div className={`searchable-select ${open ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="ss-display" onClick={() => setOpen(!open)}>
          {sel.length === 0 ? (
            <span className="ss-placeholder">{placeholder ?? "请选择"}</span>
          ) : (
            sel.map((s) => {
              const opt = options.find((o) => o.value === s);
              return <Tag key={s} tone="info">{opt?.label ?? s}</Tag>;
            })
          )}
          <span className="ss-arrow">▾</span>
        </div>
        {open && (
          <div className="ss-dropdown">
            <input
              className="ss-search"
              placeholder="搜索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="ss-options">
              {filtered.map((o) => (
                <div
                  key={o.value}
                  className={`ss-option ${sel.includes(o.value) ? "selected" : ""}`}
                  onClick={() => {
                    if (sel.includes(o.value)) {
                      onSelectedChange?.(sel.filter((s) => s !== o.value));
                    } else {
                      onSelectedChange?.([...sel, o.value]);
                    }
                  }}
                >
                  <input type="checkbox" readOnly checked={sel.includes(o.value)} />
                  {o.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`searchable-select ${open ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
      <div className="ss-display" onClick={() => setOpen(!open)}>
        {value ? (
          <span>{options.find((o) => o.value === value)?.label ?? value}</span>
        ) : (
          <span className="ss-placeholder">{placeholder ?? "请选择"}</span>
        )}
        <span className="ss-arrow">▾</span>
      </div>
      {open && (
        <div className="ss-dropdown">
          <input
            className="ss-search"
            placeholder="搜索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="ss-options">
            {filtered.map((o) => (
              <div
                key={o.value}
                className={`ss-option ${value === o.value ? "selected" : ""}`}
                onClick={() => {
                  onChange?.(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== Lightbox ===== */
export function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  if (!src) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt={alt ?? ""} onClick={(e) => e.stopPropagation()} />
      <button className="lb-close" onClick={onClose}>✕</button>
    </div>
  );
}

/* ===== 模块树节点 ===== */
export interface TreeItem {
  id: string;
  label: ReactNode;
  children?: TreeItem[];
  tags?: ReactNode;
  checked?: boolean;
  onToggle?: (id: string, checked: boolean) => void;
  onNodeClick?: (id: string) => void;
  selected?: boolean;
  draggable?: boolean;
  onDragStart?: (id: string) => void;
  onDragOver?: (e: DragEvent, id: string) => void;
  onDrop?: (targetId: string, position: 'before' | 'after' | 'child') => void;
  dragPosition?: 'before' | 'after' | 'child' | null;
  expanded?: boolean;
  onToggleExpand?: (id: string) => void;
}

export function TreeNode({ item, depth = 0 }: { item: TreeItem; depth?: number; key?: any }) {
  const hasChildren = item.children && item.children.length > 0;
  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
    item.onDragStart?.(item.id);
  };
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    item.onDragOver?.(e, item.id);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const position = item.dragPosition || 'after';
    item.onDrop?.(item.id, position);
  };
  const dragClass = item.draggable ? 'draggable' : '';
  const dropClass = item.dragPosition ? `drop-${item.dragPosition}` : '';
  const expanded = item.expanded ?? true; // 默认展开
  
  return (
    <li>
      <div
        className={`node ${item.selected ? "sel" : ""} ${dragClass} ${dropClass}`.trim()}
        draggable={item.draggable}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {hasChildren ? (
          <span 
            className={`expand-toggle ${expanded ? "expanded" : "collapsed"}`}
            onClick={(e) => {
              e.stopPropagation();
              item.onToggleExpand?.(item.id);
            }}
          >
            {expanded ? '▼' : '▶'}
          </span>
        ) : (
          <span className="expand-placeholder"></span>
        )}
        {item.onToggle && (
          <input
            type="checkbox"
            className="ck"
            checked={item.checked ?? false}
            onChange={(e) => item.onToggle?.(item.id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <span className="node-label" onClick={() => item.onNodeClick?.(item.id)}>{item.label}</span>
        {item.tags}
      </div>
      {hasChildren && expanded && (
        <ul>
          {item.children!.map((c) => (
            <TreeNode key={c.id} item={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Tree({ root, items, onMultiToggle, checkedIds, onDropNode }: { root: ReactNode; items: TreeItem[]; onMultiToggle?: (id: string, checked: boolean) => void; checkedIds?: string[]; onDropNode?: (sourceId: string, targetId: string, position: 'before' | 'after' | 'child') => void }) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<'before' | 'after' | 'child' | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // 收集所有节点 ID 用于展开/折叠全部
  const collectAllIds = (list: TreeItem[]): string[] => {
    const ids: string[] = [];
    for (const it of list) {
      if (it.children && it.children.length > 0) {
        ids.push(it.id);
        ids.push(...collectAllIds(it.children));
      }
    }
    return ids;
  };

  const toggleExpand = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    setCollapsedIds(new Set());
  };

  const collapseAll = () => {
    const allIds = collectAllIds(items);
    setCollapsedIds(new Set(allIds));
  };

  const enrichItems = (list: TreeItem[]): TreeItem[] =>
    list.map((it) => {
      const hasChildren = it.children && it.children.length > 0;
      const isExpanded = hasChildren 
        ? !collapsedIds.has(it.id) // 默认展开，只有在 collapsedIds 中才折叠
        : false;
      return {
        ...it,
        checked: checkedIds ? checkedIds.includes(it.id) : it.checked,
        onToggle: onMultiToggle ? (id: string, c: boolean) => onMultiToggle(id, c) : it.onToggle,
        draggable: !!onDropNode,
        onDragStart: (id: string) => setDraggingId(id),
        onDragOver: (e: DragEvent, id: string) => {
          setDragOverId(id);
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          const h = rect.height;
          let pos: 'before' | 'after' | 'child';
          if (y < h * 0.25) pos = 'before';
          else if (y > h * 0.75) pos = 'after';
          else pos = 'child';
          setDragPosition(pos);
        },
        onDrop: (targetId: string, position: 'before' | 'after' | 'child') => {
          if (draggingId && onDropNode && draggingId !== targetId) {
            onDropNode(draggingId, targetId, position);
          }
          setDraggingId(null);
          setDragOverId(null);
          setDragPosition(null);
        },
        dragPosition: dragOverId === it.id ? dragPosition : null,
        expanded: isExpanded,
        onToggleExpand: hasChildren ? toggleExpand : undefined,
        children: it.children ? enrichItems(it.children) : undefined,
      };
    });

  const enriched = enrichItems(items);

  return (
    <div className="tree">
      <div className="tree-toolbar">
        <div className="root">{root}</div>
        <div className="tree-actions">
          <button className="tree-btn" onClick={expandAll} title="展开全部">▼</button>
          <button className="tree-btn" onClick={collapseAll} title="折叠全部">▶</button>
        </div>
      </div>
      <ul>
        {enriched.map((it) => (
          <TreeNode key={it.id} item={it} />
        ))}
      </ul>
    </div>
  );
}

/* ===== 文本输入 ===== */
export function TextInput({
  value,
  onChange,
  placeholder,
  className,
  type,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  type?: string;
}) {
  return (
    <input
      type={type ?? "text"}
      className={`text-input ${className ?? ""}`.trim()}
      value={value}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

/* ===== 文本域 ===== */
export function TextArea({
  value,
  onChange,
  placeholder,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className="text-area"
      value={value}
      placeholder={placeholder}
      rows={rows ?? 3}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
    />
  );
}

/* ===== 文件上传 ===== */
export function FileUpload({
  onFile,
  accept,
  multiple,
  children,
}: {
  onFile: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  children?: ReactNode;
}) {
  const id = `fu-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <>
      <label htmlFor={id} className="file-upload">
        {children ?? "选择文件"}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: "none" }}
        onChange={(e) => { const files = Array.from(e.target.files ?? []) as unknown as File[];
          if (files.length > 0) onFile(files);
        }}
      />
    </>
  );
}
