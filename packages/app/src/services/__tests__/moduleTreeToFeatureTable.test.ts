import { describe, it, expect } from 'vitest';
import type { ModuleNodeView } from '../../context';
import { moduleTreeToFeatureTable } from '../pipeline';

function node(partial: Partial<ModuleNodeView> & { id: string; name: string }): ModuleNodeView {
  return {
    id: partial.id,
    name: partial.name,
    type: partial.type ?? 'module',
    children: partial.children,
  } as ModuleNodeView;
}

// 简写：把 4 段 id 拆成段方便验证维度
const seg = (id: string) => id.split('_');

describe('moduleTreeToFeatureTable', () => {
  it('按钮级 action 叶子生成九列功能表，测试点标识符合 docs §5.3（4段 base_NN，中文 label→拼音首字母大写）', () => {
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
    // base 三段：
    //   SYS = 超声系统 → CSXT
    //   MAIN = 检查室管理 → JCSGL
    //   SUB = 检查室列表 → JCSLB
    // 子系统内 NN 连续：01/02/03
    expect(rows.map((r) => r.testPointId)).toEqual([
      'CSXT_JCSGL_JCSLB_01',
      'CSXT_JCSGL_JCSLB_02',
      'CSXT_JCSGL_JCSLB_03',
    ]);
    expect(rows[0]).toEqual(expect.objectContaining({
      seq: '1',
      type: '功能性测试',
      chapter: '',
      system: '超声系统',
      mainModule: '检查室管理',
      subModule: '检查室列表',
      feature: '检查室列表',
      testPoint: '新增',
    }));
    expect(seg(rows[0].testPointId)).toHaveLength(4);
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

  it('action 直接挂在 module 下时：子模块空，base 子段用主模块名回退（SUB 仍从主模块名派生，不会全空）', () => {
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
    // 用户规则：子模块没有就空着（subModule=''）→ base 第三段用 X 占位：X_BB_X_01
    expect(rows[0].testPointId).toBe('X_BB_X_01');
  });

  it('跨多个 page：每个 page（子模块）维度 NN 各自从 01 起（docs §5.3 硬性要求）', () => {
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
    // S_M_P1 分组 NN=01；S_M_P2 分组 NN 归 01/02（不是 02/03 全局递增）
    expect(rows.map((r) => r.testPointId)).toEqual([
      'S_M_P1_01',
      'S_M_P2_01',
      'S_M_P2_02',
    ]);
    expect(rows[0].subModule).toBe('P1');
    expect(rows[2].subModule).toBe('P2');
  });
});
