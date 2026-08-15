/**
 * @file CaseSheet.ts
 * @description 用例表头 + 用例工作表类型
 * @contract CaseOutput.caseWorkbook / metaHeader
 * @frozen v1.0
 */
import type { CaseRow } from './CaseRow';

/** 测试用例表头（Excel 顶部可编辑行，对应金标准 R4-R12） */
export interface MetaHeader {
  /** 系统名称（如"区域影像系统"） */
  systemName: string;
  /** 测试点标识（3 段 base，如"QYYX_PZ_JCX"） */
  testPointId: string;
  /** 测试点/功能点（如"检查室"） */
  testPoint: string;
  /** 测试人员 */
  testers: string;
  /** 委托单位人员 */
  clientStaff: string;
  /** 开发单位人员 */
  developerStaff: string;
  /** 初次测试时间 */
  firstTestDate: string;
  /** 回归测试时间 */
  regressionDate: string;
  /** 测试结论判定规则 */
  conclusionRule: string;
  /** 预置条件 */
  precondition: string;
}

/** 用例工作表 — 一个子系统对应一个 Sheet */
export interface CaseSheet {
  /** Sheet 名（取自子系统/测试点名称） */
  sheetName: string;
  /** Meta 头 */
  meta: MetaHeader;
  /** 用例行 */
  rows: CaseRow[];
  /** 软件截图行 */
  screenshotRef?: string;
  /** 原始列宽（round-trip 保真：导入时读原始列宽，导出时还原；新建空表用 CASE_COLUMN_WIDTHS） */
  colWidths?: number[];
  /** 备注/说明行（金标准 R0，如"排班策略，核医学检查项目..."；可为空） */
  remarkRow?: string;
}
