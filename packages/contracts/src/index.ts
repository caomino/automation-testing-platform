/**
 * @file index.ts
 * @description contracts 统一导出（冻结 v1.0）
 * @contract 所有 stage I/O 契约、类型与校验
 * @frozen v1.0 — 契约层接口冻结，不可修改
 */
export * from './types/SystemConfig';
export * from './types/ModuleNode';
export * from './types/ManualSupplement';
export * from './types/FeatureRow';
export * from './types/CaseRow';
export * from './types/CaseSheet';
export * from './types/shared';
export * from './types/TestDesign';

export * from './stages/LoginContract';
export * from './stages/ExploreContract';
export * from './stages/FeatureContract';
export * from './stages/CaseContract';
export * from './stages/ExecuteContract';
export * from './stages/DefectContract';

export * from './schemas/LoginSchema';
export * from './schemas/ExploreSchema';
export * from './schemas/FeatureSchema';
export * from './schemas/CaseSchema';
export * from './schemas/ExecuteSchema';
export * from './schemas/DefectSchema';
export * from './schemas/TestDesignSchema';

export * from './constants/ErrorCodes';

export * as mock from './mock/index';
