import { useEffect, useState } from "react";
import { Button, Card, Table, ConfirmDialog } from "../components";
import { useApp } from "../context";
import type { LogFileView } from "./services/dataApi";

export function Logs() {
  const {
    logPolicy,
    logUpdatePolicy,
    logCleanupExpired,
    logClearAll,
    logRemoveFile,
    logListFiles,
    logGetDir,
  } = useApp();

  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState(logPolicy);
  const [files, setFiles] = useState<LogFileView[]>([]);
  const [logDir, setLogDir] = useState<string>("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  const loadFiles = async () => {
    const list = await logListFiles();
    setFiles(list || []);
    setSelectedRows(new Set());
  };

  const loadDir = async () => {
    const dir = await logGetDir();
    setLogDir(dir || "(默认路径)");
  };

  useEffect(() => {
    loadFiles();
    loadDir();
  }, []);

  const handleSavePolicy = async () => {
    await logUpdatePolicy(policyForm);
  };

  const handleCleanup = async () => {
    await logCleanupExpired();
    setCleanupOpen(false);
    loadFiles();
  };

  const handleClearAll = async () => {
    await logClearAll();
    setClearAllOpen(false);
    loadFiles();
  };

  const handleBatchDelete = async () => {
    const filenames = files
      .filter((_, i) => selectedRows.has(i))
      .map((f) => f.filename);
    for (const name of filenames) {
      await logRemoveFile(name);
    }
    setBatchDeleteOpen(false);
    loadFiles();
  };

  const handleSelectRow = (index: number, checked: boolean) => {
    const next = new Set(selectedRows);
    if (checked) {
      next.add(index);
    } else {
      next.delete(index);
    }
    setSelectedRows(next);
  };

  const columns = [
    { key: "subsystem", title: "子系统" },
    { key: "task", title: "任务" },
    { key: "filename", title: "文件名", mono: true },
    {
      key: "size",
      title: "大小",
      render: (r: LogFileView) => formatSize(r.size),
    },
    {
      key: "lastWrite",
      title: "最后写入",
      render: (r: LogFileView) => new Date(r.lastWrite).toLocaleString(),
    },
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h2>⑧ 日志管理</h2>
          <div className="sub">保留策略 + 清理 + 文件管理</div>
        </div>
        <div className="row">
          <Button variant="pri" onClick={() => setCleanupOpen(true)}>
            🧹 清理过期
          </Button>
          <Button variant="dng" onClick={() => setClearAllOpen(true)}>
            💥 一键清空
          </Button>
          {selectedRows.size > 0 && (
            <Button variant="dng" onClick={() => setBatchDeleteOpen(true)}>
              🗑 批量删除 ({selectedRows.size})
            </Button>
          )}
        </div>
      </div>

      <Card title="日志存储位置">
        <div style={{ padding: "8px 0", fontFamily: "monospace", fontSize: 13, color: "#1677ff" }}>
          {logDir}
        </div>
      </Card>

      <div className="grid g2">
        <Card title="保留策略">
          <div className="field">
            <label>保留天数</label>
            <div className="row" style={{ gap: 12 }}>
              {[7, 15, 30, 90].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={policyForm.retentionDays === d ? "pri" : "ghost"}
                  onClick={() => setPolicyForm({ ...policyForm, retentionDays: d })}
                >
                  {d} 天
                </Button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>单文件最大 (MB)</label>
            <input
              type="number"
              className="text-input"
              value={policyForm.maxFileSizeMB}
              onChange={(e) => setPolicyForm({ ...policyForm, maxFileSizeMB: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>最多文件数</label>
            <input
              type="number"
              className="text-input"
              value={policyForm.maxFiles}
              onChange={(e) => setPolicyForm({ ...policyForm, maxFiles: Number(e.target.value) })}
            />
          </div>
          <Button variant="pri" onClick={handleSavePolicy}>
            保存策略
          </Button>
        </Card>

        <Card title={`日志文件（${files.length} 个）`}>
          {files.length > 0 ? (
            <Table
              columns={columns}
              rows={files as any[]}
              rowKey={(r: any) => r.filename + r.task}
              selectable
              selectedRows={selectedRows}
              onSelectRow={handleSelectRow}
            />
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
              暂无日志文件
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        onConfirm={handleCleanup}
        title="清理过期日志"
        message={`将清理 ${logPolicy.retentionDays} 天前的日志文件。确定要执行吗？`}
      />

      <ConfirmDialog
        open={clearAllOpen}
        onClose={() => setClearAllOpen(false)}
        onConfirm={handleClearAll}
        title="一键清空全部"
        message="此操作将删除所有日志文件，不可恢复。确定要继续吗？"
        danger
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        onClose={() => setBatchDeleteOpen(false)}
        onConfirm={handleBatchDelete}
        title="批量删除日志"
        message={`将删除选中的 ${selectedRows.size} 个日志文件。确定要继续吗？`}
        danger
      />
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
