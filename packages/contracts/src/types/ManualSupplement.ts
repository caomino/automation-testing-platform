/**
 * @file ManualSupplement.ts
 * @description 人工补录数据类型 — 探索阶段人工补充
 * @contract ExploreInput.manualSupplement
 * @frozen v1.0（v1.1 追加**可选**字段 `kind`/`parentMenu`/`menuUrl`，向后兼容，未改动既有字段语义）
 */

/** 人工点击路径记录 */
export interface ClickPath {
  /** 点击序列 */
  steps: ClickStep[];
  /** 归属模块（自动推断或人工选择） */
  inferredModule: string;
  /** 置信度（0-1） */
  confidence: number;
  /**
   * v1.1 新增（可选）：该菜单页自身 URL（与 steps 内按钮的 url 区分开）
   * @since 2026-09-21 「人工补充最小颗粒度到按钮/功能」需求
   */
  menuUrl?: string;
}

/** 单次点击步骤 */
export interface ClickStep {
  /** 点击元素的 CSS selector 或文字描述 */
  selector: string;
  /** 元素可见文字 */
  text: string;
  /** 页面 URL */
  url: string;
  /** 时间戳 */
  timestamp: number;
  /**
   * v1.1 新增（可选）：本次点击的类别
   * - `menu`   = 导航菜单项（决定「归属哪个菜单」）
   * - `action` = 页面内按钮/功能（人工补充的**最小颗粒度**，入树为 `type='action'`）
   */
  kind?: 'menu' | 'action';
  /** v1.1 新增（可选）：`kind='action'` 时，该按钮/功能**归属的菜单名** */
  parentMenu?: string;
}

/** 人工补充数据（v1.5：两段式 — 弹窗录制 → 待入树列表 → 选中行入树） */
export interface ManualSupplement {
  /** 人工点击路径 */
  clickPath: ClickPath[];
  /** 插入位置 */
  insertPosition: 'above' | 'below' | 'end';
  /** 相对于哪个节点插入（end 时为 null） */
  relativeToNodeId: string | null;
}
