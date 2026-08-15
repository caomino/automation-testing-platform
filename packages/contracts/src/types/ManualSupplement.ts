/**
 * @file ManualSupplement.ts
 * @description 人工补录数据类型 — 探索阶段人工补充
 * @contract ExploreInput.manualSupplement
 * @frozen v1.0
 */

/** 人工点击路径记录 */
export interface ClickPath {
  /** 点击序列 */
  steps: ClickStep[];
  /** 归属模块（自动推断或人工选择） */
  inferredModule: string;
  /** 置信度（0-1） */
  confidence: number;
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
