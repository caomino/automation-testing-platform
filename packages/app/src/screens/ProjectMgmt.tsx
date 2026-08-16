import { useState, Fragment, useRef } from "react";
import { Button, Card, Modal, Tag, ConfirmDialog } from "../components";
import { loginModeLabel, loginStatusLabel, useApp } from "../context";
import type { ProjectInfo, SystemInfo } from "../context";
import { startCapture, getCaptureStatus, completeCapture, cancelCapture, type CaptureResultApi } from "../services/dataApi";

interface SystemContext {
  projectId: string;
}

export function ProjectMgmt() {
  const { projects, systems, systemTypeLabel, setProject, setSystem, addProject, updateProject, removeProject, addSystem, updateSystem, removeSystem, toast, setActiveScreen } = useApp();

  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const [editProject, setEditProject] = useState<ProjectInfo | null>(null);
  const [editSystem, setEditSystem] = useState<SystemInfo | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<{ open: boolean; id: string } | null>(null);
  const [confirmDeleteSystem, setConfirmDeleteSystem] = useState<{ open: boolean; id: string } | null>(null);
  const [newProject, setNewProject] = useState<Partial<ProjectInfo>>({});
  const [newSystem, setNewSystem] = useState<Partial<SystemInfo>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [systemContext, setSystemContext] = useState<SystemContext | null>(null);

  // 浏览器捕获相关状态
  const [captureSessionId, setCaptureSessionId] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'capturing' | 'completing' | 'completed' | 'failed'>('idle');
  const [capturedResult, setCapturedResult] = useState<CaptureResultApi | null>(null);
  const capturePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isSubsystem = (editSystem?.type ?? newSystem.type) === "subsystem";
  const currentLoginMode = editSystem?.loginMode ?? newSystem.loginMode ?? "no-login";
  const portalSystems = systems.filter((s) => s.type === "portal");
  const currentParentPortal =
    editSystem?.parentPortalId
      ? systems.find((s) => s.id === editSystem.parentPortalId)
      : newSystem.parentPortalId
        ? systems.find((s) => s.id === newSystem.parentPortalId)
        : undefined;

  const getProjectName = (projectId?: string) => {
    if (!projectId) return "-";
    return projects.find((p) => p.id === projectId)?.name ?? "-";
  };

  const getSystemsByProject = (projectId: string) => systems.filter((s) => s.projectId === projectId);

  const toggleExpand = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const openAddSystemForProject = (projectId: string) => {
    setSystemContext({ projectId });
    setEditSystem(null);
    setNewSystem({ projectId });
    setSystemModalOpen(true);
  };

  // ===== 浏览器捕获处理函数 =====

  const handleStartCapture = async () => {
    const portal = currentParentPortal;
    if (!portal) {
      toast("请先选择父门户系统");
      return;
    }
    if (!portal.url) {
      toast("父门户 URL 为空，请先配置父门户");
      return;
    }

    try {
      toast("正在启动浏览器...");
      const session = await startCapture(portal.url, editSystem?.id || newSystem.id);
      setCaptureSessionId(session.id);
      setCaptureStatus("capturing");
      toast("✅ 浏览器已打开，请在浏览器中完成登录和导航");

      startCapturePolling(session.id);
    } catch (e: any) {
      toast(`❌ 启动失败: ${e.message}`);
    }
  };

  const startCapturePolling = (sessionId: string) => {
    if (capturePollRef.current) {
      clearInterval(capturePollRef.current);
    }

    capturePollRef.current = setInterval(async () => {
      try {
        const status = await getCaptureStatus(sessionId);
        if (status) {
          setCaptureStatus(status.status);
          if (status.status === "completed" || status.status === "failed" || status.status === "cancelled") {
            if (capturePollRef.current) {
              clearInterval(capturePollRef.current);
              capturePollRef.current = null;
            }
          }
        }
      } catch {
        // 静默忽略轮询错误
      }
    }, 1000);
  };

  const handleCompleteCapture = async () => {
    if (!captureSessionId) return;

    try {
      setCaptureStatus("completing");
      toast("正在获取浏览器状态...");
      const result = await completeCapture(captureSessionId);
      setCapturedResult(result);
      setCaptureStatus("completed");

      // 回填表单
      if (editSystem) {
        setEditSystem({
          ...editSystem,
          captured: true,
          capturedUrl: result.capturedUrl,
          url: result.capturedUrl || editSystem.url,
          sessionState: {
            cookies: result.cookies,
            headers: result.headers,
            tokens: result.tokens,
          },
        });
      } else {
        setNewSystem({
          ...newSystem,
          captured: true,
          capturedUrl: result.capturedUrl,
          url: result.capturedUrl,
          sessionState: {
            cookies: result.cookies,
            headers: result.headers,
            tokens: result.tokens,
          },
        });
      }

      toast("✅ 捕获成功，已回填表单");

      setCaptureSessionId(null);
      if (capturePollRef.current) {
        clearInterval(capturePollRef.current);
        capturePollRef.current = null;
      }
    } catch (e: any) {
      toast(`❌ 完成捕获失败: ${e.message}`);
      setCaptureStatus("failed");
    }
  };

  const handleCancelCapture = async () => {
    if (!captureSessionId) return;

    try {
      await cancelCapture(captureSessionId);
      toast("已取消捕获");
    } catch (e: any) {
      toast(`取消失败: ${e.message}`);
    }

    setCaptureSessionId(null);
    setCaptureStatus("idle");
    setCapturedResult(null);
    if (capturePollRef.current) {
      clearInterval(capturePollRef.current);
      capturePollRef.current = null;
    }
  };

  // ===== 结束浏览器捕获处理函数 =====

  const handleSaveProject = () => {
    if (editProject) {
      updateProject(editProject.id, editProject);
      toast("已保存项目");
    } else {
      const id = `p-${Date.now()}`;
      addProject({
        id,
        name: newProject.name ?? "新项目",
        type: (newProject.type as any) ?? "standalone",
        description: newProject.description ?? "",
        systemCount: 0,
        caseCount: 0,
        createdAt: new Date().toISOString().slice(0, 10),
        lastActive: "今天",
        status: "活跃",
      });
      toast("项目已创建");
    }
    setProjectModalOpen(false);
    setEditProject(null);
    setNewProject({});
  };

  const handleSaveSystem = () => {
    if (editSystem) {
      updateSystem(editSystem.id, editSystem);
      toast("已保存系统");
    } else {
      const id = `s-${Date.now()}`;
      const autoProjectId = systemContext?.projectId ?? newSystem.projectId;
      addSystem({
        id,
        name: newSystem.name ?? "新系统",
        type: (newSystem.type as any) ?? "standalone",
        url: newSystem.url ?? "",
        captured: false,
        parent: newSystem.parent ?? "",
        projectId: autoProjectId,
        loginMode: (newSystem.loginMode as any) ?? "no-login",
        loginStatus: "logged_out",
        parentPortalId: newSystem.parentPortalId,
        parentPortalPath: newSystem.parentPortalPath,
        capturedUrl: newSystem.capturedUrl,
        username: newSystem.username,
        passwordRef: newSystem.passwordRef,
      });
      toast("系统已创建");
    }
    setSystemModalOpen(false);
    setEditSystem(null);
    setNewSystem({});
    setSystemContext(null);
  };

  const contextProjectName = systemContext
    ? getProjectName(systemContext.projectId)
    : getProjectName(editSystem?.projectId ?? newSystem.projectId);

  return (
    <>
      <div className="ph">
        <div>
          <h2>⑨ 项目管理</h2>
          <div className="sub">项目 CRUD + 系统 CRUD + 进入系统跳转工作台</div>
        </div>
        <div className="row">
          <Button variant="pri" onClick={() => { setEditProject(null); setNewProject({}); setProjectModalOpen(true); }}>
            + 新建项目
          </Button>
        </div>
      </div>

      <Card title={`项目列表（${projects.length} 个）· 系统列表（${systems.length} 个）`}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>项目名</th>
              <th>类型</th>
              <th>描述</th>
              <th>系统数</th>
              <th>用例数</th>
              <th>状态</th>
              <th style={{ width: 200 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const projSystems = getSystemsByProject(p.id);
              const isExpanded = expandedProjects.has(p.id);
              return (
                <Fragment key={p.id}>
                  <tr onClick={() => setProject(p.id)} style={{ cursor: "pointer" }}>
                    <td onClick={(e) => { e.stopPropagation(); toggleExpand(p.id); }} style={{ cursor: "pointer", textAlign: "center" }}>
                      <span className={`proj-expand ${isExpanded ? "open" : ""}`}>▶</span>
                    </td>
                    <td style={{ fontWeight: 500, color: "var(--pri)" }}>{p.name}</td>
                    <td>{systemTypeLabel(p.type)}</td>
                    <td>{p.description}</td>
                    <td>{projSystems.length}</td>
                    <td>{p.caseCount}</td>
                    <td>
                      <Tag tone={p.status === "活跃" ? "ok" : "gray"}>{p.status}</Tag>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="op op-compact">
                        <Button size="sm" variant="pri" onClick={() => openAddSystemForProject(p.id)}>+ 系统</Button>
                        <Button size="sm" onClick={() => { setEditProject(p); setProjectModalOpen(true); }}>编辑</Button>
                        <Button size="sm" variant="dng" onClick={() => setConfirmDeleteProject({ open: true, id: p.id })}>删除</Button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${p.id}-systems`} style={{ background: "transparent" }}>
                      <td colSpan={8} style={{ padding: 0, borderBottom: "1px solid var(--line2)" }}>
                        <div className="sub-sys-table">
                          {projSystems.length > 0 ? (
                            <table>
                              <thead>
                                <tr>
                                  <th>系统名</th>
                                  <th>类型</th>
                                  <th>父门户</th>
                                  <th>URL</th>
                                  <th>登录方式</th>
                                  <th>登录状态</th>
                                  <th style={{ width: 180 }}>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {projSystems.map((s) => (
                                  <tr key={s.id}>
                                    <td>{s.name}</td>
                                    <td>{systemTypeLabel(s.type)}</td>
                                    <td>
                                      {s.type === "subsystem" && s.parentPortalId
                                        ? systems.find((pp) => pp.id === s.parentPortalId)?.name ?? "-"
                                        : "-"}
                                    </td>
                                    <td className="mono">{s.url}</td>
                                    <td>{loginModeLabel[s.loginMode]}</td>
                                    <td>
                                      <Tag tone={s.loginStatus === "logged_in" ? "ok" : "gray"}>{loginStatusLabel[s.loginStatus]}</Tag>
                                    </td>
                                    <td>
                                      <div className="op op-compact">
                                        <Button size="sm" variant="pri" onClick={() => { setSystem(s.id); setActiveScreen("s1"); }}>进入</Button>
                                        <Button size="sm" onClick={() => { setEditSystem(s); setSystemContext(null); setSystemModalOpen(true); }}>编辑</Button>
                                        <Button size="sm" variant="dng" onClick={() => setConfirmDeleteSystem({ open: true, id: s.id })}>删除</Button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div style={{ padding: "12px 16px", color: "var(--mut)", fontSize: 12, textAlign: "center" }}>
                              暂无系统，点击 "+ 系统" 添加
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Modal
        open={projectModalOpen}
        onClose={() => { setProjectModalOpen(false); setEditProject(null); setNewProject({}); }}
        title={editProject ? "编辑项目" : "+ 新建项目"}
        footer={
          <>
            <Button onClick={() => { setProjectModalOpen(false); setEditProject(null); setNewProject({}); }}>取消</Button>
            <Button variant="pri" onClick={handleSaveProject}>保存</Button>
          </>
        }
      >
        {(editProject || newProject) && (
          <>
            <div className="field"><label>项目名称</label><input className="text-input" value={(editProject?.name ?? newProject.name ?? "")} onChange={(e) => editProject ? setEditProject({ ...editProject, name: e.target.value }) : setNewProject({ ...newProject, name: e.target.value })} /></div>
            <div className="field">
              <label>类型</label>
              <select value={(editProject?.type ?? newProject.type ?? "standalone")} onChange={(e) => editProject ? setEditProject({ ...editProject, type: e.target.value as any }) : setNewProject({ ...newProject, type: e.target.value as any })}>
                <option value="portal">门户</option>
                <option value="standalone">单系统</option>
                <option value="subsystem">子系统</option>
              </select>
            </div>
            <div className="field"><label>描述</label><input className="text-input" value={(editProject?.description ?? newProject.description ?? "")} onChange={(e) => editProject ? setEditProject({ ...editProject, description: e.target.value }) : setNewProject({ ...newProject, description: e.target.value })} /></div>
          </>
        )}
      </Modal>

      <Modal
        open={systemModalOpen}
        onClose={() => { setSystemModalOpen(false); setEditSystem(null); setNewSystem({}); setSystemContext(null); }}
        title={editSystem ? "编辑系统" : "+ 新建系统"}
        footer={
          <>
            <Button onClick={() => { setSystemModalOpen(false); setEditSystem(null); setNewSystem({}); setSystemContext(null); }}>取消</Button>
            <Button variant="pri" onClick={handleSaveSystem}>保存</Button>
          </>
        }
      >
        {(editSystem || newSystem) && (
          <>
            <div className="field">
              <label>所属项目</label>
              <input className="text-input" value={contextProjectName || "-"} disabled readOnly />
            </div>

            <div className="field"><label>系统名称</label><input className="text-input" value={(editSystem?.name ?? newSystem.name ?? "")} onChange={(e) => editSystem ? setEditSystem({ ...editSystem, name: e.target.value }) : setNewSystem({ ...newSystem, name: e.target.value })} /></div>
            <div className="field">
              <label>类型</label>
              <select value={(editSystem?.type ?? newSystem.type ?? "standalone")} onChange={(e) => editSystem ? setEditSystem({ ...editSystem, type: e.target.value as any }) : setNewSystem({ ...newSystem, type: e.target.value as any })}>
                <option value="portal">门户</option>
                <option value="standalone">单系统</option>
                <option value="subsystem">子系统</option>
              </select>
            </div>

            {isSubsystem ? (
              <>
                <div className="field">
                  <label>父门户系统 *</label>
                  <select
                    value={(editSystem?.parentPortalId ?? newSystem.parentPortalId ?? "")}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const portal = systems.find((s) => s.id === pid);
                      if (editSystem) {
                        setEditSystem({
                          ...editSystem,
                          parentPortalId: pid || undefined,
                          parentPortalPath: portal ? { name: portal.name, url: portal.url } : undefined,
                          url: portal?.url ?? editSystem.url ?? "",
                          projectId: portal?.projectId ?? editSystem.projectId,
                        });
                      } else {
                        setNewSystem({
                          ...newSystem,
                          parentPortalId: pid || undefined,
                          parentPortalPath: portal ? { name: portal.name, url: portal.url } : undefined,
                          url: portal?.url ?? newSystem.url ?? "",
                          projectId: portal?.projectId ?? newSystem.projectId,
                        });
                      }
                    }}
                  >
                    <option value="">请选择父门户系统</option>
                    {portalSystems.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>子系统 URL（浏览器捕获）</label>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <Button
                      size="sm"
                      onClick={handleStartCapture}
                      disabled={captureStatus === "capturing" || captureStatus === "completing"}
                    >
                      {captureStatus === "capturing" ? "🔴 捕获中..." : captureStatus === "completing" ? "⏳ 获取中..." : "📡 打开浏览器捕获"}
                    </Button>
                    {(editSystem?.capturedUrl ?? newSystem.capturedUrl) && (
                      <code style={{ background: "#f5f5f5", padding: "4px 8px", borderRadius: 4, fontSize: 12 }}>
                        {editSystem?.capturedUrl ?? newSystem.capturedUrl}
                      </code>
                    )}
                  </div>

                  {/* 捕获状态提示 */}
                  {captureStatus === "capturing" && (
                    <div className="capture-hint">
                      <div className="capture-hint-icon">🔴</div>
                      <div className="capture-hint-content">
                        <strong>MCP 浏览器已启动</strong>
                        <span>请在浏览器中完成登录和导航，然后点击「完成捕获」</span>
                      </div>
                      <div className="capture-hint-actions">
                        <Button size="sm" variant="pri" onClick={handleCompleteCapture}>完成捕获</Button>
                        <Button size="sm" variant="gho" onClick={handleCancelCapture}>取消</Button>
                      </div>
                    </div>
                  )}

                  {captureStatus === "completing" && (
                    <div className="capture-hint capture-hint-loading">
                      <div className="capture-hint-icon">⏳</div>
                      <span>正在获取浏览器状态...</span>
                    </div>
                  )}

                  {capturedResult && (
                    <div className="captured-result">
                      <div className="captured-result-header">
                        <span className="captured-badge">✓ 已捕获</span>
                        <span className="captured-time">{new Date(capturedResult.capturedAt).toLocaleString()}</span>
                      </div>
                      <div className="captured-result-row">
                        <label>URL</label>
                        <code>{capturedResult.capturedUrl || "(未捕获)"}</code>
                      </div>
                      <div className="captured-result-row">
                        <label>Cookies</label>
                        <span>{capturedResult.cookies.length} 条</span>
                      </div>
                      <div className="captured-result-row">
                        <label>Headers</label>
                        <span>{Object.keys(capturedResult.headers).length} 个</span>
                      </div>
                      <div className="captured-result-row">
                        <label>Tokens</label>
                        <span>{capturedResult.tokens.length} 个</span>
                      </div>
                    </div>
                  )}
                </div>

                {currentParentPortal && (
                  <div className="field">
                    <label>父门户路径</label>
                    <input className="text-input" value={`${currentParentPortal.name} → ${currentParentPortal.url}`} disabled readOnly />
                  </div>
                )}
              </>
            ) : (
              <div className="field">
                <label>系统 URL *</label>
                <input
                  className="text-input"
                  value={(editSystem?.url ?? newSystem.url ?? "")}
                  onChange={(e) => editSystem ? setEditSystem({ ...editSystem, url: e.target.value }) : setNewSystem({ ...newSystem, url: e.target.value })}
                  placeholder="https://example.com"
                />
              </div>
            )}

            <div className="field">
              <label>登录方式</label>
              <select value={(editSystem?.loginMode ?? newSystem.loginMode ?? "no-login")} onChange={(e) => editSystem ? setEditSystem({ ...editSystem, loginMode: e.target.value as any }) : setNewSystem({ ...newSystem, loginMode: e.target.value as any })}>
                <option value="no-login">免登录</option>
                <option value="credential">账号密码登录</option>
                <option value="manual-takeover">人工接管登录</option>
              </select>
            </div>

            {currentLoginMode === "credential" && (
              <>
                <div className="field">
                  <label>账号</label>
                  <input
                    className="text-input"
                    value={(editSystem?.username ?? newSystem.username ?? "")}
                    onChange={(e) => editSystem ? setEditSystem({ ...editSystem, username: e.target.value }) : setNewSystem({ ...newSystem, username: e.target.value })}
                    placeholder="请输入账号"
                  />
                </div>
                <div className="field">
                  <label>密码</label>
                  <input
                    className="text-input"
                    type="password"
                    value={(editSystem?.passwordRef ?? newSystem.passwordRef ?? "")}
                    onChange={(e) => editSystem ? setEditSystem({ ...editSystem, passwordRef: e.target.value }) : setNewSystem({ ...newSystem, passwordRef: e.target.value })}
                    placeholder="请输入密码"
                  />
                </div>
              </>
            )}

            {currentLoginMode === "manual-takeover" && (
              <>
                <div className="field">
                  <label>账号（可选）</label>
                  <input
                    className="text-input"
                    value={(editSystem?.username ?? newSystem.username ?? "")}
                    onChange={(e) => editSystem ? setEditSystem({ ...editSystem, username: e.target.value }) : setNewSystem({ ...newSystem, username: e.target.value })}
                    placeholder="可选，预先填入账号"
                  />
                </div>
                <div className="hint" style={{ color: "#888", fontSize: 12, padding: "4px 0" }}>
                  💡 将打开浏览器，由人工完成登录（支持验证码/手机号等）
                </div>
              </>
            )}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDeleteProject?.open ?? false}
        onClose={() => setConfirmDeleteProject(null)}
        onConfirm={() => {
          if (confirmDeleteProject) {
            removeProject(confirmDeleteProject.id);
            setConfirmDeleteProject(null);
          }
        }}
        title="删除项目确认"
        message="确定要删除此项目吗？此操作将同时删除项目下的所有系统。"
        danger
      />

      <ConfirmDialog
        open={confirmDeleteSystem?.open ?? false}
        onClose={() => setConfirmDeleteSystem(null)}
        onConfirm={() => {
          if (confirmDeleteSystem) {
            removeSystem(confirmDeleteSystem.id);
            setConfirmDeleteSystem(null);
          }
        }}
        title="删除系统确认"
        message="确定要删除此系统吗？"
        danger
      />
    </>
  );
}
