import { useState } from "react";
import { Button, Card, Tag, Tree, Modal } from "../components";
import type { TreeItem } from "../components";
import { useApp } from "../context";
import type { ExecModuleState } from "../context";

function moduleToTreeItems(modules: ExecModuleState[], checkedModules: string[], onToggle: (name: string, checked: boolean) => void): TreeItem[] {
  return modules.map((m) => ({
    id: m.name,
    label: `${m.name} (${m.cases} 用例)`,
    checked: checkedModules.includes(m.name),
    onToggle: (_id, c) => onToggle(m.name, c),
    tags: m.pending ? <Tag tone="review">待确认</Tag> : undefined,
  }));
}

export function Execute() {
  const { execModules, execBrowsers, execMatrix, execCheckedModules, execIsolationPassed, execToggleModule, execToggleAll, execRun, execVerifyIsolation, toast, addActivity } = useApp();

  const [matrixDetailOpen, setMatrixDetailOpen] = useState(false);
  const [detailCaseNo, setDetailCaseNo] = useState("");
  const [isolationResult, setIsolationResult] = useState<{ browser: string; status: string }[] | null>(null);
  const [isolationOpen, setIsolationOpen] = useState(false);

  const pendingCount = execModules.filter((m) => m.pending).length;
  const readyCount = execModules.filter((m) => !m.pending).length;

  const allChecked = readyCount > 0 && execCheckedModules.length === readyCount;

  const handleRunSelected = () => {
    if (execCheckedModules.length === 0) {
      toast("请先在左侧勾选模块");
      return;
    }
    execRun("selected");
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `执行选中 ${execCheckedModules.length} 个模块` });
    toast("执行完成");
  };

  const handleRunAll = () => {
    execRun("all");
    addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: "执行全部模块" });
    toast("全部执行完成");
  };

  const handleVerifyIsolation = () => {
    execVerifyIsolation();
    const results = execBrowsers.map((b) => ({
      browser: b,
      status: "pass",
    }));
    setIsolationResult(results);
  };

  const showDetail = (caseNo: string) => {
    setDetailCaseNo(caseNo);
    setMatrixDetailOpen(true);
  };

  const handleExportResults = () => {
    const browserHeaders = execBrowsers.map((b) => b);
    const headers = ["用例编号", "步骤", ...browserHeaders];
    const csv = [
      headers.join(","),
      ...execMatrix.map((row) => {
        const statuses = execBrowsers.map((b) => {
          const cell = row.cells.find((c) => c.browser === b);
          return cell ? cell.status : "pending";
        });
        return [row.caseNo, row.steps, ...statuses]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",");
      }),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution_results_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("已导出执行结果");
  };

  return (
    <>
      <div className="ph">
        <div>
          <h2>⑤ 执行</h2>
          <div className="sub">树形范围 + 浏览器×OS 矩阵 + 数据隔离 verify · 功能点未确认的模块置灰</div>
        </div>
        <div className="row">
          <Button variant="pri" onClick={handleRunSelected} disabled={execCheckedModules.length === 0}>
            ▶ 执行选中（{execCheckedModules.length}）
          </Button>
          <Button variant="pri" onClick={handleRunAll}>
            ▶ 执行全部
          </Button>
          <Button onClick={() => setIsolationOpen(true)}>🛡 数据隔离 Verify</Button>
          <Button onClick={handleExportResults}>📥 导出结果</Button>
        </div>
      </div>

      <div className="grid g2">
        <Card title={`执行范围（勾选要执行的模块 · ${readyCount} 可执行 · ${pendingCount} 待确认）`}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Button size="sm" onClick={() => execToggleAll(!allChecked)}>
              {allChecked ? "☑ 取消全选" : "☐ 全选"}
            </Button>
            <span style={{ fontSize: 12, color: "var(--mut)", marginLeft: 8 }}>
              已选 {execCheckedModules.length} / {readyCount} 个可执行模块
            </span>
          </div>
          <Tree
            root="📋 模块列表"
            items={moduleToTreeItems(execModules, execCheckedModules, execToggleModule)}
          />
        </Card>

        <Card title={`浏览器 × OS 矩阵（${execBrowsers.length} 环境）`}>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>用例编号</th>
                  <th style={{ width: 60 }}>步骤</th>
                  {execBrowsers.map((b) => (
                    <th key={b} style={{ width: 100 }}>
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {execMatrix.map((row) => (
                  <tr key={row.caseNo}>
                    <td className="mono" style={{ cursor: "pointer" }} onClick={() => showDetail(row.caseNo)}>
                      {row.caseNo}
                    </td>
                    <td>{row.steps}</td>
                    {row.cells.map((c) => (
                      <td
                        key={c.browser}
                        style={{
                          cursor: "pointer",
                          background: c.status === "pass" ? "#DCFCE7" : c.status === "running" ? "#FEF3C7" : "#F3F4F6",
                          textAlign: "center",
                        }}
                        onClick={() => showDetail(row.caseNo)}
                      >
                        {c.status === "pass" ? "✓" : c.status === "running" ? "⏳" : "○"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>点击单元格可查看用例步骤详情</div>
        </Card>
      </div>

      <Modal open={matrixDetailOpen} onClose={() => setMatrixDetailOpen(false)} title={`用例详情 · ${detailCaseNo}`}>
        <div className="meta-head">
          <b>用例编号</b>：{detailCaseNo}
          <br />
          <b>步骤数</b>：{execMatrix.find((r) => r.caseNo === detailCaseNo)?.steps ?? 0}
        </div>
        <div style={{ marginTop: 12 }}>
          <b>各浏览器状态：</b>
          <table style={{ width: "100%", marginTop: 8 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>浏览器</th>
                <th style={{ textAlign: "center" }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {execMatrix.find((r) => r.caseNo === detailCaseNo)?.cells.map((c) => (
                <tr key={c.browser}>
                  <td>{c.browser}</td>
                  <td style={{ textAlign: "center" }}>
                    {c.status === "pass" ? (
                      <Tag tone="ok">通过</Tag>
                    ) : c.status === "running" ? (
                      <Tag tone="warn">运行中</Tag>
                    ) : (
                      <Tag tone="gray">待执行</Tag>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12 }}>
          <b>预期步骤：</b>
          <ol style={{ paddingLeft: 20, marginTop: 4 }}>
            <li>打开系统，登录成功</li>
            <li>导航到目标页面</li>
            <li>执行操作步骤</li>
            <li>验证预期结果</li>
          </ol>
        </div>
      </Modal>

      <Modal
        open={isolationOpen}
        onClose={() => setIsolationOpen(false)}
        title="🛡 数据隔离 Verify"
        footer={
          <>
            <Button onClick={() => setIsolationOpen(false)}>关闭</Button>
            <Button variant="pri" onClick={handleVerifyIsolation}>
              运行 Verify
            </Button>
          </>
        }
      >
        <p>验证测试执行的数据是否与生产数据隔离。运行后将显示各浏览器的隔离验证结果。</p>
        {execIsolationPassed && (
          <div style={{ marginTop: 12 }}>
            <Tag tone="ok">✓ 上次验证通过</Tag>
          </div>
        )}
        {isolationResult && (
          <table style={{ width: "100%", marginTop: 12 }}>
            <thead>
              <tr>
                <th>浏览器</th>
                <th>隔离状态</th>
              </tr>
            </thead>
            <tbody>
              {isolationResult.map((r) => (
                <tr key={r.browser}>
                  <td>{r.browser}</td>
                  <td>{r.status === "pass" ? <Tag tone="ok">✓ 已隔离</Tag> : <Tag tone="danger">✗ 未隔离</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </>
  );
}