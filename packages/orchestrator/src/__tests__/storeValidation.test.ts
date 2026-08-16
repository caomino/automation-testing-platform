import { describe, it, expect } from 'vitest';
import { validateNewProject } from '../storeValidation';

describe('validateNewProject', () => {
  it('空字符串名称应被拒绝', () => {
    const r = validateNewProject({ name: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('项目名称');
  });

  it('纯空白名称应被拒绝', () => {
    const r = validateNewProject({ name: '   ' });
    expect(r.ok).toBe(false);
  });

  it('缺省名称应被拒绝', () => {
    const r = validateNewProject({});
    expect(r.ok).toBe(false);
  });

  it('非对象请求体应被拒绝', () => {
    expect(validateNewProject(null).ok).toBe(false);
    expect(validateNewProject('name=x').ok).toBe(false);
  });

  it('合法名称应返回标准化结果（含默认 type）', () => {
    const r = validateNewProject({ name: '  My Project  ', type: 'portal' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('My Project');
      expect(r.value.type).toBe('portal');
    }
  });

  it('缺省 type 应回退 standalone', () => {
    const r = validateNewProject({ name: 'P1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe('standalone');
  });

  it('description 缺省应为空串', () => {
    const r = validateNewProject({ name: 'P1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe('');
  });
});
