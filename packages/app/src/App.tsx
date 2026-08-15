import { useState } from 'react';
import { AIConfig, Case, Defect, Execute, Explore, Feature, Knowledge, Logs, ProjectMgmt, Workbench } from './screens';

type ScreenKey =
  | 'workbench' | 'explore' | 'feature' | 'case' | 'execute'
  | 'defect' | 'ai' | 'logs' | 'project' | 'knowledge';

const NAV: { key: ScreenKey; label: string }[] = [
  { key: 'workbench', label: '工作台' },
  { key: 'explore', label: '探索' },
  { key: 'feature', label: '功能点' },
  { key: 'case', label: '用例' },
  { key: 'execute', label: '执行' },
  { key: 'defect', label: '缺陷' },
  { key: 'ai', label: 'AI配置' },
  { key: 'logs', label: '日志' },
  { key: 'project', label: '项目管理' },
  { key: 'knowledge', label: '知识库' },
];

export function App() {
  const [active, setActive] = useState<ScreenKey>('workbench');
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">自动化测试平台</div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.key}
              className={active === n.key ? 'nav-item active' : 'nav-item'}
              onClick={() => setActive(n.key)}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        {active === 'workbench' && <Workbench />}
        {active === 'explore' && <Explore />}
        {active === 'feature' && <Feature />}
        {active === 'case' && <Case />}
        {active === 'execute' && <Execute />}
        {active === 'defect' && <Defect />}
        {active === 'ai' && <AIConfig />}
        {active === 'logs' && <Logs />}
        {active === 'project' && <ProjectMgmt />}
        {active === 'knowledge' && <Knowledge />}
      </main>
    </div>
  );
}
