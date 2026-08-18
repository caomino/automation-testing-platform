import { describe, it, expect } from 'vitest';
import type { ModuleNodeView } from '../context';
import { moduleTreeToFeatureTable } from './pipeline';

function node(partial: Partial<ModuleNodeView> & { id: string; name: string }): ModuleNodeView {
  return {
    id: partial.id,
    name: partial.name,
    type: partial.type ?? 'module',
    children: partial.children,
  } as ModuleNodeView;
}

describe('moduleTreeToFeatureTable', () => {
  it('按钮级 action 叶子生成九列功能表：主模块=module / 子模块=page / 功能点=page / 测试点=action', () => {
    const tree: ModuleNodeView[] = [
      node({
        id: 'm1', name: '检查室管理', type: 'module', children: [
          node({
            id: 'p1', name: '检查室列表', type: 'page', children: [
              node({ id: 'a1', name: '新增', type: 'action' }),
              node({ id: 'a2', name: '修改', type: 'action' }),
              node({ id: 'a3', name: '删除', type: 'action' }),
            ],
          }),
        ],
      }),
    ];
    const rows = moduleTreeToFeatureTable(tree, '超声系统');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      seq: '1', type: '功能性测试', chapter: '', system: '超声系统',
      mainModule: '检查室管理', subModule: '检查室列表', feature: '检查室列表',
      testPoint: '新增', testPointId: 'base_01',
    });
    expect(rows[2].testPointId).toBe('base_03');
    expect(rows[2].testPoint).toBe('删除');
  });

  it('仅含目录/页面、无 action 叶子时不产生任何行', () => {
    const tree: ModuleNodeView[] = [
      node({
        id: 'm1', name: '系统设置', type: 'module', children: [
          node({ id: 'p1', name: '参数页', type: 'page' }),
        ],
      }),
    ];
    expect(moduleTreeToFeatureTable(tree, 'X')).toHaveLength(0);
  });

  it('action 直接挂在 module 下时，功能点/子模块回退为 module 标签', () => {
    const tree: ModuleNodeView[] = [
      node({
        id: 'm1', name: '报表', type: 'module', children: [
          node({ id: 'a1', name: '导出', type: 'action' }),
        ],
      }),
    ];
    const rows = moduleTreeToFeatureTable(tree, 'X');
    expect(rows).toHaveLength(1);
    expect(rows[0].mainModule).toBe('报表');
    expect(rows[0].subModule).toBe('');
    expect(rows[0].feature).toBe('报表');
    expect(rows[0].testPoint).toBe('导出');
    expect(rows[0].testPointId).toBe('base_01');
  });

  it('跨多个页面顺序编号 base_NN 连续', () => {
    const tree: ModuleNodeView[] = [
      node({ id: 'm1', name: 'M', type: 'module', children: [
        node({ id: 'p1', name: 'P1', type: 'page', children: [
          node({ id: 'a1', name: 'A1', type: 'action' }),
        ]}),
        node({ id: 'p2', name: 'P2', type: 'page', children: [
          node({ id: 'a2', name: 'A2', type: 'action' }),
          node({ id: 'a3', name: 'A3', type: 'action' }),
        ]}),
      ]}),
    ];
    const rows = moduleTreeToFeatureTable(tree, 'S');
    expect(rows.map((r) => r.testPointId)).toEqual(['base_01', 'base_02', 'base_03']);
    expect(rows[0].subModule).toBe('P1');
    expect(rows[2].subModule).toBe('P2');
  });
});
