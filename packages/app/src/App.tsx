import { AppProvider, loginStatusLabel, useApp } from "./context";
import { Button, Crumb, Pill } from "./components";
import { Workbench } from "./screens/Workbench";
import { Explore } from "./screens/Explore";
import { Feature } from "./screens/Feature";
import { Case } from "./screens/Case";
import { Execute } from "./screens/Execute";
import { Defect } from "./screens/Defect";
import { Logs } from "./screens/Logs";
import { AIConfig } from "./screens/AIConfig";
import { ProjectMgmt } from "./screens/ProjectMgmt";
import { Knowledge } from "./screens/Knowledge";

const NAV_GROUPS: { label: string; items: { key: string; n: string; label: string }[] }[] = [
  {
    label: "流水线",
    items: [
      { key: "s1", n: "1", label: "工作台" },
      { key: "s2", n: "2", label: "系统探索" },
      { key: "s3", n: "3", label: "功能点审核" },
      { key: "s4", n: "4", label: "测试用例" },
      { key: "s5", n: "5", label: "执行" },
      { key: "s6", n: "6", label: "缺陷" },
    ],
  },
  {
    label: "系统",
    items: [
      { key: "s8", n: "⚙", label: "日志管理" },
      { key: "s7", n: "AI", label: "AI 模型配置" },
    ],
  },
  {
    label: "项目",
    items: [
      { key: "s9", n: "9", label: "项目管理" },
      { key: "s10", n: "10", label: "知识库" },
    ],
  },
];

function Shell() {
  const { project, system, activeScreen, setActiveScreen, toastMsg, setLoginStatus, addActivity } = useApp();

  const isLoggedIn = system.loginStatus === "logged_in";

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          TestMaster · 商业版
        </div>
        <div className="crumbs">
          <Crumb>📁 {project.name}</Crumb>
          <span className="sep">›</span>
          {system.type === "subsystem" ? (
            <>
              <Crumb code={system.url.split("/")[0]}>🖥️ {system.parent}</Crumb>
              <span className="sep">›</span>
              <Crumb active code={system.url}>
                📂 {system.name}
              </Crumb>
            </>
          ) : (
            <Crumb active code={system.url}>
              🖥️ {system.name}
            </Crumb>
          )}
        </div>
        <div className="sp" />
        <Pill>
          {isLoggedIn ? "✓" : "○"} {loginStatusLabel[system.loginStatus]} · {system.name}
        </Pill>
        <Button
          size="sm"
          onClick={() => {
            if (isLoggedIn) {
              setLoginStatus(system.id, "logged_out");
              addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `${system.name} 已退出登录` });
            } else {
              setLoginStatus(system.id, "logging_in");
              setTimeout(() => {
                setLoginStatus(system.id, "logged_in");
                addActivity({ id: `act-${Date.now()}`, time: new Date().toLocaleTimeString().slice(0, 5), text: `${system.name} 登录成功` });
              }, 1000);
            }
          }}
        >
          {isLoggedIn ? "退出登录" : "连接系统"}
        </Button>
        <Button size="sm" variant="pri" onClick={() => setActiveScreen("s2")}>
          播放下一步 ▷
        </Button>
      </header>
      <div className="wrap">
        <aside className="side">
          {NAV_GROUPS.map((g) => (
            <div key={g.label}>
              <h6>{g.label}</h6>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  className={`nav ${activeScreen === it.key ? "active" : ""}`.trim()}
                  onClick={() => setActiveScreen(it.key)}
                >
                  <span className="n">{it.n}</span>
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <main>
          <section className={`screen ${activeScreen === "s1" ? "active" : ""}`.trim()}>
            <Workbench />
          </section>
          <section className={`screen ${activeScreen === "s2" ? "active" : ""}`.trim()}>
            <Explore />
          </section>
          <section className={`screen ${activeScreen === "s3" ? "active" : ""}`.trim()}>
            <Feature />
          </section>
          <section className={`screen ${activeScreen === "s4" ? "active" : ""}`.trim()}>
            <Case />
          </section>
          <section className={`screen ${activeScreen === "s5" ? "active" : ""}`.trim()}>
            <Execute />
          </section>
          <section className={`screen ${activeScreen === "s6" ? "active" : ""}`.trim()}>
            <Defect />
          </section>
          <section className={`screen ${activeScreen === "s8" ? "active" : ""}`.trim()}>
            <Logs />
          </section>
          <section className={`screen ${activeScreen === "s7" ? "active" : ""}`.trim()}>
            <AIConfig />
          </section>
          <section className={`screen ${activeScreen === "s9" ? "active" : ""}`.trim()}>
            <ProjectMgmt />
          </section>
          <section className={`screen ${activeScreen === "s10" ? "active" : ""}`.trim()}>
            <Knowledge />
          </section>
        </main>
      </div>
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}