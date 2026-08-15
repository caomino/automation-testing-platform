import { Card, Table } from './components';
import { mockCaseRows, mockDefects, mockFeatureTable } from './mock';

const FEATURE_COLS = ['序号', '测试类型', '需求章节', '系统名称', '主模块', '子模块', '功能点', '测试点', '测试点标识'];
const CASE_COLS = ['用例编号', '测试内容', '步骤', '输入及操作说明', '预期结果', '初次结果', '回归结果', '结论'];
const DEFECT_COLS = ['序号', '问题描述', '问题截图', '级别', '质量特性', '产生环境'];

export function Workbench() {
  return (
    <div className="stack">
      <h2>工作台</h2>
      <div className="grid">
        <Card title="功能点"><p>{mockFeatureTable.length} 个</p></Card>
        <Card title="用例"><p>{mockCaseRows.length} 条</p></Card>
        <Card title="缺陷"><p>{mockDefects.length} 个</p></Card>
        <Card title="通过率"><p>—</p></Card>
      </div>
    </div>
  );
}

export function Explore() {
  return (
    <div className="stack">
      <h2>探索</h2>
      <Card title="模块树（示例）">
        <ul className="tree">
          <li>企业营销系统
            <ul>
              <li>配置 / 基础配置</li>
              <li>查询 / 订单查询</li>
            </ul>
          </li>
        </ul>
      </Card>
      <Card title="人工补录">
        <p className="muted">在此粘贴探索结果，写回模块树（后端 stage-explore 已实现）。</p>
      </Card>
    </div>
  );
}

export function Feature() {
  return (
    <div className="stack">
      <h2>功能点（九列）</h2>
      <Card title="功能点表">
        <Table columns={FEATURE_COLS} rows={mockFeatureTable} />
      </Card>
    </div>
  );
}

export function Case() {
  const rows = mockCaseRows.map((c) => [
    c.caseNo, c.content, c.step, c.operation, c.expected, c.firstResult, c.regressionResult, c.conclusion,
  ]);
  return (
    <div className="stack">
      <h2>用例（八列）</h2>
      <Card title="用例表">
        <Table columns={CASE_COLS} rows={rows} />
      </Card>
    </div>
  );
}

export function Execute() {
  const rows = mockCaseRows.map((c) => [c.caseNo, '待执行']);
  return (
    <div className="stack">
      <h2>执行</h2>
      <Card title="执行编排">
        <p className="muted">后端 stage-execute 负责编排与 run 级隔离；此处为执行状态占位。</p>
        <Table columns={['用例编号', '状态']} rows={rows} />
      </Card>
    </div>
  );
}

export function Defect() {
  const rows = mockDefects.map((d) => [
    String(d.sequence), d.description, d.screenshotRef ?? '-', d.level, d.qualityAttribute, d.environment,
  ]);
  return (
    <div className="stack">
      <h2>缺陷（六列）</h2>
      <Card title="缺陷表">
        <Table columns={DEFECT_COLS} rows={rows} />
      </Card>
    </div>
  );
}

export function AIConfig() {
  return (
    <div className="stack">
      <h2>AI 配置</h2>
      <Card title="模型配置">
        <p className="muted">统一在 §14 配置（业务屏只读引用）。</p>
        <Table columns={['配置', '状态']} rows={[['默认用例生成模型', '启用'], ['探索增强模型', '禁用']]} />
      </Card>
    </div>
  );
}

export function Logs() {
  return (
    <div className="stack">
      <h2>日志</h2>
      <Card title="运行日志">
        <pre className="log">[2026-08-15 17:00] explore 完成：3 模块
[2026-08-15 17:01] feature 生成：3 功能点
[2026-08-15 17:02] case 绑定：2 用例</pre>
      </Card>
    </div>
  );
}

export function ProjectMgmt() {
  return (
    <div className="stack">
      <h2>项目管理</h2>
      <Card title="项目列表">
        <Table columns={['项目', '系统数']} rows={[['企业营销平台', '1']]} />
      </Card>
    </div>
  );
}

export function Knowledge() {
  return (
    <div className="stack">
      <h2>知识库</h2>
      <Card title="知识条目">
        <Table columns={['标题', '来源']} rows={[['必填校验规范', '需求文档'], ['性能基线', '历史测试']]} />
      </Card>
    </div>
  );
}
