/**
 * @file realBrowserFixture.test.ts
 * @description 真·浏览器端到端验证（无登录墙，自建 RuoYi 形态 fixture）：证明二次探索在 entry_only 模式下
 *              - #1：经系统菜单「点击进入」目标页（直接 navigate 深链被禁止，避免落在登录页）
 *              - #2：自动发现并点击「新增」打开表单，采集到中文字段（用户名称/手机号/邮箱/状态）
 *              - #4：采集到的字段名不含 DOM token 泄漏（btSelectAll 等）
 *              这是唯一能在无 demo.ruoyi.vip 登录墙情况下，用真实 PlaywrightEngine 跑通的代码路径验证。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import http from 'node:http';
import { createEngine } from '@test-platform/engine-mcp';
import type { McpEngine } from '@test-platform/contracts';
import { DEFAULT_FEATURE_COLUMNS } from '@test-platform/contracts';
import { exploreFeatureEvidenceMap } from '../featureEvidenceExplorer.js';

// 功能点表行：九列固定顺序（DEFAULT_FEATURE_COLUMNS），testPointId 在索引 8。
// 若列数/索引不对，inScopeIds 取不到 testPointId → 功能点被静默跳过。
const FC = DEFAULT_FEATURE_COLUMNS;
const FEATURE_ROW: string[] = [
  '1', // sequence
  '功能性测试', // testType
  'R1', // requirementSection
  '测试系统', // systemName
  '用户管理', // mainModule (4)
  '用户管理', // subModule (5)
  '用户管理', // featureName (6)
  '用户管理-测试点', // testPoint (7)
  'f_user', // testPointId (8)
];

const PORT = 8799;
const BASE_URL = `http://127.0.0.1:${PORT}/index`;
const TARGET_URL = `http://127.0.0.1:${PORT}/system/user`;

const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>测试管理系统</title>
<style>
  body{margin:0;font-family:sans-serif}
  #sidebar{width:200px;background:#2c3b4e;color:#fff;position:fixed;top:0;bottom:0;left:0;padding:10px}
  #sidebar a{display:block;color:#cfd8e3;padding:8px;text-decoration:none;cursor:pointer}
  #content{margin-left:220px;padding:20px}
  .section{display:none}.section.active{display:block}
  .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5)}
  .modal.active{display:block}.modal-box{background:#fff;width:360px;margin:80px auto;padding:20px}
  table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px}
  .form-row{margin:10px 0}label{display:inline-block;width:90px}button{margin:4px;padding:6px 12px;cursor:pointer}
</style></head>
<body>
<div id="sidebar">
  <a href="/index" id="menu-index" onclick="return goMenu(event,'index')">首页</a>
  <a href="/system/user" id="menu-user" onclick="return goMenu(event,'user')">用户管理</a>
  <a href="/system/role" id="menu-role" onclick="return goMenu(event,'role')">角色管理</a>
</div>
<div id="content">
  <div id="section-index" class="section active"><h2>首页</h2>欢迎</div>
  <div id="section-user" class="section">
    <h2>用户管理</h2>
    <div class="form-row"><label for="q-name">用户名称</label><input id="q-name" type="text" placeholder="请输入用户名称"></div>
    <button id="btn-query" onclick="void 0">查询</button>
    <table id="user-table"><thead><tr><th>编号</th><th>名称</th><th>状态</th><th>操作</th></tr></thead>
      <tbody><tr><td>1</td><td>张三</td><td>正常</td><td><button id="btn-detail" onclick="openDetail()">详情</button></td></tr></tbody></table>
    <button id="btn-add" onclick="openAdd()">新增</button>
  </div>
  <div id="section-role" class="section"><h2>角色管理</h2>内容</div>
</div>
<div id="modal-add" class="modal"><div class="modal-box"><h3>新增用户</h3>
  <div class="form-row"><label for="f-name">用户名称</label><input id="f-name" type="text" name="f-name" aria-label="用户名称"></div>
  <div class="form-row"><label for="f-phone">手机号</label><input id="f-phone" type="text" name="f-phone" aria-label="手机号"></div>
  <div class="form-row"><label for="f-email">邮箱</label><input id="f-email" type="text" name="f-email" aria-label="邮箱"></div>
  <div class="form-row"><label for="f-status">状态</label>
    <select id="f-status" name="f-status" aria-label="状态"><option value="1">正常</option><option value="0">禁用</option></select></div>
  <button id="btn-add-close" onclick="closeAdd()">关闭</button>
</div></div>
<div id="panel-detail" class="modal"><div class="modal-box"><h3>用户详情</h3>
  <div class="form-row"><label for="d-name">用户名称</label><input id="d-name" type="text" readonly></div>
  <button onclick="closeDetail()">关闭</button>
</div></div>
<script>
  function goMenu(e,sec){ e.preventDefault(); showSection(sec); try{location.hash=sec;}catch(_){} return false; }
  function showSection(sec){ document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active');}); var el=document.getElementById('section-'+sec); if(el) el.classList.add('active'); }
  function openAdd(){ document.getElementById('modal-add').classList.add('active'); }
  function closeAdd(){ document.getElementById('modal-add').classList.remove('active'); }
  function openDetail(){ document.getElementById('panel-detail').classList.add('active'); }
  function closeDetail(){ document.getElementById('panel-detail').classList.remove('active'); }
  if(location.hash){ showSection(location.hash.slice(1)); }
</script>
</body></html>`;

let server: Server | undefined;
let engine: McpEngine | undefined;

// 按路径渲染对应 section（模拟真实管理系统的服务端路由/SPA 首屏）：
// 点击进入 /system/user 后页面必须展示用户管理内容，否则只读采集（过滤 display:none）拿不到任何字段。
const renderFixture = (pathname: string): string => {
  const active = pathname.startsWith('/system/user') ? 'user' : pathname.startsWith('/system/role') ? 'role' : 'index';
  return FIXTURE_HTML
    .replace('id="section-index" class="section active"', 'id="section-index" class="section"')
    .replace(`id="section-${active}" class="section"`, `id="section-${active}" class="section active"`);
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderFixture(pathname));
  });
  await new Promise<void>((resolve) => server!.listen(PORT, '127.0.0.1', resolve));
  engine = createEngine({ headless: true, readOnlyClickPolicy: 'allow_all', timeoutMs: 15000 } as any);
  await engine.launch();
}, 60_000);

afterAll(async () => {
  try { await engine?.close(); } catch { /* ignore */ }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe('真实浏览器：entry_only 二次探索（点击进入 + 自动发现新增表单字段）', () => {
  it('经菜单点击进入目标页（不直接 navigate 深链），并采集到新增表单中文字段、无 token 泄漏', async () => {
    if (!engine) throw new Error('engine 未启动');
    const { evidence } = await exploreFeatureEvidenceMap(engine, {
      featurePaths: { f_user: TARGET_URL } as Record<string, string>,
      featureTable: [[FEATURE_ROW]] as any,
      featureProfiles: [{ featureId: 'f_user', actionKind: 'list', sourceLabel: '用户管理' }] as any,
      selectedModuleIds: [],
      scope: 'all',
      baseUrl: BASE_URL,
      featureIds: new Set(['f_user']),
      systemId: 'fixture',
      featureRevision: 'rev1',
      crossPathNavigation: 'entry_only',
    });

    const ev = evidence.f_user;
    // 诊断：打印真实证据，定位为何 states 为空
    // eslint-disable-next-line no-console
    console.log('DIAG ev=', JSON.stringify(ev, null, 2));
    expect(ev).toBeDefined();

    // #1：未直接打开深链（导航只到系统入口 /index，而非 /system/user）。
    // entry_only 经菜单「点击进入」走 runReadOnlyClick（沙箱内点击，不触发 navigate）；
    // 凡 navigate 调用都应只到 BASE_URL。读真实引擎记录的 navigationPath 验证。
    const navCalls = (await (engine as any).getNavigationPath()) as string[];
    expect(navCalls.some((u) => u.includes('/system/user'))).toBe(false);
    // 系统入口应至少被导航一次（菜单常驻可点，需先回首页）
    expect(navCalls.some((u) => u === BASE_URL)).toBe(true);

    // 证据应含新增(create)状态与详情(detail)状态（#2 自动发现）
    expect(ev.states).toContain('create');
    expect(ev.states).toContain('detail');

    // #2：新增表单的中文标签字段被采集
    const names = ev.fields.map((f) => f.name).filter(Boolean);
    expect(names.some((n) => (n as string).includes('用户名称'))).toBe(true);
    expect(names.some((n) => (n as string).includes('手机号'))).toBe(true);
    expect(names.some((n) => (n as string).includes('邮箱'))).toBe(true);
    expect(names.some((n) => (n as string).includes('状态'))).toBe(true);

    // #4：不得有任何 DOM token 泄漏字段名（btSelectAll / theSelect / f-name 等）
    for (const n of names) {
      expect(/^[A-Za-z][A-Za-z0-9_]*$/.test(n as string) && !(n as string).includes(' ') && !/[\u4e00-\u9fff]/.test(n as string)).toBe(false);
    }
    expect(ev.needsReview).toBe(false);
  }, 60_000);
});
