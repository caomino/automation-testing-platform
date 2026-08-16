import { useState } from "react";
import { Button, Card, Modal, StatCard, Tag } from "../components";
import { loginModeLabel, systemTypeLabel, useApp } from "../context";
import { fromModuleView, fromFeatureView, fromCaseView, fromExecView } from "../services/pipeline";

function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { project, system, setActiveScreen, toast, setLoginStatus, runPipelineLogin } = useApp();
  const flowHint =
    system.credentialMode === "manual-takeover"
      ? "人工接管：启动可见浏览器 → 您在浏览器中手动完成登录 → 点击「确认登录」→ 平台捕获会话（cookies/headers/tokens）→ 自动继续后续流程"
      : system.credentialMode === "credential"
        ? "账号密码：启动可见浏览器 → 自动填充已配置凭据 → 您在浏览器中点击登录 → 点击「确认登录」→ 平台捕获会话 → 自动继续"
        : "免登录：直接进入系统，无需鉴权";

  const [loginStep, setLoginStep] = useState("");
  const [loginWorking, setLoginWorking] = useState(false);
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captchaInput, setCaptchaInput] = useState("");

  const handleLogin = async () => {
    setLoginWorking(true);
    setLoginStep("正在启动浏览器并导航到系统...");
    setNeedCaptcha(false);

    // 前置参数验证：确保必填字段已配置
    if (!project.id || project.id.trim() === '') {
      const errorMsg = '项目 ID 未配置，请先创建或选择项目';
      setLoginStep(`✗ 配置错误：${errorMsg}`);
      toast(errorMsg);
      setLoginWorking(false);
      return;
    }

    if (!system.url || system.url.trim() === '') {
      const errorMsg = `系统 "${system.name}" 的 URL 未配置，请在项目管理中填写系统地址`;
      setLoginStep(`✗ 配置错误：${errorMsg}`);
      toast(errorMsg);
      setLoginWorking(false);
      setActiveScreen("s9"); // 引导用户去项目管理页面
      return;
    }

    try {
      new URL(system.url); // 验证 URL 格式
    } catch {
      const errorMsg = `系统 "${system.name}" 的 URL 格式无效: ${system.url}`;
      setLoginStep(`✗ 配置错误：${errorMsg}`);
      toast(errorMsg);
      setLoginWorking(false);
      setActiveScreen("s9");
      return;
    }

    const parentPortalUrl = system.type === 'subsystem' ? system.parentPortalPath?.url : undefined;
    console.log('[debug] handleLogin:', {
      projectId: project.id,
      systemId: system.id,
      systemName: system.name,
      type: system.type,
      systemUrl: system.url,
      parentPortalPath: system.parentPortalPath,
      parentPortalUrl: parentPortalUrl,
      loginMode: system.credentialMode || system.loginMode,
    });

    try {
      const result = await runPipelineLogin({
        projectId: project.id,
        systemId: system.id,
        mode: system.credentialMode || system.loginMode,
        systemUrl: system.url,
        parentPortalUrl: parentPortalUrl,
        credentialRef: system.passwordRef || undefined,
        username: system.username || undefined,
        takeoverAction: 'launch',
      } as any);

      if (result && result.loginStatus === 'ok') {
        // no-login 模式：浏览器已打开并捕获会话
        setLoginStep("✓ 登录成功，会话已建立");
        setTimeout(() => {
          setLoginStatus(system.id, "logged_in");
          toast(`${system.name} 登录成功`);
          setLoginWorking(false);
          onClose();
        }, 1500);
      } else if (result && result.loginStatus === 'barrier') {
        // credential / manual-takeover 模式：浏览器已启动，等待用户在浏览器中完成登录
        setLoginStep("✓ 浏览器已启动！请在弹出的浏览器窗口中完成登录（包括验证码），登录完成后点击下方「确认登录」按钮");
        setNeedCaptcha(true);
        setLoginWorking(false);
      } else {
        // failed 状态或后端异常（result 为 null）
        if (!result) {
          // result 为 null 说明 context.tsx 已捕获异常并显示了 toast
          // 这里只更新登录进度状态，不再重复显示 toast
          setLoginStep('✗ 登录请求失败，请查看上方提示或检查系统配置');
        } else {
          // 有 result 但登录失败（loginStatus === 'failed'）
          const errorMsg = result?.sessionHandle?.detectionReason || "登录失败，请重试";
          setLoginStep(`✗ 登录失败：${errorMsg}`);
          toast(`登录失败：${errorMsg}`);
        }
        setLoginWorking(false);
      }
    } catch (e: any) {
      setLoginStep(`✗ 错误: ${e.message || '未知错误'}`);
      toast(`登录失败: ${e.message || '未知错误'}`);
      setLoginWorking(false);
    }
  };

  const handleConfirmLogin = async () => {
    setLoginStep("正在检测登录状态...");
    setLoginWorking(true);
    try {
      const result = await runPipelineLogin({
        projectId: project.id,
        systemId: system.id,
        mode: system.credentialMode || system.loginMode,
        systemUrl: system.url,
        parentPortalUrl: system.type === 'subsystem' ? system.parentPortalPath?.url : undefined,
        credentialRef: system.passwordRef || undefined,
        username: system.username || undefined,
        takeoverAction: 'confirm',
      } as any);

      if (result && result.loginStatus === 'ok') {
        setLoginStep("✓ 登录成功！会话已建立");
        setLoginStatus(system.id, "logged_in");
        toast(`${system.name} 登录成功`);
        setLoginWorking(false);
        setNeedCaptcha(false);
        setCaptchaInput("");
        onClose();
      } else if (result && result.loginStatus === 'barrier') {
        setLoginStep("⚠ 仍在等待登录完成，请继续在浏览器中操作后再点击确认");
        setLoginWorking(false);
      } else {
        setLoginStep("✗ 登录失败，请在浏览器中重新操作后再确认");
        setLoginWorking(false);
      }
    } catch (e: any) {
      setLoginStep(`✗ 错误: ${e.message || '未知错误'}`);
      toast(`检测失败: ${e.message || '未知错误'}`);
      setLoginWorking(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`🔐 登录系统 · ${system.name}`}
      footer={
        needCaptcha ? (
          <>
            <Button onClick={() => { setNeedCaptcha(false); setCaptchaInput(""); setLoginWorking(false); onClose(); }}>取消</Button>
            <Button variant="pri" disabled={loginWorking} onClick={handleConfirmLogin}>
              ✓ 确认登录（已在浏览器完成）
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => { setNeedCaptcha(false); setCaptchaInput(""); setLoginWorking(false); onClose(); }} disabled={loginWorking}>取消</Button>
            <Button variant="pri" disabled={loginWorking} onClick={handleLogin}>
              🚀 {loginWorking ? "登录中..." : "启动登录"}
            </Button>
          </>
        )
      }
    >
      <div className="meta-head">
        <b>系统类型</b>：{systemTypeLabel(system.type)}
        <br />
        {system.type === "subsystem" && (
          <>
            <b>父门户</b>：{system.parent}
            <br />
          </>
        )}
        <b>登录方式</b>：{loginModeLabel[system.loginMode]} <Tag tone="gray" title="在项目管理中配置，此处只读">来自项目管理 · 只读</Tag>
      </div>
      {system.loginMode !== "no-login" && (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label>账号 *（项目管理中配置，已回填）</label>
            <input placeholder="账号由项目管理凭据配置自动填充" disabled />
          </div>
          <div className="field">
            <label>密码 *（safeStorage 加密存储）</label>
            <input type="password" placeholder="••••••••（已加密保存）" disabled />
          </div>
        </div>
      )}
      {loginStep && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>登录进度</label>
          <div className="meta-head" style={{ background: "var(--priS)" }}>
            <span style={{ color: "var(--priT)", fontSize: 13 }}>{loginStep}</span>
          </div>
        </div>
      )}
      {needCaptcha && system.loginMode !== "no-login" && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>📸 登录提示</label>
          <div className="hint">
            请在弹出的浏览器窗口中完成登录，包括可能出现的验证码。登录完成后，点击下方「确认登录」按钮。
          </div>
          <div className="hint" style={{ color: "var(--warn)", marginTop: 6 }}>
            ⚠️ 如果浏览器窗口关闭，请重新点击「启动登录」
          </div>
        </div>
      )}
      <div className="field">
        <label>登录流程说明（按配置的登录方式执行）</label>
        <div className="hint">{flowHint}</div>
        <div className="hint" style={{ marginTop: 6, color: "var(--mut)" }}>
          登录方式在 📁 项目管理 → 新建/编辑系统时配置；如需更换请前往{" "}
          <a
            style={{ color: "var(--priT)", cursor: "pointer" }}
            onClick={() => {
              onClose();
              setActiveScreen("s9");
            }}
          >
            项目管理
          </a>{" "}
          修改。
        </div>
      </div>
    </Modal>
  );
}

export function Workbench() {
  const { project, system, systems, setSystem, setActiveScreen, toast, featureConfirmed, execModules, execBrowsers, activities, setLoginStatus, pipelineLoading, runPipelineExplore, runPipelineFeature, runPipelineCase, runPipelineExecute, runPipelineDefect, moduleTree, featureRows, caseRows, metaHeader, execMatrix } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  const isLoggedIn = system.loginStatus === "logged_in";
  const hasValidSession = () => {
    if (system.credentialMode === 'no-login' || system.loginMode === 'no-login') return true;
    const cookies = system.sessionState?.cookies;
    return !!(cookies && cookies.length > 0);
  };
  const hasFeature = featureConfirmed;
  const execDone = execModules.length > 0 && execModules.every((m) => !m.pending && m.pass !== undefined);

  const stageLabels = [
    { label: "探索", done: true },
    { label: "功能点", done: hasFeature },
    { label: "用例", done: hasFeature },
    { label: "执行", done: execDone },
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h2>① 工作台</h2>
          <div className="sub">所有系统底层都是单系统 · 登录方式三选一：免登录 / 账号密码登录 / 人工接管登录 · 仅子系统 URL 经父门户浏览器捕获</div>
        </div>
        <div className="row">
          <Button onClick={() => setActiveScreen("s9")}>项目配置</Button>
          <Button
            variant="pri"
            onClick={() => {
              toast("打开新建系统表单");
              setActiveScreen("s9");
            }}
          >
            + 新建系统/子系统
          </Button>
        </div>
      </div>

      <Card style={{ marginBottom: 16, borderLeft: "3px solid var(--pri)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <span style={{ color: "var(--mut)", fontSize: 13 }}>📁 {project.name}</span>
            <b style={{ fontSize: 18, marginLeft: 6 }}>📂 {system.name}</b>
            <Tag tone="gray">{systemTypeLabel(system.type)}</Tag>
            {system.type === "subsystem" && (
              <span style={{ fontSize: 12, color: "var(--mut)" }}>· 父：{system.parent}</span>
            )}
          </div>
          <div style={{ marginLeft: "auto", position: "relative" }}>
            <Button size="sm" onClick={() => setMenuOpen((v) => !v)}>
              🔀 切换系统 ▾
            </Button>
            {menuOpen && (
              <div
                style={{
                  display: "block",
                  position: "absolute",
                  top: 34,
                  right: 0,
                  background: "#fff",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,.12)",
                  zIndex: 20,
                  minWidth: 300,
                  padding: 6,
                }}
              >
                <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--mut)", borderBottom: "1px solid var(--line2)" }}>
                  切换当前系统 · 全应用跟随
                </div>
                {systems.map((s) => (
                  <a
                    key={s.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 13,
                      background: s.id === system.id ? "var(--priS)" : undefined,
                      color: s.id === system.id ? "var(--priT)" : undefined,
                    }}
                    onClick={() => {
                      setSystem(s.id);
                      setMenuOpen(false);
                      toast(`已切换到 ${s.name}`);
                    }}
                  >
                    <span>
                      {s.type === "subsystem" ? "📂" : "🖥️"} {s.name}
                    </span>
                    <Tag tone={s.id === system.id ? "info" : "gray"} style={{ fontSize: 10 }}>
                      {systemTypeLabel(s.type)}
                      {s.id === system.id ? " · 当前" : ""}
                    </Tag>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          工作台以 <b>{system.name}</b> 为单位：登录 → 探索 → 功能点 → 用例 → 执行 → 缺陷，各阶段数据独立 · 切换系统在此或屏⑨ · 项目切换走屏⑨
        </div>
      </Card>

      <div className="grid g4">
        <StatCard
          label="登录状态"
          value={
            <span style={{ fontSize: 14, color: isLoggedIn ? "var(--ok)" : "var(--warn)" }}>
              {isLoggedIn ? "✓ 已登录" : "○ 未登录"}
            </span>
          }
          detail={
            isLoggedIn
              ? system.type === "subsystem"
                ? "Cookie 经父门户会话 · 子系统 ✓"
                : "直接登录 · 会话已建立"
              : "点击下方「登录系统」按钮登录"
          }
        />
        <StatCard
          label="阶段进度"
          value={
            <span style={{ fontSize: 14 }}>
              {stageLabels.map((s) => (s.done ? "✓" : "○")).join(" ")}
            </span>
          }
          detail={stageLabels.map((s) => s.label).join(" → ")}
        />
        <StatCard label="用例数（本系统）" value={execModules.reduce((sum, m) => sum + m.cases, 0)} detail="本系统已生成" />
        <StatCard
          label="执行情况（本系统）"
          value={
            <span style={{ fontSize: 16 }}>
              {execModules.reduce((sum, m) => sum + (m.pass ?? 0), 0)} / {execModules.reduce((sum, m) => sum + m.cases, 0)} ✓
            </span>
          }
          detail={`通过 ${execModules.reduce((sum, m) => sum + (m.pass ?? 0), 0)} · 待执行 ${execModules.reduce((sum, m) => sum + (m.pending ? m.cases : (m.cases - (m.pass ?? 0))), 0)}`}
        />
      </div>

      <Card title={`快速操作（当前系统 · ${system.name}）`} style={{ marginTop: 16 }}>
        <div className="row">
          {!isLoggedIn ? (
            <Button variant="pri" onClick={() => setLoginOpen(true)} disabled={pipelineLoading}>
              🔐 登录系统
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setLoginStatus(system.id, "logged_out");
                toast("已退出登录");
              }}
            >
              退出登录
            </Button>
          )}
          <Button variant="pri" disabled={pipelineLoading || !isLoggedIn} onClick={async () => {
            // 第一优先级：检查会话是否有效
            if (!hasValidSession()) {
              toast("登录会话失效，请重新登录");
              setLoginOpen(true);
              return;
            }
            // 检查系统 URL
            if (!system.url) {
              toast("请先在项目管理中配置系统 URL");
              setActiveScreen("s9");
              return;
            }
            // 安全获取 cookies
            const cookies = system.sessionState?.cookies ?? [];
            const sessionHandle = {
              sessionId: system.id,
              systemId: system.id,
              loginStatus: 'ok' as const,
              cookies,
              headers: system.sessionState?.headers ?? {},
              tokens: system.sessionState?.tokens ?? [],
              expiresAt: Date.now() + 3600000,
            };
            const result = await runPipelineExplore({
              sessionHandle,
              subsystemId: system.id,
              systemUrl: system.url,
            });
            if (result) {
              setActiveScreen("s2");
            }
          }}>
            🔍 探索
          </Button>
          <Button variant="pri" disabled={pipelineLoading || !isLoggedIn} onClick={async () => {
            const modules = moduleTree.length > 0 ? fromModuleView(moduleTree) : [];
            const result = await runPipelineFeature({
              moduleTree: modules,
              systemName: system.name,
              confirmedOnly: false,
            });
            if (result) {
              setActiveScreen("s3");
            }
          }}>
            📋 功能点
          </Button>
          <Button variant="pri" disabled={pipelineLoading || !isLoggedIn} onClick={async () => {
            const features = featureRows.length > 0 ? fromFeatureView(featureRows) : [];
            const result = await runPipelineCase({
              featureTable: features,
              scope: 'all',
              metaConfig: {
                systemName: metaHeader.system || system.name,
                testPointId: metaHeader.testPointId,
                testPoint: metaHeader.testPoint,
                testers: metaHeader.testers,
                clientStaff: metaHeader.clientStaff,
                firstTestDate: new Date().toISOString().slice(0, 10),
                regressionDate: '',
                conclusionRule: metaHeader.conclusionRule,
                precondition: '',
              },
            });
            if (result) {
              setActiveScreen("s4");
            }
          }}>
            🧪 用例
          </Button>
          <Button variant="pri" disabled={pipelineLoading || !isLoggedIn} onClick={async () => {
            const sheets = caseRows.length > 0 ? fromCaseView(caseRows, metaHeader) : [];
            const browsers = execBrowsers.length > 0 ? execBrowsers.map(b => ({
              browser: b.split('·')[1] || b,
              os: b.split('·')[0] || 'windows',
              version: '',
            })) : [{ browser: 'chromium', os: 'windows', version: '' }];
            const result = await runPipelineExecute({
              caseWorkbook: sheets,
              scope: 'all',
              browserOSMatrix: browsers,
              systemUrl: system.url,
              cookies: system.sessionState?.cookies,
              headers: system.sessionState?.headers,
              tokens: system.sessionState?.tokens,
            });
            if (result) {
              setActiveScreen("s5");
            }
          }}>
            ▶ 执行
          </Button>
          <Button variant="pri" disabled={pipelineLoading || !isLoggedIn} onClick={async () => {
            const report = execMatrix.length > 0 ? fromExecView(execMatrix, execModules) : [];
            const result = await runPipelineDefect({
              executionReport: report,
            });
            if (result) {
              setActiveScreen("s6");
            }
          }}>
            🐛 缺陷
          </Button>
        </div>
        {pipelineLoading && <span style={{ color: 'var(--warn)', fontSize: 12, marginTop: 8 }}>⚙️ 执行中…</span>}
        <div className="hint" style={{ marginTop: 8 }}>
          🔐 登录系统按 <b>项目管理中配置的登录方式</b>（{loginModeLabel[system.loginMode]}）执行，弹窗内只读；未登录时进入探索会先弹出登录。
        </div>
        <div className="hint" style={{ marginTop: 4, color: 'var(--mut)' }}>
          💡 提示：所有操作通过 HTTP API 调用后端（端口 3001），需先运行 <code>pnpm server</code> 启动后端服务。
        </div>
      </Card>

      <Card title={`最近活动（${system.name}）`} style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          {activities.length > 0 ? (
            activities.map((a) => (
              <div key={a.id}>
                <span style={{ color: "var(--mut)" }}>{a.time}</span> {a.text}
              </div>
            ))
          ) : (
            <div style={{ color: "var(--mut)" }}>暂无活动记录</div>
          )}
        </div>
      </Card>

      <div className="row" style={{ marginTop: 12 }}>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>管理其他系统/项目级配置：</span>
        <Button size="sm" onClick={() => setActiveScreen("s9")}>
          项目管理
        </Button>
        <Button size="sm" onClick={() => setActiveScreen("s10")}>
          知识库
        </Button>
      </div>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}