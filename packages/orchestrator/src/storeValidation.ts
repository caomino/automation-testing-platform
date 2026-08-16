/**
 * @file storeValidation.ts
 * @description 后端 Store 路由的入参校验（纯函数，便于单测）。
 *
 *   背景：infra-store 的 createProject 不对 name 做非空校验，导致：
 *     - 空名 ''  → 直接写库，返回 201（脏数据）
 *     - 缺 name  → store 抛错，HTTP 层兜底成 500 且无 error 字段，前端只能显示「HTTP 500」
 *   把校验抽到这里，HTTP 层可对非法入参直接返回 400 + 可读 error。
 */

export interface ValidatedProject {
  name: string;
  description: string;
  type: string;
}

export type NewProjectValidation =
  | { ok: true; value: ValidatedProject }
  | { ok: false; error: string };

/**
 * 校验「新增项目」入参。
 * @returns ok:false 时 error 为面向调用方的可读中文提示（对应 HTTP 400）。
 */
export function validateNewProject(body: unknown): NewProjectValidation {
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }

  const record = body as Record<string, unknown>;
  const rawName = record.name;
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) {
    return { ok: false, error: '项目名称不能为空' };
  }

  const rawType = record.type;
  const type = typeof rawType === 'string' && rawType.trim() ? rawType.trim() : 'standalone';

  const rawDesc = record.description;
  const description = typeof rawDesc === 'string' ? rawDesc : '';

  return { ok: true, value: { name, description, type } };
}
